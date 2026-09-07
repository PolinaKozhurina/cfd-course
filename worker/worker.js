// ============================================================
// CFD Course — Cloudflare Worker
// ------------------------------------------------------------
// Проксирует загрузку и скачивание файлов сдач между сайтом
// (studentUpload / adminDownload) и приватным GitHub-репо
// {GITHUB_OWNER}/{GITHUB_REPO}, куда у студентов нет прямого доступа.
//
// Секреты (задать через Cloudflare → Settings → Variables → Secrets):
//   GITHUB_PAT — fine-grained token с Contents:R/W на приватный репо.
//
// Обычные env-переменные (Variables):
//   GITHUB_OWNER          — PolinaKozhurina
//   GITHUB_REPO           — cfd-submissions
//   FIREBASE_PROJECT_ID   — cfd-course
//   SUPERADMINS           — "polinakozhurina2020@gmail.com"
//                            (при добавлении курсовых admin —
//                             через запятую, без пробелов)
//   ALLOWED_ORIGIN        — https://polinakozhurina.github.io
// ============================================================

const CACHE_JWKS_TTL_SEC = 3600;
// Версия кода воркера: видна в GET /health → проверка, что Cloudflare
// выкатил свежий коммит (Workers Builds деплоит при каждом push в master).
const WORKER_VERSION = "2026-09-07.5";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---------- CORS preflight ----------
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    try {
      if (url.pathname === "/upload" && request.method === "POST") {
        return await handleUpload(request, env);
      }
      if (url.pathname === "/upload-common" && request.method === "POST") {
        return await handleUploadCommon(request, env);
      }
      if (url.pathname === "/upload-reviewed" && request.method === "POST") {
        return await handleUploadReviewed(request, env);
      }
      if (url.pathname === "/lab-progress" && request.method === "POST") {
        return await handleLabProgress(request, env);
      }
      if (url.pathname === "/fetch-link" && request.method === "POST") {
        return await handleFetchLink(request, env);
      }
      if (url.pathname === "/admin-verify-email" && request.method === "POST") {
        return await handleAdminVerifyEmail(request, env);
      }
      if (url.pathname === "/admin-delete-user" && request.method === "POST") {
        return await handleAdminDeleteUser(request, env);
      }
      if (url.pathname === "/file" && request.method === "GET") {
        return await handleDownload(request, env, url.searchParams.get("path"));
      }
      if (url.pathname === "/file" && request.method === "DELETE") {
        return await handleDelete(request, env, url.searchParams.get("path"));
      }
      if (url.pathname === "/health") {
        return json({
          ok: true,
          version: WORKER_VERSION,
          ts: Date.now(),
          // Диагностика какие env реально видит Worker (без выдачи значений).
          env: {
            has_GITHUB_OWNER:          !!env.GITHUB_OWNER,
            has_GITHUB_REPO:           !!env.GITHUB_REPO,
            has_GITHUB_REPO_COMMON:    !!env.GITHUB_REPO_COMMON,
            has_FIREBASE_PROJECT_ID:   !!env.FIREBASE_PROJECT_ID,
            has_SUPERADMINS:           !!env.SUPERADMINS,
            has_COURSE_ADMINS_JSON:    !!env.COURSE_ADMINS_JSON,
            has_ALLOWED_ORIGIN:        !!env.ALLOWED_ORIGIN,
            has_GITHUB_PAT:            !!env.GITHUB_PAT,
            has_FIREBASE_ADMIN_SA_JSON:!!env.FIREBASE_ADMIN_SA_JSON,
            sa_len: env.FIREBASE_ADMIN_SA_JSON ? env.FIREBASE_ADMIN_SA_JSON.length : 0,
          },
        }, env);
      }
      return json({ ok: false, error: "not found" }, env, 404);
    } catch (e) {
      return json({ ok: false, error: e.message || String(e) }, env, 500);
    }
  },
};

// ============================================================
// Handlers
// ============================================================

async function handleUpload(request, env) {
  const body = await request.json();
  const idToken = body.token || "";
  const aid = String(body.aid || "");
  const cid = String(body.cid || "");
  const fio = sanitizeSlug(body.fio || "");
  const filename = sanitizeName(body.filename || "file.bin");
  const base64 = String(body.base64 || "");
  const size = parseInt(body.size || 0, 10) || 0;
  if (!aid || !cid || !base64) return json({ ok: false, error: "missing fields" }, env, 400);
  if (size > 50 * 1024 * 1024) return json({ ok: false, error: "file > 50MB" }, env, 400);

  const claims = await verifyIdToken(idToken, env);
  if (!claims.email_verified) return json({ ok: false, error: "email not verified" }, env, 403);

  const uidSlug = claims.user_id || claims.sub;
  const studentDir = uidSlug + (fio ? "_" + fio : "");
  const path = cid + "/" + aid + "/" + studentDir + "/" + Date.now() + "_" + filename;

  // Проверка существования — если да, забираем sha (перезапись)
  let sha = null;
  try {
    const cur = await ghGet("/contents/" + encodeURI(path), env);
    if (cur && cur.sha) sha = cur.sha;
  } catch (_) {}

  const put = await ghPut("/contents/" + encodeURI(path), {
    message: "upload: " + claims.email + " → " + filename,
    content: base64,
    sha: sha || undefined,
  }, env);

  return json({
    ok: true,
    path: path,
    sha: put.content ? put.content.sha : null,
    name: filename,
    size: size,
    uploadedAt: new Date().toISOString(),
  }, env);
}

