// Сценарий: сообщения — групповой чат и личные (DM).
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import {
  getEnv, clear, cleanup, seed, asSuper, asAdminNm, asStudent,
  assertSucceeds, assertFails,
} from './setup.mjs';

beforeAll(async () => { await getEnv(); });
afterAll(async () => { await cleanup(); });
beforeEach(async () => { await clear(); });

// ----- Групповой чат: groups/{gid}/messages ----------------------------
// (это реальный путь, куда пишет js/checklist-sync.js. Отдельный
// плоский `chat/{gid}/messages/` в правилах остался legacy и клиентами
// не используется — тестировать его смысла нет.)
describe('groups/{gid}/messages — групповой чат', () => {
  const GID = 'nm_group_01';
  // Групповой doc нужен для существования — правило isMemberOfGroup
  // читает users, но не сам groups; тем не менее посадим для чистоты.
  beforeEach(async () => {
    await seed(async db => {
      await db.collection('groups').doc(GID).set({
        courseId: 'nm', joinCode: 'X', maxSize: 3,
        members: ['m1', 'm2'], createdBy: 'm1', approved: false,
      });
    });
  });
  // Сделать студента членом группы через users.courseGroups.
  async function memberStudent(uid) {
    return asStudent(uid, {
      courseGroups: { nm: 'group_01' },
    });
  }

  it('член группы пишет свой msg (authorUid=свой), другой — читает', async () => {
    const author = await memberStudent('m1');
    await assertSucceeds(setDoc(doc(author, 'groups', GID, 'messages', 'm-1'), {
      authorUid: 'm1', text: 'Привет', createdAt: new Date(),
    }));
    const reader = await memberStudent('m2');
    await assertSucceeds(getDoc(doc(reader, 'groups', GID, 'messages', 'm-1')));
  });

  it('не-член группы читать/писать не может', async () => {
    await seed(async db => {
      await db.collection('groups').doc(GID).collection('messages').doc('m-x').set({
        authorUid: 'm1', text: 'x',
      });
    });
    const outsider = await asStudent('outsider');
    await assertFails(getDoc(doc(outsider, 'groups', GID, 'messages', 'm-x')));
    await assertFails(setDoc(doc(outsider, 'groups', GID, 'messages', 'm-y'),
      { authorUid: 'outsider', text: 'hi' }));
  });

  it('член НЕ может писать с чужим authorUid', async () => {
    const db = await memberStudent('m3');
    await assertFails(setDoc(doc(db, 'groups', GID, 'messages', 'm-z'), {
      authorUid: 'someone-else', text: 'poser', createdAt: new Date(),
    }));
  });

  it('без verified — писать нельзя', async () => {
    const db = await asStudent('m4', {
      courseGroups: { nm: 'group_01' }, verified: false,
    });
    await assertFails(setDoc(doc(db, 'groups', GID, 'messages', 'm-w'), {
      authorUid: 'm4', text: 'x',
    }));
  });

  it('admin курса читает и пишет от своего имени', async () => {
    const db = await asAdminNm('admin-uid');
    await assertSucceeds(setDoc(doc(db, 'groups', GID, 'messages', 'm-adm'), {
      authorUid: 'admin-uid', text: 'anons', createdAt: new Date(),
    }));
    await assertSucceeds(getDoc(doc(db, 'groups', GID, 'messages', 'm-adm')));
  });

  it('удалить может автор или admin', async () => {
    await seed(async db => {
      await db.collection('groups').doc(GID).collection('messages').doc('m-del').set({
        authorUid: 'm5', text: 'del me',
      });
    });
    const other = await memberStudent('m6');
    await assertFails(deleteDoc(doc(other, 'groups', GID, 'messages', 'm-del')));
    const author = await memberStudent('m5');
    await assertSucceeds(deleteDoc(doc(author, 'groups', GID, 'messages', 'm-del')));
    // admin
    await seed(async db => {
      await db.collection('groups').doc(GID).collection('messages').doc('m-del2').set({
        authorUid: 'm7', text: 'x',
      });
    });
    const adm = await asAdminNm();
    await assertSucceeds(deleteDoc(doc(adm, 'groups', GID, 'messages', 'm-del2')));
  });
});

// ----- DM: dm/{dmId}/messages ------------------------------------------
describe('dm/{dmId}/messages — личные сообщения', () => {
  // dmId = sort([uidA,uidB]).join('_')
  const DM = 'alpha_beta';

  it('участник читает и пишет свой msg', async () => {
    const alpha = await asStudent('alpha');
    await assertSucceeds(setDoc(doc(alpha, 'dm', DM, 'messages', 'm1'), {
      authorUid: 'alpha', text: 'hi', createdAt: new Date(),
    }));
    const beta = await asStudent('beta');
    await assertSucceeds(getDoc(doc(beta, 'dm', DM, 'messages', 'm1')));
  });

  it('чужой не читает и не пишет', async () => {
    await seed(async db => {
      await db.collection('dm').doc(DM).collection('messages').doc('m1').set({
        authorUid: 'alpha', text: 'secret',
      });
    });
    const gamma = await asStudent('gamma');
    await assertFails(getDoc(doc(gamma, 'dm', DM, 'messages', 'm1')));
    await assertFails(setDoc(doc(gamma, 'dm', DM, 'messages', 'm2'),
      { authorUid: 'gamma', text: 'in' }));
  });

  it('участник НЕ может писать с чужим authorUid', async () => {
    const alpha = await asStudent('alpha');
    await assertFails(setDoc(doc(alpha, 'dm', DM, 'messages', 'm3'), {
      authorUid: 'beta', text: 'faked',
    }));
  });

  it('без verified — писать нельзя', async () => {
    const alpha = await asStudent('alpha', { verified: false });
    await assertFails(setDoc(doc(alpha, 'dm', DM, 'messages', 'm4'), {
      authorUid: 'alpha', text: 'x',
    }));
  });

  it('удалить может только сам автор (участие не даёт права удалять чужое)', async () => {
    await seed(async db => {
      await db.collection('dm').doc(DM).collection('messages').doc('m5').set({
        authorUid: 'alpha', text: 'x',
      });
    });
    const beta = await asStudent('beta');
    await assertFails(deleteDoc(doc(beta, 'dm', DM, 'messages', 'm5')));
    const alpha = await asStudent('alpha');
    await assertSucceeds(deleteDoc(doc(alpha, 'dm', DM, 'messages', 'm5')));
  });
});
