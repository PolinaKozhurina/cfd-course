// Сценарий: task_claims — кто какое индивидуальное задание взял.
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import {
  getEnv, clear, cleanup, seed, asAdminNm, asStudent,
  assertSucceeds, assertFails,
} from './setup.mjs';

beforeAll(async () => { await getEnv(); });
afterAll(async () => { await cleanup(); });
beforeEach(async () => { await clear(); });

describe('task_claims', () => {
  it('verified студент берёт задание за себя (uid == свой)', async () => {
    const db = await asStudent('s1');
    await assertSucceeds(setDoc(doc(db, 'task_claims', 't-1'), {
      uid: 's1', taskId: 1, claimedAt: new Date(),
    }));
  });

  it('без verified — нельзя', async () => {
    const db = await asStudent('s2', { verified: false });
    await assertFails(setDoc(doc(db, 'task_claims', 't-2'), {
      uid: 's2', taskId: 2,
    }));
  });

  it('за другого — нельзя (uid != свой)', async () => {
    const db = await asStudent('s3');
    await assertFails(setDoc(doc(db, 'task_claims', 't-3'), {
      uid: 'someone-else', taskId: 3,
    }));
  });

  it('читает любой auth (нужно, чтобы видеть занятые задания)', async () => {
    await seed(async db => {
      await db.collection('task_claims').doc('t-4').set({ uid: 's4', taskId: 4 });
    });
    const db = await asStudent('other');
    await assertSucceeds(getDoc(doc(db, 'task_claims', 't-4')));
  });

  it('обновить/удалить — только сам или admin, не любой user', async () => {
    await seed(async db => {
      await db.collection('task_claims').doc('t-5').set({ uid: 's5', taskId: 5 });
    });
    const other = await asStudent('other');
    await assertFails(deleteDoc(doc(other, 'task_claims', 't-5')));
    await assertFails(updateDoc(doc(other, 'task_claims', 't-5'), { taskId: 999 }));
    const own = await asStudent('s5');
    await assertSucceeds(updateDoc(doc(own, 'task_claims', 't-5'), { taskId: 6 }));
    await assertSucceeds(deleteDoc(doc(own, 'task_claims', 't-5')));
    // admin
    await seed(async db => {
      await db.collection('task_claims').doc('t-6').set({ uid: 's6', taskId: 6 });
    });
    const adm = await asAdminNm();
    await assertSucceeds(deleteDoc(doc(adm, 'task_claims', 't-6')));
  });
});