// Admin-загрузка условия ДЗ в открытый учебный репо. Тело:
//   { token, cid, aid, filename, base64, size, subdir? }
// subdir — опциональный подкаталог внутри {cid}/_src/hw/{aid}/{subdir}/
// (по умолчанию — плоско в {cid}/_src/hw/{aid}/{filename}).
async function handleUploadCommon(request, env) {
  const body = await request.json();
  const idToken = body.token || "";
  const cid = sanitizeSlug(String(body.cid || ""));
  const aid = sanitizeSlug(String(body.aid || ""));
  const filename = sanitizeName(String(body.filename || "file.bin"));
  const base64 = String(body.base64 || "");
  const size = parseInt(body.size || 0, 10) || 0;
  const subdir = body.subdir ? sanitizeSlug(String(body.subdir)) : "";
  if (!cid || !aid || !base64) return json({ ok: false, error: "missing fields" }, env, 400);
  if (size > 50 * 1024 * 1024) return json({ ok: false, error: "file > 50MB" }, env, 400);

  const claims = await verifyIdToken(idToken, env);
  if (!(await authorizeAdminForCourse(claims, cid, env))) {
    return json({ ok: false, error: "forbidden (not admin of course " + cid + ")" }, env, 403);
  }

  // trim — на случай, если в Cloudflare env случайно попал ведущий/хвостовой
  // пробел (GitHub API вернёт 404 на URL с пробелом, и найти это без диагностики
  // сложно). Аналогично trim'аем и в handleUpload через ghApi ниже.
  const owner  = String(env.GITHUB_OWNER || "").trim();
  const repo   = String(env.GITHUB_REPO_COMMON || env.GITHUB_REPO || "").trim();
  const branch = String(env.GITHUB_BRANCH_COMMON || "master").trim();
  if (!owner || !repo) return json({ ok: false, error: "owner/repo not configured" }, env, 500);

  const path = cid + "/_src/hw/" + aid + (subdir ? "/" + subdir : "") + "/" + filename;

  // Если файл существует — перезаписываем (передаём sha).
  let sha = null;
  try {
    const cur = await ghApiRepo("GET", owner, repo, "/contents/" + encodeURI(path) + "?ref=" + encodeURIComponent(branch), null, env);
    if (cur && cur.sha) sha = cur.sha;
  } catch (_) {}

  const put = await ghApiRepo("PUT", owner, repo, "/contents/" + encodeURI(path), {
    message: "hw common upload by " + claims.email + " → " + filename,
    content: base64,
    sha: sha || undefined,
    branch: branch,
  }, env);

  // Публичный URL через GitHub Pages основного репо (owner в GH-Pages URL — lowercase).
  const publicUrl = "https://" + String(owner).toLowerCase() + ".github.io/" + repo + "/" + path;

  return json({
    ok: true,
    path: path,
    url: publicUrl,
    sha: put && put.content ? put.content.sha : null,
    name: filename,
    size: size,
    uploadedAt: new Date().toISOString(),
  }, env);
}

// Admin-загрузка проверенного файла (PDF с пометками) обратно в приватный
// репо cfd-submissions, в тот же студенческий каталог, что и сдача. Тело:
//   { token, cid, aid, targetUid, targetFio?, filename, base64, size }
// Путь: {cid}/{aid}/{targetUid}[_targetFio]/reviewed_{ts}_{filename}.
// Прежняя схема authorizePath (studentDir.startsWith(uid)) уже разрешает
// самому студенту скачать этот файл через /file — без правок правил.
async function handleUploadReviewed(request, env) {
  const body = await request.json();
  const idToken = body.token || "";
  const cid = String(body.cid || "");
  const aid = String(body.aid || "");
  const targetUid = String(body.targetUid || "");
  const targetFio = sanitizeSlug(body.targetFio || "");
  const filename = sanitizeName(body.filename || "reviewed.pdf");
  const base64 = String(body.base64 || "");
  const size = parseInt(body.size || 0, 10) || 0;
  if (!cid || !aid || !targetUid || !base64) {
    return json({ ok: false, error: "missing fields" }, env, 400);
  }
  if (size > 50 * 1024 * 1024) return json({ ok: false, error: "file > 50MB" }, env, 400);

  const claims = await verifyIdToken(idToken, env);
  if (!(await authorizeAdminForCourse(claims, cid, env))) {
    return json({ ok: false, error: "forbidden (not admin of course " + cid + ")" }, env, 403);
  }

  const studentDir = targetUid + (targetFio ? "_" + targetFio : "");
  const path = cid + "/" + aid + "/" + studentDir + "/reviewed_" + Date.now() + "_" + filename;

  let sha = null;
  try {
    const cur = await ghGet("/contents/" + encodeURI(path), env);
    if (cur && cur.sha) sha = cur.sha;
  } catch (_) {}

  const put = await ghPut("/contents/" + encodeURI(path), {
    message: "reviewed upload: " + claims.email + " → " + filename,
    content: base64,
    sha: sha || undefined,
  }, env);

  return json({
    ok: true,
    path: path,
    sha: put && put.content ? put.content.sha : null,
    name: filename,
    size: size,
    uploadedAt: new Date().toISOString(),
  }, env);
}

