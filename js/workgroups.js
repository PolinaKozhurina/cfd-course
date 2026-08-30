// ============================================================
// Work Groups API — самосбор рабочих групп по курсу
// ------------------------------------------------------------
// Подключается ПОСЛЕ firebase-config.js, auth.js, courses.js.
// Модель — см. project_model_work_groups.md.
// ============================================================

(function () {
  "use strict";

  if (typeof firebase === "undefined" || typeof firebaseConfig === "undefined") return;
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const auth = firebase.auth();

  // 32-символьный безоднозначный алфавит (0/O/1/I/L убраны).
  const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  function randomCode(len) {
    let s = "";
    const buf = new Uint8Array(len);
    (crypto || window.crypto).getRandomValues(buf);
    for (let i = 0; i < len; i++) s += ALPHA[buf[i] % ALPHA.length];
    return s;
  }

  function fullGid(cid, nn) {
    return cid + "_group_" + nn;
  }

  async function isCodeUnique(code) {
    try {
      const s = await db.collection("groups").where("joinCode", "==", code).limit(1).get();
      return s.empty;
    } catch (_) { return true; } // если правила не дадут — не блокируем
  }

  async function generateUniqueCode() {
    for (let i = 0; i < 6; i++) {
      const c = randomCode(6);
      if (await isCodeUnique(c)) return c;
    }
    // fallback — 8 символов
    return randomCode(8);
  }

  window.CFDGroups = {
    // Создать новую рабочую группу по курсу. Автор становится старостой
    // (createdBy) и первым членом; получает 6-символьный код приглашения.
    // По умолчанию maxSize = 3 (2–3 человека).
    createGroup: async function (cid, opts) {
      opts = opts || {};
      const maxSize = Math.max(1, Math.min(10, opts.maxSize || 3));
      const name = (opts.name || "").trim();
      const u = auth.currentUser;
      if (!u) return { ok: false, error: "Не авторизован" };
      if (!u.emailVerified) return { ok: false, error: "Подтвердите email" };
      if (!cid) return { ok: false, error: "Не указан курс" };
      // Уже в группе по этому курсу?
      try {
        const uDoc = await db.collection("users").doc(u.uid).get();
        const cg = (uDoc.exists && uDoc.data().courseGroups) || {};
        if (cg[cid]) return { ok: false, error: "Вы уже состоите в группе по этому курсу — сначала «Покинуть»" };
      } catch (_) {}

      const code = await generateUniqueCode();
      // Ищем первый свободный номер 01..99
      for (let n = 1; n <= 99; n++) {
        const nn = String(n).padStart(2, "0");
        const gid = fullGid(cid, nn);
        try {
          await db.runTransaction(async function (tx) {
            const ref = db.collection("groups").doc(gid);
            const snap = await tx.get(ref);
            if (snap.exists) throw new Error("exists");
            const doc = {
              courseId: cid,
              groupIndex: nn,
              joinCode: code,
              members: [u.uid],
              maxSize: maxSize,
              createdBy: u.uid,
              approved: false,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            };
            if (name) doc.name = name;
            tx.set(ref, doc);
            const patch = {};
            patch["courseGroups." + cid] = "group_" + nn;
            tx.update(db.collection("users").doc(u.uid), patch);
          });
          return { ok: true, gid: gid, code: code, groupIndex: nn };
        } catch (e) {
          if (e && e.message === "exists") continue;
          return { ok: false, error: e.message || String(e) };
        }
      }
      return { ok: false, error: "Слишком много групп на курсе (>99)" };
    },

    // Присоединиться к группе по коду.
    joinByCode: async function (code) {
      const u = auth.currentUser;
      if (!u) return { ok: false, error: "Не авторизован" };
      if (!u.emailVerified) return { ok: false, error: "Подтвердите email" };
      code = (code || "").trim().toUpperCase();
      if (!code) return { ok: false, error: "Введите код" };
      try {
        const snap = await db.collection("groups").where("joinCode", "==", code).limit(1).get();
        if (snap.empty) return { ok: false, error: "Группа с таким кодом не найдена" };
        const doc = snap.docs[0];
        const gid = doc.id;
        const data = doc.data();
        const cid = data.courseId;
        if (!cid) return { ok: false, error: "У группы нет привязки к курсу" };
        const members = data.members || [];
        if (members.indexOf(u.uid) !== -1) return { ok: false, error: "Вы уже в этой группе" };
        if (members.length >= (data.maxSize || 3)) return { ok: false, error: "Группа заполнена" };
        // Уже в другой группе того же курса?
        try {
          const uDoc = await db.collection("users").doc(u.uid).get();
          const cg = (uDoc.exists && uDoc.data().courseGroups) || {};
          if (cg[cid]) return { ok: false, error: "Вы уже в другой группе по этому курсу — сначала «Покинуть»" };
        } catch (_) {}

        await db.runTransaction(async function (tx) {
          const ref = db.collection("groups").doc(gid);
          const s = await tx.get(ref);
          const cur = s.data() || {};
          const cm = cur.members || [];
          if (cm.indexOf(u.uid) !== -1) throw new Error("Вы уже в этой группе");
          if (cm.length >= (cur.maxSize || 3)) throw new Error("Группа заполнена");
          tx.update(ref, {
            members: firebase.firestore.FieldValue.arrayUnion(u.uid),
          });
          const nn = cur.groupIndex || gid.replace(/^.*_group_/, "");
          const patch = {};
          patch["courseGroups." + cid] = "group_" + nn;
          tx.set(db.collection("users").doc(u.uid), { courseGroups: {} }, { merge: true });
          tx.update(db.collection("users").doc(u.uid), patch);
        });
        return { ok: true, gid: gid, courseId: cid };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    },

    // Покинуть группу по курсу.
    leaveGroup: async function (cid) {
      const u = auth.currentUser;
      if (!u) return { ok: false, error: "Не авторизован" };
      try {
        // Найти свою группу по этому курсу
        const uDoc = await db.collection("users").doc(u.uid).get();
        const cg = (uDoc.exists && uDoc.data().courseGroups) || {};
        const nn = cg[cid];
        if (!nn) return { ok: false, error: "Вы не состоите в группе по этому курсу" };
        const gid = fullGid(cid, nn.replace(/^group_/, ""));
        await db.runTransaction(async function (tx) {
          const ref = db.collection("groups").doc(gid);
          const s = await tx.get(ref);
          if (s.exists) {
            tx.update(ref, {
              members: firebase.firestore.FieldValue.arrayRemove(u.uid),
            });
          }
          const patch = {};
          patch["courseGroups." + cid] = firebase.firestore.FieldValue.delete();
          tx.update(db.collection("users").doc(u.uid), patch);
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    },

    // Метаданные группы + список членов с ФИО (для UI).
    getGroupDetails: async function (cid) {
      const u = auth.currentUser;
      if (!u) return null;
      const uDoc = await db.collection("users").doc(u.uid).get();
      const cg = (uDoc.exists && uDoc.data().courseGroups) || {};
      const nn = cg[cid];
      if (!nn) return null;
      const gid = fullGid(cid, nn.replace(/^group_/, ""));
      const doc = await db.collection("groups").doc(gid).get();
      if (!doc.exists) return null;
      const data = doc.data();
      const members = [];
      for (const uid of (data.members || [])) {
        try {
          const ud = await db.collection("users").doc(uid).get();
          members.push({
            uid: uid,
            fio: ud.exists ? (ud.data().fio || ud.data().email) : uid,
            email: ud.exists ? ud.data().email : "",
            isStaroste: data.createdBy === uid,
          });
        } catch (_) { members.push({ uid: uid, fio: uid }); }
      }
      return {
        gid: gid,
        courseId: cid,
        groupIndex: data.groupIndex || nn.replace(/^group_/, ""),
        joinCode: data.joinCode,
        approved: !!data.approved,
        maxSize: data.maxSize || 3,
        name: data.name || "",
        createdBy: data.createdBy,
        members: members,
      };
    },
  };
})();
