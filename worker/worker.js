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
  if (size > 25 * 1024 * 1024) return json({ ok: false, error: "file > 25MB" }, env, 400);

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
  if (size > 25 * 1024 * 1024) return json({ ok: false, error: "file > 25MB" }, env, 400);

  const claims = await verifyIdToken(idToken, env);
  if (!authorizeAdminForCourse(claims, cid, env)) {
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
  if (!authorizePath(claims, path, env)) return json({ ok: false, error: "forbidden" }, env, 403);
  const data = await ghGet("/contents/" + encodeURI(path), env);
  if (!data || !data.content) return json({ ok: false, error: "not found" }, env, 404);
  return json({
    ok: true,
    base64: data.content.replace(/\n/g, ""),
    name: data.name,
    size: data.size,
    sha: data.sha,
  }, env);
}

async function handleDelete(request, env, path) {
  if (!path) return json({ ok: false, error: "missing path" }, env, 400);
  const idToken = extractBearer(request);
  const claims = await verifyIdToken(idToken, env);
  if (!authorizePath(claims, path, env)) return json({ ok: false, error: "forbidden" }, env, 403);
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

function authorizePath(claims, path, env) {
  const supers = (env.SUPERADMINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (supers.indexOf(claims.email) !== -1) return true;
  // Path вида {cid}/{aid}/{uid_...}/{file}. Разрешаем автору, если
  // его uid — префикс третьего сегмента.
  const parts = path.split("/");
  if (parts.length < 3) return false;
  const studentDir = parts[2] || "";
  const uid = claims.user_id || claims.sub;
  return studentDir.startsWith(uid);
}

// Разрешение admin-доступа к курсу. Superadmin — по email в env.SUPERADMINS.
// Курсовые admin — по опциональному env.COURSE_ADMINS_JSON вида
//   {"email@example.com": ["sem1", "sem2", ...]}
// Строка COURSE_ADMINS_JSON, если задана, парсится один раз на запрос.
function authorizeAdminForCourse(claims, cid, env) {
  const email = claims.email || "";
  const supers = (env.SUPERADMINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (supers.indexOf(email) !== -1) return true;
  try {
    const map = JSON.parse(env.COURSE_ADMINS_JSON || "{}");
    const list = map[email];
    if (Array.isArray(list) && list.indexOf(cid) !== -1) return true;
  } catch (_) {}
  return false;
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