// ============================================================
// Admin: скачать PDF по ссылке студента (Google Drive / Я.Диск / Dropbox /
// прямая ссылка) для проверялки.
// ------------------------------------------------------------
// POST /fetch-link  { token, cid, url }
// Браузер не может сам забрать файл с drive.google.com (CORS), поэтому
// воркер делает это за него и отдаёт байты PDF как есть. Только admin
// курса cid. Ответ: тело — application/pdf, заголовок X-File-Name — имя
// файла (URL-encoded). Ошибки — JSON { ok:false, error }.
// ============================================================
const FETCH_LINK_MAX = 50 * 1024 * 1024;

// Резервная копия прогресса закрытой лабы в приватный репо сдач:
//   labs/{cid}/{lab}/{uid}/{editorId}.cpp  — код студента по задачам
//   labs/{cid}/{lab}/{uid}/progress.json   — отметки автопроверки, зачёт
// Все файлы одного запроса — один коммит (Git Data API); если содержимое
// не изменилось, коммит не создаётся.
// Тело (студент, только свой uid):
//   { token, cid, lab, tasks, code, done, total }
// Тело (admin курса, выгрузка всех):
//   { token, cid, lab, items: [{ uid, email, fio, tasks, code, done, total, accepted }] }
async function handleLabProgress(request, env) {
  const body = await request.json();
  const cid = sanitizeSlug(String(body.cid || ""));
  const lab = sanitizeSlug(String(body.lab || ""));
  if (!cid || !lab) return json({ ok: false, error: "missing cid/lab" }, env, 400);

  const claims = await verifyIdToken(body.token || "", env);
  const me = claims.user_id || claims.sub;
  const isAdmin = await authorizeAdminForCourse(claims, cid, env);

  let items;
  if (Array.isArray(body.items)) {
    if (!isAdmin) return json({ ok: false, error: "forbidden (not admin of course " + cid + ")" }, env, 403);
    items = body.items;
  } else {
    items = [{ uid: me, email: claims.email, tasks: body.tasks, code: body.code, done: body.done, total: body.total }];
  }

  const files = {};
  let n = 0;
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const uid = sanitizeSlug(String(it.uid || ""));
    if (!uid) continue;
    if (uid !== me && !isAdmin) continue;
    const dir = "labs/" + cid + "/" + lab + "/" + uid;
    const code = (it.code && typeof it.code === "object") ? it.code : {};
    for (const k of Object.keys(code)) {
      const text = String(code[k] == null ? "" : code[k]);
      if (text.length > 200000) continue;
      files[dir + "/" + (sanitizeSlug(k) || "code") + ".cpp"] = text;
    }
    files[dir + "/progress.json"] = JSON.stringify({
      uid: uid, email: it.email || null, fio: it.fio || null,
      courseId: cid, labId: lab,
      tasks: (it.tasks && typeof it.tasks === "object") ? it.tasks : {},
      done: it.done || 0, total: it.total || 0, accepted: !!it.accepted,
      savedAt: new Date().toISOString(), savedBy: claims.email || me,
    }, null, 2) + "\n";
    n++;
  }
  if (!n) return json({ ok: false, error: "nothing to save" }, env, 400);

  const msg = "lab progress: " + cid + "/" + lab + " · " + (n === 1 ? (claims.email || me) : n + " студ. (выгрузка " + (claims.email || me) + ")");
  const r = await ghCommitFiles(files, msg, env);
  return json({ ok: true, students: n, files: Object.keys(files).length, commit: r.commit, unchanged: r.unchanged }, env);
}

// Один коммит с несколькими файлами в основной (приватный) репо через Git
// Data API. При гонке двух запросов (ref ушёл вперёд) — перечитать и повторить.
async function ghCommitFiles(files, message, env) {
  let branch = String(env.GITHUB_BRANCH || "").trim();
  if (!branch) {
    const info = await ghGet("", env);
    branch = (info && info.default_branch) || "main";
  }
  const tree = Object.keys(files).map(p => ({ path: p, mode: "100644", type: "blob", content: files[p] }));
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = await ghGet("/git/ref/heads/" + branch, env);
    if (!ref || !ref.object) throw new Error("branch not found: " + branch);
    const headSha = ref.object.sha;
    const head = await ghGet("/git/commits/" + headSha, env);
    const baseTree = head.tree.sha;
    const newTree = await ghApi("POST", "/git/trees", { base_tree: baseTree, tree: tree }, env);
    if (newTree.sha === baseTree) return { unchanged: true, commit: headSha };
    const commit = await ghApi("POST", "/git/commits", { message: message, tree: newTree.sha, parents: [headSha] }, env);
    try {
      await ghApi("PATCH", "/git/refs/heads/" + branch, { sha: commit.sha, force: false }, env);
      return { unchanged: false, commit: commit.sha };
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 200 + Math.random() * 400));
    }
  }
  throw lastErr || new Error("ref update failed");
}

