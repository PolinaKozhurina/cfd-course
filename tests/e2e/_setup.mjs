// ============================================================
// tests/e2e/_setup.mjs
// Общие хелперы для E2E — работа с эмулятором Firebase Auth
// (создание пользователей, логин) и Firestore (сидинг users doc,
// enrollment approval, releasedAt для лекций).
// ============================================================
import { test as base, expect } from '@playwright/test';
import admin from 'firebase-admin';

const AUTH_HOST = 'http://127.0.0.1:9099';
const FS_HOST   = 'http://127.0.0.1:8080';
// projectId должен совпадать с тем, что заявлен в js/firebase-config.js —
// иначе firebase-admin и compat SDK попадут в разные namespace эмулятора.
const PROJECT   = 'cfd-course';
const API_KEY   = 'fake-api-key';

// firebase-admin с эмулятором — обходит security-rules при записи (roles=owner).
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const adminDb = admin.firestore();

// --- Auth (REST) ------------------------------------------------------------
export async function createUser(email, password = 'test12345') {
  const url = `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!r.ok) throw new Error('createUser failed: ' + await r.text());
  const j = await r.json();
  // Пометить email как verified — этого требует часть правил и UI.
  await fetch(`${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts/${j.localId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailVerified: true }),
  });
  return { uid: j.localId, idToken: j.idToken, email };
}

export async function resetAuth() {
  await fetch(`${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}
export async function resetFirestore() {
  await fetch(`${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
  });
}

// --- Firestore (через firebase-admin, обходит rules) ------------------------
export async function fsSet(path, data) {
  const parts = path.split('/');
  if (parts.length % 2 !== 0) throw new Error('fsSet path must be doc, got: ' + path);
  await adminDb.doc(path).set(data, { merge: true });
}

// --- Browser side -----------------------------------------------------------
// Ставит флаг эмулятора ДО выполнения кода страницы + логинит указанного
// пользователя через firebase-auth-compat (уже загруженный на странице).
export async function enableEmulatorAndLogin(page, email, password = 'test12345') {
  await page.addInitScript(() => {
    localStorage.setItem('cfd_use_emulator', '1');
  });
  await page.goto('/index.html');
  if (email) {
    await page.evaluate(async ({ email, password }) => {
      await firebase.auth().signInWithEmailAndPassword(email, password);
    }, { email, password });
  }
}
export async function enableEmulatorAnon(page) {
  await page.addInitScript(() => {
    localStorage.setItem('cfd_use_emulator', '1');
  });
}

export { base as test, expect };
