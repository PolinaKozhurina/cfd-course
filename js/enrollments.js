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
      // Firebase кэширует ID-токен ~1 час. Если пользователь подтвердил
      // email в этой сессии, поле email_verified в токене всё ещё старое
      // и правила Firestore (isVerified смотрит на token.email_verified)
      // отбивают запрос как permission-denied. Форсируем обновление токена.
      try { await u.reload(); await u.getIdToken(true); } catch (_) {}
      if (!u.emailVerified) return { ok: false, error: "Сначала подтвердите email (ссылка в письме), затем обновите страницу" };
      try {
        await db.collection("enrollments").doc(docId(u.uid, courseId)).set({
          uid: u.uid,
          courseId: courseId,
          status: "pending",
          requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        return { ok: true };
      } catch (e) {
        const raw = e.message || "";
        if ((e.code || '').indexOf('permission') !== -1 || /Missing or insufficient permissions/i.test(raw)) {
          return { ok: false, error: "Заявка отклонена правилами базы. Скорее всего email ещё не подтверждён — проверьте письмо и обновите страницу." };
        }
        return { ok: false, error: raw };
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
    // Раньше делали where('uid','==',uid).get() — но firestore.rules
    // разрешает read enrollments только per-doc (по ключу), а не по
    // list-query, поэтому query падал permission-denied → возвращали
    // пустой map, и после request() кнопка «Отправлено» не обновлялась.
    // Идём per-course, каждый doc отдельно — гарантированно проходит.
    listMine: async function () {
      const u = auth.currentUser;
      if (!u) return {};
      const courses = (window.CFD_COURSES || []).map(function (c) { return c.id; });
      const map = {};
      await Promise.all(courses.map(async function (cid) {
        try {
          const d = await db.collection("enrollments").doc(u.uid + "_" + cid).get();
          if (d.exists) map[cid] = d.data();
        } catch (_) {}
      }));
      return map;
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