async function handleFetchLink(request, env) {
  const body = await request.json();
  const idToken = body.token || "";
  const cid = String(body.cid || "");
  const link = String(body.url || "").trim();
  if (!cid || !/^https?:\/\//i.test(link)) {
    return json({ ok: false, error: "missing fields" }, env, 400);
  }
  const claims = await verifyIdToken(idToken, env);
  if (!(await authorizeAdminForCourse(claims, cid, env))) {
    return json({ ok: false, error: "forbidden (not admin of course " + cid + ")" }, env, 403);
  }

  const candidates = await resolveDirectLinks(link);
  let lastErr = "";
  for (const c of candidates) {
    if (c.error) { lastErr = c.error; continue; }
    try {
      const r = await fetch(c.url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; cfd-course-worker)" },
      });
      if (!r.ok) { lastErr = "HTTP " + r.status + " от " + safeHost(c.url); continue; }
      const len = parseInt(r.headers.get("content-length") || "0", 10) || 0;
      if (len > FETCH_LINK_MAX) { lastErr = "файл больше 50 MB"; break; }
      if (!r.body) { lastErr = "пустой ответ от " + safeHost(c.url); continue; }
      // Читаем начало, чтобы проверить сигнатуру, дальше отдаём потоком —
      // без буферизации всего файла (сканы бывают по 50 МБ).
      const reader = r.body.getReader();
      let first = new Uint8Array(0);
      while (first.length < 8) {
        const { done, value } = await reader.read();
        if (done) break;
        const merged = new Uint8Array(first.length + value.length);
        merged.set(first, 0); merged.set(value, first.length);
        first = merged;
      }
      const isPdf = first.length >= 4 && first[0] === 0x25 && first[1] === 0x50 && first[2] === 0x44 && first[3] === 0x46; // "%PDF"
      if (!isPdf) {
        try { await reader.cancel(); } catch (_) {}
        const ct = (r.headers.get("content-type") || "?").split(";")[0];
        lastErr = /html/i.test(ct)
          ? "по ссылке отдаётся страница, а не файл (файл закрыт? откройте доступ «всем, у кого есть ссылка»)"
          : "по ссылке не PDF (" + ct + ")";
        continue;
      }
      const name = fileNameFromResponse(r) || c.name || "submission.pdf";
      let total = first.length;
      const stream = new ReadableStream({
        start(ctrl) { ctrl.enqueue(first); },
        async pull(ctrl) {
          const { done, value } = await reader.read();
          if (done) { ctrl.close(); return; }
          total += value.length;
          if (total > FETCH_LINK_MAX) { try { await reader.cancel(); } catch (_) {} ctrl.error(new Error("файл больше 50 MB")); return; }
          ctrl.enqueue(value);
        },
        cancel() { try { reader.cancel(); } catch (_) {} },
      });
      const h = Object.assign({
        "Content-Type": "application/pdf",
        "X-File-Name": encodeURIComponent(name),
        "Access-Control-Expose-Headers": "Content-Length,X-File-Name",
      }, corsHeaders(env));
      if (len) h["Content-Length"] = String(len);
      return new Response(stream, { status: 200, headers: h });
    } catch (e) { lastErr = (e && e.message) || String(e); }
  }
  return json({ ok: false, error: lastErr || "не удалось скачать" }, env, 502);
}

function safeHost(u) { try { return new URL(u).hostname; } catch (_) { return "?"; } }

// Ссылка «для людей» → список кандидатов на прямое скачивание.
// Элемент { url, name? } или { error } — понятная причина, если кандидатов нет.
async function resolveDirectLinks(link) {
  let u;
  try { u = new URL(link); } catch (_) { return [{ url: link }]; }
  const host = u.hostname.toLowerCase();
  let m;
  if (host === "drive.google.com" || host === "docs.google.com") {
    // Google Docs / Slides / Sheets — экспорт в PDF.
    m = u.pathname.match(/^\/(document|presentation|spreadsheets)\/d\/([\w-]+)/);
    if (m) {
      return [{ url: "https://docs.google.com/" + m[1] + "/d/" + m[2] + "/export?format=pdf",
                name: m[1] + "_" + m[2].slice(0, 8) + ".pdf" }];
    }
    if (/^\/drive\/(u\/\d+\/)?folders\//.test(u.pathname)) {
      return [{ error: "это ссылка на папку Google Диска — нужна ссылка на сам PDF (правый клик по файлу → «Поделиться» → «Копировать ссылку»)" }];
    }
    // Обычный файл на Диске: /file/d/ID/view, /open?id=ID, /uc?id=ID.
    let id = null;
    m = u.pathname.match(/\/file\/d\/([\w-]+)/);
    if (m) id = m[1];
    if (!id) id = u.searchParams.get("id");
    if (id) {
      return [
        // Этот хост отдаёт файл любого размера без страницы «проверка на вирусы».
        { url: "https://drive.usercontent.google.com/download?id=" + id + "&export=download&confirm=t" },
        { url: "https://drive.google.com/uc?export=download&id=" + id },
      ];
    }
  }
  if (/(^|\.)disk\.yandex\.(ru|com|by|kz)$/.test(host) || host === "yadi.sk") {
    return await resolveYandexPublic(link);
  }
  if (/(^|\.)dropbox\.com$/.test(host)) {
    u.searchParams.set("dl", "1");
    return [{ url: u.toString() }];
  }
  return [{ url: link }];
}

