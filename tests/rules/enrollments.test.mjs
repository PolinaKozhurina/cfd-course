// Сценарий: студент подаёт заявку на курс, admin курса аппрувит/реджектит.
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import {
  getEnv, clear, cleanup, seed, asSuper, asAdminNm, asAdminSem2, asStudent,
  assertSucceeds, assertFails,
} from './setup.mjs';

beforeAll(async () => { await getEnv(); });
afterAll(async () => { await cleanup(); });
beforeEach(async () => { await clear(); });

describe('enrollments — заявка студента', () => {
  it('студент подаёт со своим uid, статусом pending', async () => {
    const db = await asStudent('stu1');
    const key = 'stu1_nm';
    await assertSucceeds(setDoc(doc(db, 'enrollments', key), {
      uid: 'stu1', courseId: 'nm', status: 'pending', requestedAt: new Date(),
    }));
  });

  it('студент НЕ может подать за другого', async () => {
    const db = await asStudent('stu2');
    const key = 'other_nm';
    await assertFails(setDoc(doc(db, 'enrollments', key), {
      uid: 'other', courseId: 'nm', status: 'pending',
    }));
  });

  it('студент не может создать сразу approved', async () => {
    const db = await asStudent('stu3');
    const key = 'stu3_nm';
    await assertFails(setDoc(doc(db, 'enrollments', key), {
      uid: 'stu3', courseId: 'nm', status: 'approved',
    }));
  });

  it('студент без verified — не может', async () => {
    const db = await asStudent('stu4', { verified: false });
    await assertFails(setDoc(doc(db, 'enrollments', 'stu4_nm'), {
      uid: 'stu4', courseId: 'nm', status: 'pending',
    }));
  });
});

describe('enrollments — approve/reject', () => {
  beforeEach(async () => {
    await seed(async db => {
      await db.collection('enrollments').doc('s5_nm').set({
        uid: 's5', courseId: 'nm', status: 'pending', requestedAt: new Date(),
      });
      await db.collection('enrollments').doc('s5_sem2').set({
        uid: 's5', courseId: 'sem2', status: 'pending', requestedAt: new Date(),
      });
    });
  });

  it('курсовой admin[nm] аппрувит nm, но НЕ sem2', async () => {
    const db = await asAdminNm();
    await assertSucceeds(updateDoc(doc(db, 'enrollments', 's5_nm'), { status: 'approved' }));
    await assertFails(updateDoc(doc(db, 'enrollments', 's5_sem2'), { status: 'approved' }));
  });

  it('курсовой admin[sem2] аппрувит sem2, но НЕ nm', async () => {
    const db = await asAdminSem2();
    await assertSucceeds(updateDoc(doc(db, 'enrollments', 's5_sem2'), { status: 'approved' }));
    await assertFails(updateDoc(doc(db, 'enrollments', 's5_nm'), { status: 'approved' }));
  });

  it('super аппрувит любой', async () => {
    const db = await asSuper();
    await assertSucceeds(updateDoc(doc(db, 'enrollments', 's5_nm'), { status: 'approved' }));
    await assertSucceeds(updateDoc(doc(db, 'enrollments', 's5_sem2'), { status: 'rejected' }));
  });

  it('другой студент НЕ может аппрувить', async () => {
    const db = await asStudent('random');
    await assertFails(updateDoc(doc(db, 'enrollments', 's5_nm'), { status: 'approved' }));
  });
});

describe('enrollments — переподача после reject', () => {
  it('студент переподаёт свой rejected → pending', async () => {
    await seed(async db => {
      await db.collection('enrollments').doc('s6_nm').set({
        uid: 's6', courseId: 'nm', status: 'rejected',
      });
    });
    const db = await asStudent('s6');
    await assertSucceeds(updateDoc(doc(db, 'enrollments', 's6_nm'),
      { status: 'pending', uid: 's6', courseId: 'nm' }));
  });
});

describe('enrollments — удаление', () => {
  it('студент отзывает свою pending; approved — не удаляет', async () => {
    await seed(async db => {
      await db.collection('enrollments').doc('s7_nm').set({
        uid: 's7', courseId: 'nm', status: 'pending',
      });
      await db.collection('enrollments').doc('s7_sem2').set({
        uid: 's7', courseId: 'sem2', status: 'approved',
      });
    });
    const db = await asStudent('s7');
    await assertSucceeds(deleteDoc(doc(db, 'enrollments', 's7_nm')));
    await assertFails(deleteDoc(doc(db, 'enrollments', 's7_sem2')));
  });
});
