// Сценарий: регистрация пользователя и назначение ролей (users/{uid}).
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import {
  getEnv, clear, cleanup, seed, asSuper, asAdminNm, asStudent, asAnon,
  assertSucceeds, assertFails,
} from './setup.mjs';

beforeAll(async () => { await getEnv(); });
afterAll(async () => { await cleanup(); });
beforeEach(async () => { await clear(); });

describe('users — регистрация', () => {
  it('anon не может создать чужой users doc', async () => {
    const db = await asAnon();
    await assertFails(setDoc(doc(db, 'users', 'x'), { fio: 'A' }));
  });

  it('auth создаёт свой без privileged полей', async () => {
    const { getEnv } = await import('./setup.mjs');
    const env = await getEnv();
    const db = env.authenticatedContext('newbie', { email: 'n@e.ru', email_verified: true }).firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'newbie'), { fio: 'Иванов' }));
  });

  it('auth НЕ может создать свой doc с isAdmin/managedCourses', async () => {
    const { getEnv } = await import('./setup.mjs');
    const env = await getEnv();
    const db = env.authenticatedContext('trickster', { email: 't@e.ru', email_verified: true }).firestore();
    await assertFails(setDoc(doc(db, 'users', 'trickster'), { fio: 'X', isAdmin: true }));
    await assertFails(setDoc(doc(db, 'users', 'trickster'), { fio: 'X', managedCourses: ['nm'] }));
    await assertFails(setDoc(doc(db, 'users', 'trickster'), { fio: 'X', approved: true }));
  });
});

describe('users — обновление', () => {
  it('student правит свои поля, но НЕ approved/isAdmin', async () => {
    await seed(async db => { await db.collection('users').doc('s1').set({ fio: 'Old', approved: false }); });
    const db = await asStudent('s1');
    await assertSucceeds(updateDoc(doc(db, 'users', 's1'), { fio: 'New', studyGroup: 'Б22-505' }));
    await assertFails(updateDoc(doc(db, 'users', 's1'), { approved: true }));
    await assertFails(updateDoc(doc(db, 'users', 's1'), { isAdmin: true }));
    await assertFails(updateDoc(doc(db, 'users', 's1'), { managedCourses: ['nm'] }));
  });

  it('курсовой admin ставит approved у чужого, но НЕ isAdmin/managedCourses', async () => {
    await seed(async db => {
      await db.collection('users').doc('victim').set({ fio: 'V', approved: false });
    });
    const db = await asAdminNm();
    await assertSucceeds(updateDoc(doc(db, 'users', 'victim'), { approved: true }));
    await assertFails(updateDoc(doc(db, 'users', 'victim'), { isAdmin: true }));
    await assertFails(updateDoc(doc(db, 'users', 'victim'), { managedCourses: ['sem2'] }));
  });

  it('super меняет что угодно у кого угодно', async () => {
    await seed(async db => { await db.collection('users').doc('other').set({ fio: 'O' }); });
    const db = await asSuper();
    await assertSucceeds(updateDoc(doc(db, 'users', 'other'),
      { isAdmin: true, managedCourses: ['nm', 'mke'], approved: true }));
  });
});

describe('users — удаление', () => {
  it('только super может удалить', async () => {
    await seed(async db => { await db.collection('users').doc('gone').set({ fio: 'G' }); });
    const stu = await asStudent('someone-else');
    await assertFails(deleteDoc(doc(stu, 'users', 'gone')));
    const adm = await asAdminNm();
    await assertFails(deleteDoc(doc(adm, 'users', 'gone')));
    const su = await asSuper();
    await assertSucceeds(deleteDoc(doc(su, 'users', 'gone')));
  });
});