// Яндекс Диск: публичная ссылка может вести на файл или на папку.
// Для папки берём PDF из неё (если один — его; если несколько — самый большой).
async function resolveYandexPublic(link) {
  const api = "https://cloud-api.yandex.net/v1/disk/public/resources";
  const key = encodeURIComponent(link);
  let meta = null;
  try {
    const r = await fetch(api + "?public_key=" + key + "&limit=200");
    if (r.ok) meta = await r.json();
    else if (r.status === 404) return [{ error: "Яндекс Диск: ссылка не найдена или доступ закрыт" }];
  } catch (_) {}
  const dl = async (path) => {
    try {
      const r = await fetch(api + "/download?public_key=" + key + (path ? "&path=" + encodeURIComponent(path) : ""));
      const d = await r.json();
      return d && d.href ? d.href : null;
    } catch (_) { return null; }
  };
  if (meta && meta.type === "dir") {
    const items = ((meta._embedded && meta._embedded.items) || []).filter(it =>
      it.type === "file" && (/\.pdf$/i.test(it.name || "") || /pdf/i.test(it.mime_type || "")));
    if (!items.length) return [{ error: "в папке на Яндекс Диске нет PDF" }];
    items.sort((x, y) => (y.size || 0) - (x.size || 0));
    const out = [];
    for (const it of items.slice(0, 3)) {
      const href = await dl(it.path);
      if (href) out.push({ url: href, name: it.name });
      else if (it.file) out.push({ url: it.file, name: it.name });
    }
    return out.length ? out : [{ error: "Яндекс Диск не дал ссылку на скачивание PDF из папки" }];
  }
  const href = await dl(null);
  if (href) return [{ url: href, name: meta && meta.name }];
  if (meta && meta.file) return [{ url: meta.file, name: meta.name }];
  return [{ error: "Яндекс Диск не дал ссылку на скачивание (доступ закрыт?)" }];
}

function fileNameFromResponse(r) {
  const cd = r.headers.get("content-disposition") || "";
  let m = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (m) { try { return decodeURIComponent(m[1]); } catch (_) {} }
  m = cd.match(/filename="?([^";]+)"?/i);
  return m ? m[1] : null;
}

// ============================================================
// Admin: ручная верификация email студента
// ------------------------------------------------------------
// Endpoint POST /admin-verify-email. Тело: { token, targetUid }.
// Проверяет, что вызывающий — admin (SUPERADMINS или COURSE_ADMINS_JSON
// для любого курса), затем через Firebase Admin REST помечает
// emailVerified=true у указанного пользователя. Нужен ENV
// FIREBASE_ADMIN_SA_JSON — полный JSON service account (Firebase
// Console → Project Settings → Service accounts → Generate new
// private key), сохранённый в Cloudflare как Secret.
// ============================================================

async function handleAdminVerifyEmail(request, env) {
  const body = await request.json();
  const idToken = body.token || "";
  const targetUid = String(body.targetUid || "");
  if (!targetUid) return json({ ok: false, error: "missing targetUid" }, env, 400);

  const claims = await verifyIdToken(idToken, env);
  if (!isAdminGlobal(claims, env)) {
    return json({ ok: false, error: "forbidden (not admin)" }, env, 403);
  }

  if (!env.FIREBASE_ADMIN_SA_JSON) {
    return json({ ok: false, error: "FIREBASE_ADMIN_SA_JSON not configured" }, env, 500);
  }
  const sa = JSON.parse(env.FIREBASE_ADMIN_SA_JSON);
  const accessToken = await getGoogleAccessToken(sa);

  const resp = await fetch(
    "https://identitytoolkit.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID + "/accounts:update",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ localId: targetUid, emailVerified: true }),
    }
  );
  const data = await resp.json();
  if (!resp.ok) {
    return json({
      ok: false,
      error: "admin-api " + resp.status + ": " + JSON.stringify(data).slice(0, 300),
    }, env, 500);
  }
  return json({
    ok: true,
    uid: data.localId || targetUid,
    email: data.email || null,
    emailVerified: true,
  }, env);
}

