// Сценарий: гейтинг лекций — открыть/закрыть/расписание (lectures/{cid}_{lec}).
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import {
  getEnv, clear, cleanup, seed, asSuper, asAdminNm, asAdminSem2, asStudent, asAnon,
  assertSucceeds, assertFails,
} from './setup.mjs';

beforeAll(async () => { await getEnv(); });
afterAll(async () => { await cleanup(); });
beforeEach(async () => { await clear(); });

const now = () => new Date();

describe('lectures — чтение', () => {
  it('anon НЕ читает', async () => {
    const db = await asAnon();
    await assertFails(getDoc(doc(db, 'lectures', 'nm_w01')));
  });
  it('любой auth читает (нужно для бейджей на главной)', async () => {
    await seed(async db => { await db.collection('lectures').doc('nm_w01').set({
      courseId: 'nm', lectureId: 'w01', releasedAt: now(),
    }); });
    const db = await asStudent('reader');
    await assertSucceeds(getDoc(doc(db, 'lectures', 'nm_w01')));
  });
});

describe('lectures — запись/удаление', () => {
  it('student НЕ может открыть/закрыть лекцию', async () => {
    const db = await asStudent('s1');
    await assertFails(setDoc(doc(db, 'lectures', 'nm_w01'), {
      courseId: 'nm', lectureId: 'w01', releasedAt: now(),
    }));
  });

  it('курсовой admin[nm] пишет свою nm/*, но НЕ sem2/*', async () => {
    const db = await asAdminNm();
    await assertSucceeds(setDoc(doc(db, 'lectures', 'nm_w01'), {
      courseId: 'nm', lectureId: 'w01', releasedAt: now(),
    }));
    await assertFails(setDoc(doc(db, 'lectures', 'sem2_flic'), {
      courseId: 'sem2', lectureId: 'flic', releasedAt: now(),
    }));
  });

  it('курсовой admin[sem2] пишет sem2/*, но НЕ nm/*', async () => {
    const db = await asAdminSem2();
    await assertSucceeds(setDoc(doc(db, 'lectures', 'sem2_flic'), {
      courseId: 'sem2', lectureId: 'flic', releasedAt: now(),
    }));
    await assertFails(setDoc(doc(db, 'lectures', 'nm_w01'), {
      courseId: 'nm', lectureId: 'w01', releasedAt: now(),
    }));
  });

  it('super пишет любую', async () => {
    const db = await asSuper();
    await assertSucceeds(setDoc(doc(db, 'lectures', 'sph_lab1'), {
      courseId: 'sph', lectureId: 'lab1', releasedAt: null,
    }));
  });

  it('закрыть (releasedAt=null) — тоже write, admin своего курса может', async () => {
    await seed(async db => {
      await db.collection('lectures').doc('nm_w02').set({
        courseId: 'nm', lectureId: 'w02', releasedAt: now(),
      });
    });
    const db = await asAdminNm();
    await assertSucceeds(setDoc(doc(db, 'lectures', 'nm_w02'), {
      courseId: 'nm', lectureId: 'w02', releasedAt: null,
    }));
  });

  it('удалить лекцию — только admin курса или super', async () => {
    await seed(async db => {
      await db.collection('lectures').doc('nm_w03').set({
        courseId: 'nm', lectureId: 'w03', releasedAt: now(),
      });
    });
    const stu = await asStudent('nope');
    await assertFails(deleteDoc(doc(stu, 'lectures', 'nm_w03')));
    const other = await asAdminSem2();
    await assertFails(deleteDoc(doc(other, 'lectures', 'nm_w03')));
    const own = await asAdminNm();
    await assertSucceeds(deleteDoc(doc(own, 'lectures', 'nm_w03')));
  });
});
