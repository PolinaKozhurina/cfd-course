// Сценарий: определение (сборка) рабочих групп — самосбор по коду, admin approve.
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import {
  getEnv, clear, cleanup, seed, asSuper, asAdminNm, asAdminSem2, asStudent,
  assertSucceeds, assertFails,
} from './setup.mjs';

beforeAll(async () => { await getEnv(); });
afterAll(async () => { await cleanup(); });
beforeEach(async () => { await clear(); });

describe('groups — создание', () => {
  it('verified student создаёт свою группу (единственный член = сам)', async () => {
    const db = await asStudent('s1');
    await assertSucceeds(setDoc(doc(db, 'groups', 'nm_group_01'), {
      courseId: 'nm', joinCode: 'ABC123', maxSize: 3,
      members: ['s1'], createdBy: 's1', approved: false,
      createdAt: new Date(),
    }));
  });

  it('нельзя создать группу за чужого (createdBy != свой uid)', async () => {
    const db = await asStudent('s2');
    await assertFails(setDoc(doc(db, 'groups', 'nm_group_02'), {
      courseId: 'nm', joinCode: 'x', maxSize: 3,
      members: ['other'], createdBy: 'other', approved: false,
    }));
  });

  it('нельзя создать сразу approved', async () => {
    const db = await asStudent('s3');
    await assertFails(setDoc(doc(db, 'groups', 'nm_group_03'), {
      courseId: 'nm', joinCode: 'y', maxSize: 3,
      members: ['s3'], createdBy: 's3', approved: true,
    }));
  });
});

describe('groups — вступление в группу (joinCode)', () => {
  beforeEach(async () => {
    await seed(async db => {
      await db.collection('groups').doc('nm_group_01').set({
        courseId: 'nm', joinCode: 'CODE1', maxSize: 3,
        members: ['host'], createdBy: 'host', approved: false,
      });
    });
  });

  it('чужой verified добавляет только себя (один uid), другие поля не трогает', async () => {
    const db = await asStudent('joiner');
    await assertSucceeds(updateDoc(doc(db, 'groups', 'nm_group_01'),
      { members: ['host', 'joiner'] }));
  });

  it('нельзя добавить сразу двух чужих', async () => {
    const db = await asStudent('joiner2');
    await assertFails(updateDoc(doc(db, 'groups', 'nm_group_01'),
      { members: ['host', 'joiner2', 'phantom'] }));
  });

  it('нельзя добавить чужого uid', async () => {
    const db = await asStudent('sneaky');
    await assertFails(updateDoc(doc(db, 'groups', 'nm_group_01'),
      { members: ['host', 'someone-else'] }));
  });
});

describe('groups — approve админом', () => {
  beforeEach(async () => {
    await seed(async db => {
      await db.collection('groups').doc('nm_group_02').set({
        courseId: 'nm', joinCode: 'X', maxSize: 3, members: ['h'], createdBy: 'h', approved: false,
      });
      await db.collection('groups').doc('sem2_group_02').set({
        courseId: 'sem2', joinCode: 'Y', maxSize: 3, members: ['h'], createdBy: 'h', approved: false,
      });
    });
  });

  it('курсовой admin[nm] approve свой курс, но НЕ чужой', async () => {
    const db = await asAdminNm();
    await assertSucceeds(updateDoc(doc(db, 'groups', 'nm_group_02'), { approved: true }));
    await assertFails(updateDoc(doc(db, 'groups', 'sem2_group_02'), { approved: true }));
  });

  it('super approve любой', async () => {
    const db = await asSuper();
    await assertSucceeds(updateDoc(doc(db, 'groups', 'nm_group_02'), { approved: true }));
    await assertSucceeds(updateDoc(doc(db, 'groups', 'sem2_group_02'), { approved: true }));
  });
});

describe('individual_grades — оценки по курсу', () => {
  it('курсовой admin ставит оценку по своему курсу', async () => {
    const db = await asAdminNm();
    await assertSucceeds(setDoc(doc(db, 'individual_grades', 's_nm'), {
      zachet: 45, exam: 40, comment: 'ok',
    }));
  });
  it('admin другого курса — нет', async () => {
    const db = await asAdminSem2();
    await assertFails(setDoc(doc(db, 'individual_grades', 's_nm'), {
      zachet: 45, exam: 40,
    }));
  });
  it('студент читает только свою оценку', async () => {
    await seed(async db => {
      await db.collection('individual_grades').doc('s10_nm').set({ zachet: 10, exam: 20 });
      await db.collection('individual_grades').doc('other_nm').set({ zachet: 30, exam: 40 });
    });
    const db = await asStudent('s10');
    await assertSucceeds(getDoc(doc(db, 'individual_grades', 's10_nm')));
    await assertFails(getDoc(doc(db, 'individual_grades', 'other_nm')));
  });
});
