// ============================================================
// Attendance API — учёт посещаемости занятий
// ------------------------------------------------------------
// Модель Firestore:
//   attendance/{aid} = {
//     courseId:   'sem1',
//     studyGroup: 'Б22-505',           // учебная группа МИФИ
//     date:       Timestamp,           // дата и время занятия (МСК)
//     title:      'Лекция §1'          // опционально, тема
//     records:    { uid: 'present'|'excused'|'absent', ... },
//     createdBy:  email, createdByUid: uid,
//     createdAt:  serverTimestamp,
//     updatedAt:  serverTimestamp,
//   }
//
// Процент = present / (present + absent), «excused» не учитывается
// ни в числителе, ни в знаменателе.
// ============================================================

(function () {
  "use strict";

  if (typeof firebase === "undefined" || typeof firebaseConfig === "undefined") return;
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const auth = firebase.auth();

  function nowTs() { return firebase.firestore.FieldValue.serverTimestamp(); }

  function computePercentFromRecords(records) {
    let present = 0, absent = 0, excused = 0;
    for (const uid in (records || {})) {
      const s = records[uid];
      if (s === "present") present++;
      else if (s === "absent") absent++;
      else if (s === "excused") excused++;
    }
    const denom = present + absent;
    const percent = denom > 0 ? (present * 100 / denom) : null;
    return { present, absent, excused, percent };
  }

  window.CFDAttendance = {
    STATUSES: ["present", "excused", "absent"],
    STATUS_LABELS: { present: "пришёл", excused: "уваж.", absent: "прогул" },
    STATUS_COLORS: { present: "#3d6b5a", excused: "#8a6e2a", absent: "#b44a2d" },

    // Создать новое занятие.
    // data: { courseId, studyGroup, date (Date|string), title?, records? }
    create: async function (data) {
      const me = auth.currentUser;
      if (!me) return { ok: false, error: "Не авторизован" };
      try {
        let ts = null;
        if (data.date instanceof Date) ts = firebase.firestore.Timestamp.fromDate(data.date);
        else if (data.date) ts = firebase.firestore.Timestamp.fromDate(new Date(data.date));
        else ts = firebase.firestore.Timestamp.now();
        const ref = await db.collection("attendance").add({
          courseId:   data.courseId || "",
          studyGroup: data.studyGroup || "",
          date:       ts,
          title:      data.title || "",
          records:    data.records || {},
          createdBy:  me.email,
          createdByUid: me.uid,
          createdAt:  nowTs(),
          updatedAt:  nowTs(),
        });
        return { ok: true, aid: ref.id };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Обновить любые поля (обычно records — статусы студентов, title, date).
    update: async function (aid, patch) {
      try {
        const p = Object.assign({}, patch, { updatedAt: nowTs() });
        await db.collection("attendance").doc(aid).update(p);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Отметить одного студента (быстрый метод для UI).
    markOne: async function (aid, uid, status) {
      if (!["present", "excused", "absent"].includes(status)) {
        return { ok: false, error: "bad status" };
      }
      try {
        const patch = { updatedAt: nowTs() };
        patch["records." + uid] = status;
        await db.collection("attendance").doc(aid).update(patch);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Убрать студента из занятия.
    unmarkOne: async function (aid, uid) {
      try {
        const patch = { updatedAt: nowTs() };
        patch["records." + uid] = firebase.firestore.FieldValue.delete();
        await db.collection("attendance").doc(aid).update(patch);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    delete: async function (aid) {
      try {
        await db.collection("attendance").doc(aid).delete();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Все занятия по курсу — с сортировкой по дате desc. Кэша нет,
    // читаем каждый раз (объёмы небольшие: обычно ≤ 30 занятий/курс).
    listByCourse: async function (cid) {
      try {
        const snap = await db.collection("attendance")
          .where("courseId", "==", cid).get();
        const out = [];
        snap.forEach(d => out.push(Object.assign({ id: d.id }, d.data())));
        out.sort((a, b) => {
          const ta = a.date ? a.date.toMillis() : 0;
          const tb = b.date ? b.date.toMillis() : 0;
          return tb - ta;
        });
        return out;
      } catch (e) { console.warn("attendance.listByCourse:", e); return []; }
    },

    // Только по одной группе (для админской формы редактирования).
    listByCourseGroup: async function (cid, studyGroup) {
      const all = await this.listByCourse(cid);
      return all.filter(a => a.studyGroup === studyGroup);
    },

    // % студента по одному курсу (по всем занятиям, где он вообще
    // фигурирует в records: обычно это все занятия его группы).
    computeStudentPercent: async function (uid, cid) {
      const list = await this.listByCourse(cid);
      let present = 0, absent = 0, excused = 0, total = 0;
      for (const a of list) {
        const s = (a.records || {})[uid];
        if (!s) continue;
        total++;
        if (s === "present") present++;
        else if (s === "absent") absent++;
        else if (s === "excused") excused++;
      }
      const denom = present + absent;
      const percent = denom > 0 ? Math.round(present * 1000 / denom) / 10 : null;
      return { total, present, absent, excused, percent };
    },

    // Все проценты для текущего пользователя по каждому его курсу
    // (нужен список cids снаружи, обычно приходит из enrollments).
    getMyStatsForCourses: async function (cids) {
      const me = auth.currentUser;
      if (!me) return {};
      const out = {};
      for (const cid of (cids || [])) {
        out[cid] = await this.computeStudentPercent(me.uid, cid);
      }
      return out;
    },

    // Вспомогательное — то же, что computePercentFromRecords, но
    // публично, чтобы UI мог считать на лету.
    percentFromRecords: computePercentFromRecords,
  };
})();
