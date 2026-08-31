// Сценарий: Firebase Storage — файлы ДЗ (условия и сдачи студентов).
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
import {
  getEnv, cleanup, seed, asSuper, asAdminNm, asAdminSem2, asStudent, asAnon,
  assertSucceeds, assertFails,
} from './setup.mjs';

// Пользовательский users doc должен существовать (isMemberOfGroup/isAdmin
// используют firestore.get(users/{uid})). asStudent/asAdminNm его сажают.
async function stgAsStudent(uid, opts = {}) {
  const db = await asStudent(uid, opts);
  const env = await getEnv();
  return env.authenticatedContext(uid, {
    email: opts.email || (uid + '@test.ru'),
    email_verified: opts.verified !== false,
  }).storage();
}
async function stgAsAdminNm(uid = 'admin-nm-uid') {
  await asAdminNm(uid); // сажает users doc
  const env = await getEnv();
  return env.authenticatedContext(uid, { email: 'admin-nm@test.ru', email_verified: true }).storage();
}
async function stgAsAdminSem2(uid = 'admin-sem2-uid') {
  await asAdminSem2(uid);
  const env = await getEnv();
  return env.authenticatedContext(uid, { email: 'admin-sem2@test.ru', email_verified: true }).storage();
}
async function stgAsSuper() {
  await asSuper(); // сажает нужный контекст в firestore не требуется
  const env = await getEnv();
  return env.authenticatedContext('super-uid', {
    email: 'polinakozhurina2020@gmail.com', email_verified: true,
  }).storage();
}
async function stgAsAnon() {
  const env = await getEnv();
  return env.unauthenticatedContext().storage();
}

const bytes = () => new Uint8Array([1, 2, 3, 4]);

beforeAll(async () => { await getEnv(); });
afterAll(async () => { await cleanup(); });
beforeEach(async () => {
  const env = await getEnv();
  await env.clearFirestore();
  await env.clearStorage();
});

describe('storage: homework/{cid}/{aid}/common — условия ДЗ', () => {
  it('anon не читает и не пишет', async () => {
    const s = await stgAsAnon();
    await assertFails(uploadBytes(ref(s, 'homework/nm/hw1/common/task.pdf'), bytes()));
    await assertFails(getBytes(ref(s, 'homework/nm/hw1/common/task.pdf')));
  });
  it('любой auth читает', async () => {
    // Сидим файл через admin, потом читает студент.
    const adm = await stgAsAdminNm();
    await assertSucceeds(uploadBytes(ref(adm, 'homework/nm/hw1/common/task.pdf'), bytes()));
    const stu = await stgAsStudent('reader');
    await assertSucceeds(getBytes(ref(stu, 'homework/nm/hw1/common/task.pdf')));
  });
  it('student писать не может', async () => {
    const s = await stgAsStudent('s1');
    await assertFails(uploadBytes(ref(s, 'homework/nm/hw1/common/task.pdf'), bytes()));
  });
  it('admin[nm] пишет nm/*, но НЕ sem2/*', async () => {
    const adm = await stgAsAdminNm();
    await assertSucceeds(uploadBytes(ref(adm, 'homework/nm/hw1/common/a.pdf'), bytes()));
    await assertFails(uploadBytes(ref(adm, 'homework/sem2/hw1/common/b.pdf'), bytes()));
  });
  it('super пишет любой курс', async () => {
    const s = await stgAsSuper();
    await assertSucceeds(uploadBytes(ref(s, 'homework/sph/hw1/common/c.pdf'), bytes()));
  });
});

describe('storage: homework/{cid}/{aid}/{uid} — сдача студента', () => {
  it('свой uid + verified + admin другого курса читать не может', async () => {
    const own = await stgAsStudent('s2');
    await assertSucceeds(uploadBytes(ref(own, 'homework/nm/hw1/s2/solution.pdf'), bytes()));
    // Сам читает
    await assertSucceeds(getBytes(ref(own, 'homework/nm/hw1/s2/solution.pdf')));
    // Другой студент не читает
    const other = await stgAsStudent('other');
    await assertFails(getBytes(ref(other, 'homework/nm/hw1/s2/solution.pdf')));
    // Admin[nm] читает (свой курс)
    const adm = await stgAsAdminNm();
    await assertSucceeds(getBytes(ref(adm, 'homework/nm/hw1/s2/solution.pdf')));
    // Admin[sem2] — нет
    const admOther = await stgAsAdminSem2();
    await assertFails(getBytes(ref(admOther, 'homework/nm/hw1/s2/solution.pdf')));
  });
  it('нельзя записать за другого', async () => {
    const s = await stgAsStudent('s3');
    await assertFails(uploadBytes(ref(s, 'homework/nm/hw1/other/solution.pdf'), bytes()));
  });
  it('без verified — записать нельзя', async () => {
    const s = await stgAsStudent('s4', { verified: false });
    await assertFails(uploadBytes(ref(s, 'homework/nm/hw1/s4/solution.pdf'), bytes()));
  });
  it('удалить может сам студент и admin курса', async () => {
    const own = await stgAsStudent('s5');
    await assertSucceeds(uploadBytes(ref(own, 'homework/nm/hw2/s5/sol.pdf'), bytes()));
    const other = await stgAsStudent('outsider');
    await assertFails(deleteObject(ref(other, 'homework/nm/hw2/s5/sol.pdf')));
    await assertSucceeds(deleteObject(ref(own, 'homework/nm/hw2/s5/sol.pdf')));
    // admin[nm] тоже может (для admin — новый файл)
    await assertSucceeds(uploadBytes(ref(own, 'homework/nm/hw2/s5/sol.pdf'), bytes()));
    const adm = await stgAsAdminNm();
    await assertSucceeds(deleteObject(ref(adm, 'homework/nm/hw2/s5/sol.pdf')));
  });
});

describe('storage: закрытые пути', () => {
  it('произвольный путь /misc/anywhere — deny всем', async () => {
    const s = await stgAsStudent('s6');
    await assertFails(uploadBytes(ref(s, 'misc/anywhere/file.txt'), bytes()));
    const adm = await stgAsAdminNm();
    await assertFails(uploadBytes(ref(adm, 'misc/anywhere/file.txt'), bytes()));
  });
});
