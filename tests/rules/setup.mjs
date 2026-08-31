// ============================================================
// tests/rules/setup.mjs
// ------------------------------------------------------------
// Общие хелперы для интеграционных rules-тестов через Firestore
// эмулятор. Живёт как ESM.
//
// Роли:
//   super         — email polinakozhurina2020@gmail.com
//   admin-nm      — users/{uid}={isAdmin:true, managedCourses:['nm']}
//   admin-sem2    — users/{uid}={isAdmin:true, managedCourses:['sem2']}
//   student       — обычный (email_verified=true, чтобы прошёл isVerified)
//   student-noverif — email_verified=false
//   anon          — не залогинен
//
// Каждый тест берёт fresh context у нужной роли; между тестами
// firestore очищается через clearFirestore().
// ============================================================
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesPath        = resolve(__dirname, '..', '..', 'firestore.rules');
const storageRulesPath = resolve(__dirname, '..', '..', 'storage.rules');

export const SUPER_EMAIL = 'polinakozhurina2020@gmail.com';

let env = null;
export async function getEnv() {
  if (env) return env;
  env = await initializeTestEnvironment({
    projectId: 'demo-cfd',
    firestore: {
      rules: readFileSync(rulesPath, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: readFileSync(storageRulesPath, 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
  return env;
}
export async function cleanup() {
  if (env) {
    await env.cleanup();
    env = null;
  }
}
export async function clear() {
  const e = await getEnv();
  await e.clearFirestore();
}

// --- Роли -----------------------------------------------------------
export async function asSuper() {
  const e = await getEnv();
  return e.authenticatedContext('super-uid', { email: SUPER_EMAIL, email_verified: true }).firestore();
}
export async function asAdminNm(uid = 'admin-nm-uid') {
  const e = await getEnv();
  // Сначала посадим ему users doc с isAdmin:true, managedCourses.
  await e.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection('users').doc(uid).set({
      isAdmin: true, managedCourses: ['nm'], managedStudyGroups: [], managedGroups: []
    });
  });
  return e.authenticatedContext(uid, { email: 'admin-nm@test.ru', email_verified: true }).firestore();
}
export async function asAdminSem2(uid = 'admin-sem2-uid') {
  const e = await getEnv();
  await e.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection('users').doc(uid).set({
      isAdmin: true, managedCourses: ['sem2'], managedStudyGroups: [], managedGroups: []
    });
  });
  return e.authenticatedContext(uid, { email: 'admin-sem2@test.ru', email_verified: true }).firestore();
}
export async function asStudent(uid = 'stu-uid', opts = {}) {
  const e = await getEnv();
  const verified = opts.verified !== false;
  const email = opts.email || (uid + '@test.ru');
  await e.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection('users').doc(uid).set({
      email, fio: opts.fio || 'Test Student', studyGroup: opts.studyGroup || 'Б22-505',
      courseGroups: opts.courseGroups || {},
      ...(opts.userDoc || {})
    });
  });
  return e.authenticatedContext(uid, { email, email_verified: verified }).firestore();
}
export function asAnon() {
  return getEnv().then(e => e.unauthenticatedContext().firestore());
}

// --- Хелперы записи в обход правил (для сидинга) --------------------
export async function seed(fn) {
  const e = await getEnv();
  await e.withSecurityRulesDisabled(async ctx => {
    await fn(ctx.firestore());
  });
}

export { assertSucceeds, assertFails };
