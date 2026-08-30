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
      if (url.pathname === "/file" && request.method === "GET") {
        return await handleDownload(request, env, url.searchParams.get("path"));
      }
      if (url.pathname === "/file" && request.method === "DELETE") {
        return await handleDelete(request, env, url.searchParams.get("path"));
      }
      if (url.pathname === "/health") {
        return json({ ok: true, ts: Date.now() }, env);
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
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
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