// Admin: удалить студента полностью (Firebase Auth + Firestore users doc).
// POST /admin-delete-user, body { token, targetUid }.
// Только superadmin (SUPERADMINS) — курсовым admin такую операцию не даём:
// удаление аккаунта затрагивает все курсы сразу, а не один.
async function handleAdminDeleteUser(request, env) {
  const body = await request.json();
  const idToken = body.token || "";
  const targetUid = String(body.targetUid || "");
  if (!targetUid) return json({ ok: false, error: "missing targetUid" }, env, 400);

  const claims = await verifyIdToken(idToken, env);
  const supers = (env.SUPERADMINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (supers.indexOf(claims.email || "") === -1) {
    // Курсовые admin (только COURSE_ADMINS_JSON) — тоже пускаем: удаление
    // выпущено намеренно для быстрого сноса тестовых аккаунтов; настоящую
    // мощь всё равно даёт service account в Cloudflare Secret.
    if (!isAdminGlobal(claims, env)) {
      return json({ ok: false, error: "forbidden (not admin)" }, env, 403);
    }
  }
  // Не даём удалить самого себя случайно
  if (claims.user_id === targetUid || claims.sub === targetUid) {
    return json({ ok: false, error: "cannot delete self" }, env, 400);
  }

  if (!env.FIREBASE_ADMIN_SA_JSON) {
    return json({ ok: false, error: "FIREBASE_ADMIN_SA_JSON not configured" }, env, 500);
  }
  const sa = JSON.parse(env.FIREBASE_ADMIN_SA_JSON);
  const accessToken = await getGoogleAccessToken(sa);
  const pid = env.FIREBASE_PROJECT_ID;

  // 1) Firebase Auth: удалить аккаунт
  const respAuth = await fetch(
    "https://identitytoolkit.googleapis.com/v1/projects/" + pid + "/accounts:delete",
    {
      method: "POST",
      headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ localId: targetUid }),
    }
  );
  const dataAuth = await respAuth.json();
  // 404-у не считаем ошибкой — уже удалён, продолжаем чистку.
  if (!respAuth.ok && respAuth.status !== 404) {
    return json({
      ok: false, error: "auth-delete " + respAuth.status + ": " + JSON.stringify(dataAuth).slice(0, 300),
    }, env, 500);
  }

  // 2) Firestore: удалить users/{uid}
  let firestoreDeleted = false;
  try {
    const respFs = await fetch(
      "https://firestore.googleapis.com/v1/projects/" + pid + "/databases/(default)/documents/users/" + targetUid,
      {
        method: "DELETE",
        headers: { "Authorization": "Bearer " + accessToken },
      }
    );
    firestoreDeleted = respFs.ok || respFs.status === 404;
  } catch (_) {}

  return json({
    ok: true,
    uid: targetUid,
    firestoreDeleted: firestoreDeleted,
    note: "Auth-аккаунт и users doc удалены. Дочерние документы (enrollments, submissions, attendance-records) остались — почисти их отдельно, если нужно.",
  }, env);
}

// Глобальный admin — superadmin ИЛИ email присутствует в COURSE_ADMINS_JSON
// хотя бы для одного курса. Для verify-email не важно, каким именно
// курсом человек управляет — важно, что он вообще admin.
function isAdminGlobal(claims, env) {
  const email = claims.email || "";
  const supers = (env.SUPERADMINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (supers.indexOf(email) !== -1) return true;
  try {
    const map = JSON.parse(env.COURSE_ADMINS_JSON || "{}");
    const list = map[email];
    if (Array.isArray(list) && list.length > 0) return true;
  } catch (_) {}
  return false;
}

// ============================================================
// Google Service Account → OAuth2 access_token (JWT bearer flow)
// ============================================================

async function getGoogleAccessToken(sa) {
  // sa: { client_email, private_key, ... } из Firebase Service Account JSON.
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const enc = new TextEncoder();
  const seg = (obj) => b64urlEncode(enc.encode(JSON.stringify(obj)));
  const signedInput = seg(header) + "." + seg(payload);

  const key = await importPkcs8PrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" }, key,
    enc.encode(signedInput)
  );
  const jwt = signedInput + "." + b64urlEncode(new Uint8Array(sig));

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + encodeURIComponent(jwt),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error("oauth-token " + resp.status + ": " + JSON.stringify(data).slice(0, 300));
  }
  return data.access_token;
}

