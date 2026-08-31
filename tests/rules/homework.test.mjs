// Сценарий: выкладывание ДЗ (assignments) и сдача (submissions),
// в т.ч. строгий дедлайн.
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import {
  getEnv, clear, cleanup, seed, asSuper, asAdminNm, asAdminSem2, asStudent,
  assertSucceeds, assertFails,
} from './setup.mjs';

beforeAll(async () => { await getEnv(); });
afterAll(async () => { await cleanup(); });
beforeEach(async () => { await clear(); });

describe('assignments — создание', () => {
  it('student НЕ создаёт assignment', async () => {
    const db = await asStudent('s1');
    await assertFails(setDoc(doc(db, 'assignments', 'hw1'), {
      courseId: 'nm', title: 'ДЗ 1', mode: 'common',
    }));
  });
  it('курсовой admin[nm] создаёт nm, но НЕ sem2', async () => {
    const db = await asAdminNm();
    await assertSucceeds(setDoc(doc(db, 'assignments', 'hw-nm-1'), {
      courseId: 'nm', title: 'ДЗ 1', mode: 'common',
    }));
    await assertFails(setDoc(doc(db, 'assignments', 'hw-sem2-1'), {
      courseId: 'sem2', title: 'ДЗ 1', mode: 'common',
    }));
  });
  it('super создаёт любой', async () => {
    const db = await asSuper();
    await assertSucceeds(setDoc(doc(db, 'assignments', 'hw-sph-1'), {
      courseId: 'sph', title: 'ДЗ 1', mode: 'common',
    }));
  });
});

describe('assignments — удаление/обновление', () => {
  it('admin другого курса не удаляет', async () => {
    await seed(async db => {
      await db.collection('assignments').doc('hw-nm-x').set({
        courseId: 'nm', title: 'X', mode: 'common',
      });
    });
    const other = await asAdminSem2();
    await assertFails(deleteDoc(doc(other, 'assignments', 'hw-nm-x')));
    const own = await asAdminNm();
    await assertSucceeds(deleteDoc(doc(own, 'assignments', 'hw-nm-x')));
  });
});

describe('submissions — студент сдаёт', () => {
  beforeEach(async () => {
    await seed(async db => {
      await db.collection('assignments').doc('hw1').set({
        courseId: 'nm', title: 'ДЗ 1', mode: 'common', strictDeadline: false,
      });
      await db.collection('assignments').doc('hw-strict').set({
        courseId: 'nm', title: 'Deadline!', mode: 'common',
        strictDeadline: true,
        deadlineAt: Timestamp.fromDate(new Date(Date.now() - 60_000)), // минуту назад
      });
    });
  });

  it('свой сабмит — успех', async () => {
    const db = await asStudent('s2');
    await assertSucceeds(setDoc(doc(db, 'submissions', 'hw1_s2'), {
      assignmentId: 'hw1', uid: 's2', courseId: 'nm',
      files: [], submittedAt: new Date(),
    }));
  });

  it('за другого студента — нельзя', async () => {
    const db = await asStudent('s3');
    await assertFails(setDoc(doc(db, 'submissions', 'hw1_someone'), {
      assignmentId: 'hw1', uid: 'someone', courseId: 'nm', files: [],
    }));
  });

  it('без verified — нельзя', async () => {
    const db = await asStudent('s4', { verified: false });
    await assertFails(setDoc(doc(db, 'submissions', 'hw1_s4'), {
      assignmentId: 'hw1', uid: 's4', courseId: 'nm', files: [],
    }));
  });

  it('строгий дедлайн истёк → сдача отклонена', async () => {
    const db = await asStudent('s5');
    await assertFails(setDoc(doc(db, 'submissions', 'hw-strict_s5'), {
      assignmentId: 'hw-strict', uid: 's5', courseId: 'nm', files: [],
    }));
  });

  it('нестрогий дедлайн — сдача принимается даже сильно позже', async () => {
    await seed(async db => {
      await db.collection('assignments').doc('hw-soft').set({
        courseId: 'nm', title: 'Soft', mode: 'common', strictDeadline: false,
        deadlineAt: Timestamp.fromDate(new Date(Date.now() - 3600_000)),
      });
    });
    const db = await asStudent('s6');
    await assertSucceeds(setDoc(doc(db, 'submissions', 'hw-soft_s6'), {
      assignmentId: 'hw-soft', uid: 's6', courseId: 'nm', files: [],
    }));
  });
});

describe('submissions — чтение и админ', () => {
  // docId = {aid}_{uid}; для владельца s7 → 'hw_s7'.
  beforeEach(async () => {
    await seed(async db => {
      await db.collection('submissions').doc('hw_s7').set({
        assignmentId: 'hw', uid: 's7', courseId: 'nm', files: [],
      });
    });
  });

  it('студент читает только свой сабмит', async () => {
    const s7 = await asStudent('s7');
    await assertSucceeds(getDoc(doc(s7, 'submissions', 'hw_s7')));
    const other = await asStudent('other');
    await assertFails(getDoc(doc(other, 'submissions', 'hw_s7')));
  });

  it('admin курса читает и обновляет сабмит своего курса', async () => {
    const db = await asAdminNm();
    await assertSucceeds(getDoc(doc(db, 'submissions', 'hw_s7')));
    await assertSucceeds(updateDoc(doc(db, 'submissions', 'hw_s7'),
      { manualStatus: 'accepted', courseId: 'nm', assignmentId: 'hw', uid: 's7' }));
  });

  it('admin другого курса — нет', async () => {
    const db = await asAdminSem2();
    await assertFails(getDoc(doc(db, 'submissions', 'hw_s7')));
  });
});

describe('assignment_grades — оценки', () => {
  it('только admin курса ставит оценку', async () => {
    const s = await asStudent('s8');
    await assertFails(setDoc(doc(s, 'assignment_grades', 'hw_s8'), {
      assignmentId: 'hw', uid: 's8', courseId: 'nm', grade: 90,
    }));
    const admNm = await asAdminNm();
    await assertSucceeds(setDoc(doc(admNm, 'assignment_grades', 'hw_s8'), {
      assignmentId: 'hw', uid: 's8', courseId: 'nm', grade: 90,
    }));
    // Admin другого курса — нет.
    await seed(async db => {
      await db.collection('assignment_grades').doc('hw2_s9').set({
        assignmentId: 'hw2', uid: 's9', courseId: 'sem2', grade: 50,
      });
    });
    await assertFails(updateDoc(doc(admNm, 'assignment_grades', 'hw2_s9'), { grade: 80 }));
  });
});
