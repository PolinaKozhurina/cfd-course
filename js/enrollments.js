// ============================================================
// Enrollments API — заявки студентов на курсы
// ------------------------------------------------------------
// Подключается ПОСЛЕ firebase-config.js и auth.js.
// Использует уже инициализированный firebase.
// ============================================================

(function () {
  "use strict";

  if (typeof firebase === "undefined" || typeof firebaseConfig === "undefined") return;
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const auth = firebase.auth();

  function docId(uid, courseId) {
    return uid + "_" + courseId;
  }

  window.CFDEnroll = {
    // Заявка на курс. Возвращает Promise<{ok:true}|{ok:false, error:string}>.
    request: async function (courseId) {
      const u = auth.currentUser;
      if (!u) return { ok: false, error: "Не авторизован" };
      if (!u.emailVerified) return { ok: false, error: "Сначала подтвердите email" };
      try {
        await db.collection("enrollments").doc(docId(u.uid, courseId)).set({
          uid: u.uid,
          courseId: courseId,
          status: "pending",
          requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    // Отмена своей заявки, пока она в pending.
    cancel: async function (courseId) {
      const u = auth.currentUser;
      if (!u) return { ok: false, error: "Не авторизован" };
      try {
        await db.collection("enrollments").doc(docId(u.uid, courseId)).delete();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    // Переподача после rejected: status → pending.
    reapply: async function (courseId) {
      const u = auth.currentUser;
      if (!u) return { ok: false, error: "Не авторизован" };
      try {
        await db.collection("enrollments").doc(docId(u.uid, courseId)).update({
          status: "pending",
          requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    // Все свои заявки. { courseId: {status, requestedAt, ...} }
    listMine: async function () {
      const u = auth.currentUser;
      if (!u) return {};
      try {
        const snap = await db.collection("enrollments")
          .where("uid", "==", u.uid).get();
        const map = {};
        snap.forEach(function (d) { map[d.data().courseId] = d.data(); });
        return map;
      } catch (e) {
        console.warn("enrollments.listMine failed:", e);
        return {};
      }
    },

    // Все заявки (для админки). Опционально фильтр по массиву курсов.
    listAll: async function (courseIds) {
      try {
        let q = db.collection("enrollments");
        if (Array.isArray(courseIds) && courseIds.length > 0 && courseIds.length <= 10) {
          q = q.where("courseId", "in", courseIds);
        }
        const snap = await q.get();
        const out = [];
        snap.forEach(function (d) { out.push({ id: d.id, ...d.data() }); });
        return out;
      } catch (e) {
        console.warn("enrollments.listAll failed:", e);
        return [];
      }
    },

    // Admin: одобрить.
    approve: async function (uid, courseId) {
      const me = auth.currentUser;
      try {
        await db.collection("enrollments").doc(docId(uid, courseId)).update({
          status: "approved",
          decidedAt: firebase.firestore.FieldValue.serverTimestamp(),
          decidedBy: me ? me.email : null,
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    // Admin: отклонить.
    reject: async function (uid, courseId, reason) {
      const me = auth.currentUser;
      try {
        await db.collection("enrollments").doc(docId(uid, courseId)).update({
          status: "rejected",
          reason: reason || "",
          decidedAt: firebase.firestore.FieldValue.serverTimestamp(),
          decidedBy: me ? me.email : null,
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  };
})();