async function importPkcs8PrivateKey(pem) {
  // Убираем header/footer и newlines.
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = base64ToBytes(b64);
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function b64urlEncode(bytes) {
  // bytes: Uint8Array
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function handleDownload(request, env, path) {
  if (!path) return json({ ok: false, error: "missing path" }, env, 400);
  const idToken = extractBearer(request);
  const claims = await verifyIdToken(idToken, env);
  if (!(await authorizePath(claims, path, env))) return json({ ok: false, error: "forbidden" }, env, 403);
  let data = await ghGet("/contents/" + encodeURI(path), env);
  if (!data) {
    // Имя файла могло прийти в другой Unicode-нормализации (iPad/macOS дают
    // NFD, в git лежит NFC или наоборот) — пробуем обе формы.
    for (const form of ["NFC", "NFD"]) {
      const alt = path.normalize(form);
      if (alt === path) continue;
      data = await ghGet("/contents/" + encodeURI(alt), env);
      if (data) { path = alt; break; }
    }
  }
  if (!data) return json({ ok: false, error: "файл не найден в хранилище: " + path }, env, 404);
  // ?raw=1 — отдать сам файл потоком (без base64 в JSON): быстрее, меньше
  // памяти в браузере, есть прогресс по Content-Length. GitHub отдаёт raw
  // содержимое для файлов до 100 МБ по media type application/vnd.github.raw.
  if (new URL(request.url).searchParams.get("raw") === "1") {
    const owner = String(env.GITHUB_OWNER || "").trim(), repo = String(env.GITHUB_REPO || "").trim();
    const gh = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + encodeURI(path), {
      headers: { Authorization: "Bearer " + env.GITHUB_PAT, Accept: "application/vnd.github.raw", "User-Agent": "cfd-course-worker" },
    });
    if (!gh.ok) return json({ ok: false, error: "github raw " + gh.status }, env, 502);
    const h = corsHeaders(env);
    h["Content-Type"] = /\.pdf$/i.test(path) ? "application/pdf" : "application/octet-stream";
    if (data.size) h["Content-Length"] = String(data.size);
    h["X-File-Name"] = encodeURIComponent(data.name || "");
    h["Access-Control-Expose-Headers"] = "Content-Length,X-File-Name";
    h["Cache-Control"] = "private, max-age=300";
    return new Response(gh.body, { status: 200, headers: h });
  }
  let b64 = data.content ? String(data.content).replace(/\n/g, "") : "";
  // Contents API отдаёт content только до 1 МБ; для файлов больше (обычно
  // PDF-сканы) content пустой, а sha есть — забираем blob (до 100 МБ).
  if (!b64 && data.sha && data.size > 0) {
    const blob = await ghGet("/git/blobs/" + data.sha, env);
    if (blob && blob.content) b64 = String(blob.content).replace(/\n/g, "");
  }
  if (!b64 && data.size > 0) return json({ ok: false, error: "file too large for API (" + data.size + " bytes)" }, env, 413);
  return json({
    ok: true,
    base64: b64,
    name: data.name,
    size: data.size,
    sha: data.sha,
  }, env);
}

async function handleDelete(request, env, path) {
  if (!path) return json({ ok: false, error: "missing path" }, env, 400);
  const idToken = extractBearer(request);
  const claims = await verifyIdToken(idToken, env);
  if (!(await authorizePath(claims, path, env))) return json({ ok: false, error: "forbidden" }, env, 403);
  const cur = await ghGet("/contents/" + encodeURI(path), env);
  if (!cur || !cur.sha) return json({ ok: true, note: "already gone" }, env);
  await ghApi("DELETE", "/contents/" + encodeURI(path), {
    message: "delete by " + claims.email,
    sha: cur.sha,
  }, env);
  return json({ ok: true }, env);
}

// ============================================================
// Authorization helpers
// ============================================================

async function authorizePath(claims, path, env) {
  const supers = (env.SUPERADMINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (supers.indexOf(claims.email) !== -1) return true;
  // Path вида {cid}/{aid}/{uid_...}/{file}. Разрешаем автору, если
  // его uid — префикс третьего сегмента.
  const parts = path.split("/");
  if (parts.length < 3) return false;
  if (parts.some(seg => seg === "" || seg === "." || seg === "..")) return false;
  const studentDir = parts[2] || "";
  const uid = claims.user_id || claims.sub;
  if (uid && studentDir.startsWith(uid)) return true;
  // Курсовой admin — файлы сдач своего курса (первый сегмент пути = cid).
  return await authorizeAdminForCourse(claims, parts[0], env);
}

// Разрешение admin-доступа к курсу. Superadmin — по email в env.SUPERADMINS.
// Курсовые admin — по опциональному env.COURSE_ADMINS_JSON вида
//   {"email@example.com": ["sem1", "sem2", ...]}
// либо, если там не найден, — по документу users/{uid} в Firestore
// (isAdmin == true и cid ∈ managedCourses), как в правилах Firestore
// (adminCanManageCourse). Читается сервисным аккаунтом FIREBASE_ADMIN_SA_JSON.
async function authorizeAdminForCourse(claims, cid, env) {
  const email = claims.email || "";
  const supers = (env.SUPERADMINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (supers.indexOf(email) !== -1) return true;
  if (!cid) return false;
  try {
    const map = JSON.parse(env.COURSE_ADMINS_JSON || "{}");
    const list = map[email];
    if (Array.isArray(list) && list.indexOf(cid) !== -1) return true;
  } catch (_) {}
  try {
    const courses = await fetchManagedCourses(claims.user_id || claims.sub, env);
    return courses.indexOf(cid) !== -1;
  } catch (e) {
    console.warn("authorizeAdminForCourse: firestore lookup failed:", e && e.message);
    return false;
  }
}

// users/{uid} → managedCourses, если isAdmin == true; иначе [].
// Кэш на время жизни изолята (Cloudflare может держать его минуты),
// чтобы не ходить в Firestore на каждый файл.
const _managedCache = new Map();
async function fetchManagedCourses(uid, env) {
  if (!uid) return [];
  const hit = _managedCache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.courses;
  if (!env.FIREBASE_ADMIN_SA_JSON || !env.FIREBASE_PROJECT_ID) return [];
  const sa = JSON.parse(env.FIREBASE_ADMIN_SA_JSON);
  const accessToken = await getGoogleAccessToken(sa);
  const resp = await fetch(
    "https://firestore.googleapis.com/v1/projects/" + env.FIREBASE_PROJECT_ID
      + "/databases/(default)/documents/users/" + encodeURIComponent(uid),
    { headers: { Authorization: "Bearer " + accessToken } }
  );
  let courses = [];
  if (resp.ok) {
    const doc = await resp.json();
    const f = (doc && doc.fields) || {};
    const isAdmin = !!(f.isAdmin && f.isAdmin.booleanValue === true);
    const arr = (f.managedCourses && f.managedCourses.arrayValue && f.managedCourses.arrayValue.values) || [];
    if (isAdmin) courses = arr.map(v => v.stringValue).filter(Boolean);
  } else if (resp.status !== 404) {
    throw new Error("firestore users/" + uid + " " + resp.status);
  }
  _managedCache.set(uid, { courses: courses, exp: Date.now() + 60 * 1000 });
  return courses;
}

function extractBearer(request) {
  const h = request.headers.get("Authorization") || "";
  return h.replace(/^Bearer\s+/i, "");
}

// ============================================================
// Firebase ID token verification (RS256 via Google JWKS)
// ============================================================

let _jwksCache = null;

async function fetchJwks() {
  if (_jwksCache && _jwksCache.exp > Date.now()) return _jwksCache.keys;
  const resp = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!resp.ok) throw new Error("jwks fetch " + resp.status);
  const data = await resp.json();
  const byKid = {};
  for (const k of data.keys) byKid[k.kid] = k;
  _jwksCache = { keys: byKid, exp: Date.now() + CACHE_JWKS_TTL_SEC * 1000 };
  return byKid;
}

async function verifyIdToken(token, env) {
  if (!token) throw new Error("no token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("bad token format");
  const header = JSON.parse(b64urlDecodeStr(parts[0]));
  const payload = JSON.parse(b64urlDecodeStr(parts[1]));
  const sig = b64urlDecodeBytes(parts[2]);
  const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const jwks = await fetchJwks();
  const jwk = jwks[header.kid];
  if (!jwk) throw new Error("unknown kid");
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const ok = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, sig, signed);
  if (!ok) throw new Error("bad signature");
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("token expired");
  if (payload.iat && payload.iat > now + 60) throw new Error("token from future");
  const pid = env.FIREBASE_PROJECT_ID;
  if (payload.aud !== pid) throw new Error("bad aud");
  if (payload.iss !== "https://securetoken.google.com/" + pid) throw new Error("bad iss");
  return payload;
}

// ============================================================
// GitHub API helpers
// ============================================================

async function ghApi(method, path, body, env) {
  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  if (!owner || !repo) throw new Error("owner/repo not configured");
  const resp = await fetch("https://api.github.com/repos/" + owner + "/" + repo + path, {
    method: method,
    headers: {
      Authorization: "Bearer " + env.GITHUB_PAT,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "cfd-course-worker",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 404 && method === "GET") return null;
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error("github " + method + " " + resp.status + ": " + t.slice(0, 300));
  }
  return await resp.json();
}
function ghGet(path, env)  { return ghApi("GET",  path, null, env); }
function ghPut(path, b, env){ return ghApi("PUT", path, b, env); }

// Как ghApi, но с явным owner/repo — для endpoints, работающих не с
// основным репо приёма сдач, а с другим (например, публичным cfd-course).
async function ghApiRepo(method, owner, repo, path, body, env) {
  if (!owner || !repo) throw new Error("owner/repo not configured");
  const resp = await fetch("https://api.github.com/repos/" + owner + "/" + repo + path, {
    method: method,
    headers: {
      Authorization: "Bearer " + env.GITHUB_PAT,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "cfd-course-worker",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 404 && method === "GET") return null;
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error("github " + method + " " + owner + "/" + repo + " " + resp.status + ": " + t.slice(0, 300));
  }
  return await resp.json();
}

// ============================================================
// Utils
// ============================================================

function sanitizeSlug(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\-]+/g, "_").slice(0, 60);
}
function sanitizeName(s) {
  return String(s).replace(/[\\\/:*?"<>|]+/g, "_").slice(0, 120) || "file.bin";
}

function b64urlDecodeStr(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}
function b64urlDecodeBytes(s) {
  const str = b64urlDecodeStr(s);
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
  return buf;
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(obj, env, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, corsHeaders(env || {})),
  });
}
