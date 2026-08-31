// Сценарий: комментарии под лекциями (плоская коллекция comments/{docId}).
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import {
  getEnv, clear, cleanup, asSuper, asAdminNm, asStudent, asAnon,
  assertSucceeds, assertFails,
} from './setup.mjs';

beforeAll(async () => { await getEnv(); });
afterAll(async () => { await cleanup(); });
beforeEach(async () => { await clear(); });

const validPayload = (uid, extra = {}) => ({
  page: 'nm/w01.html', text: 'Классная лекция',
  authorEmail: uid + '@test.ru', authorFio: 'ФИО', authorUid: uid,
  authorRole: 'student', createdAt: new Date(),
  ...extra,
});

describe('comments', () => {
  it('anon читать/писать не может', async () => {
    const db = await asAnon();
    await assertFails(getDoc(doc(db, 'comments', 'x')));
    await assertFails(setDoc(doc(db, 'comments', 'x'), validPayload('anon')));
  });

  it('student с подтв. email пишет свой (authorUid=свой uid) и читает', async () => {
    const db = await asStudent('stu1');
    await assertSucceeds(setDoc(doc(db, 'comments', 'c1'), validPayload('stu1')));
    await assertSucceeds(getDoc(doc(db, 'comments', 'c1')));
  });

  it('student без подтв. email — писать нельзя (isVerified false)', async () => {
    const db = await asStudent('stu2', { verified: false });
    await assertFails(setDoc(doc(db, 'comments', 'c1'), validPayload('stu2')));
  });

  it('student НЕ может создать комментарий с чужим authorUid', async () => {
    const db = await asStudent('stu3');
    await assertFails(setDoc(doc(db, 'comments', 'c1'), validPayload('someone-else')));
  });

  it('student правит только свой (нельзя менять authorUid, нельзя чужой)', async () => {
    // Сидим два комментария: свой stu4 и чужой stu5.
    const { seed } = await import('./setup.mjs');
    await seed(async db => {
      await db.collection('comments').doc('c-mine').set(validPayload('stu4'));
      await db.collection('comments').doc('c-other').set(validPayload('stu5'));
    });
    const db = await asStudent('stu4');
    await assertSucceeds(updateDoc(doc(db, 'comments', 'c-mine'), { text: 'edit' }));
    await assertFails(updateDoc(doc(db, 'comments', 'c-mine'), { authorUid: 'someone' }));
    await assertFails(updateDoc(doc(db, 'comments', 'c-other'), { text: 'hack' }));
  });

  it('удалить может сам автор или admin (не любой user)', async () => {
    const { seed } = await import('./setup.mjs');
    await seed(async db => {
      await db.collection('comments').doc('c1').set(validPayload('stu6'));
    });
    const other = await asStudent('stu7');
    await assertFails(deleteDoc(doc(other, 'comments', 'c1')));
    const author = await asStudent('stu6');
    await assertSucceeds(deleteDoc(doc(author, 'comments', 'c1')));
    // admin тоже может — пересидим и удалим админом.
    await seed(async db => {
      await db.collection('comments').doc('c2').set(validPayload('stu8'));
    });
    const admin = await asAdminNm();
    await assertSucceeds(deleteDoc(doc(admin, 'comments', 'c2')));
  });
});
