// ============================================================
// CFDQuiz — тесты с выбором ответа: сеанс, таймер, сбор ответов
// ------------------------------------------------------------
// Вопросы НЕ лежат в репозитории: их загружает преподаватель (админка,
// вкладка «Тесты», или tools/quiz_upload.py) в документ сеанса. По правилам
// студент читает сеанс (а значит, и вопросы), только пока тест открыт и его
// uid в списке допущенных. Ключ ответов — отдельный документ, читает admin
// курса; студенту — только после того, как преподаватель включит «показать
// ответы». Время ответа ограничивает сервер: правило запрещает менять попытку
// позже startedAt + durationSec (+15 с на сеть).
//
// Модель Firestore:
//   quiz_sessions/{cid}_{qid} = { courseId, quizId, title, durationSec,
//                                 questions: [{ text, options: [..] }],
//                                 open, allowedUids, showAnswers,
//                                 attendanceId, openedAt, closedAt, updatedAt }
//   quiz_keys/{cid}_{qid}     = { answers: [индекс верного варианта], explanations: [..] }
//   quiz_attempts/{uid}_{cid}_{qid} = { uid, courseId, quizId, email,
//                                 startedAt, answers: { "номер вопроса": индекс варианта },
//                                 submitted, submittedAt, updatedAt }
//
// Реестр тестов: window.CFD_QUIZZES (js/courses.js).
// ============================================================
(function () {
  "use strict";
  if (typeof firebase === "undefined" || typeof firebaseConfig === "undefined") return;
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const auth = firebase.auth();
  const nowTs = () => firebase.firestore.FieldValue.serverTimestamp();
  const sid = (cid, qid) => cid + "_" + qid;
  const aid = (uid, cid, qid) => uid + "_" + cid + "_" + qid;

  // Перемешивание, одинаковое для одного студента при перезагрузке страницы.
  function seeded(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return function () { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return h / 4294967296; };
  }
  function permutation(n, seed) {
    const rnd = seeded(seed), a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  const API = {
    quizzesOf: function (cid) { return (window.CFD_QUIZZES && window.CFD_QUIZZES[cid]) || []; },
    quizInfo: function (cid, qid) { return API.quizzesOf(cid).find(q => q.id === qid) || { id: qid, title: qid }; },
    permutation: permutation,

    // Балл попытки по ключу: { score, total, marks: [true|false|null] }.
    score: function (attempt, key) {
      const ans = (attempt && attempt.answers) || {}, right = (key && key.answers) || [];
      const marks = right.map((r, i) => (ans[i] == null ? null : Number(ans[i]) === Number(r)));
      return { score: marks.filter(m => m === true).length, total: right.length, marks: marks };
    },

    // ---- сеанс (admin) ----
    getSession: async function (cid, qid) {
      try { const d = await db.collection("quiz_sessions").doc(sid(cid, qid)).get(); return d.exists ? d.data() : null; }
      catch (e) { return null; }
    },
    watchSession: function (cid, qid, cb) {
      return db.collection("quiz_sessions").doc(sid(cid, qid)).onSnapshot(d => cb(d.exists ? d.data() : null), () => cb(null));
    },
    getKey: async function (cid, qid) {
      try { const d = await db.collection("quiz_keys").doc(sid(cid, qid)).get(); return d.exists ? d.data() : null; }
      catch (e) { return null; }
    },
    // data = { title, durationSec, questions: [{text, options}], answers: [..], explanations: [..] }
    upload: async function (cid, qid, data) {
      const me = auth.currentUser; if (!me) return { ok: false, error: "Не авторизован" };
      const qs = data.questions || [], ans = data.answers || [];
      if (!qs.length || qs.length !== ans.length) return { ok: false, error: "число вопросов и ответов не совпадает" };
      for (let i = 0; i < qs.length; i++) {
        if (!qs[i].text || !Array.isArray(qs[i].options) || qs[i].options.length < 2) return { ok: false, error: "вопрос " + (i + 1) + ": нет текста или вариантов" };
        if (!(ans[i] >= 0 && ans[i] < qs[i].options.length)) return { ok: false, error: "вопрос " + (i + 1) + ": номер верного варианта вне списка" };
      }
      try {
        const b = db.batch();
        b.set(db.collection("quiz_sessions").doc(sid(cid, qid)), {
          courseId: cid, quizId: qid, title: data.title || qid, durationSec: Number(data.durationSec) || 900,
          questions: qs.map(q => ({ text: String(q.text), options: q.options.map(String) })),
          updatedAt: nowTs(), updatedBy: me.email,
        }, { merge: true });
        b.set(db.collection("quiz_keys").doc(sid(cid, qid)), {
          answers: ans.map(Number), explanations: (data.explanations || []).map(String), updatedAt: nowTs(), updatedBy: me.email,
        });
        await b.commit();
        return { ok: true, n: qs.length };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    openSession: async function (cid, qid, allowedUids, extra) {
      const me = auth.currentUser; if (!me) return { ok: false, error: "Не авторизован" };
      try {
        await db.collection("quiz_sessions").doc(sid(cid, qid)).set(Object.assign({
          courseId: cid, quizId: qid, open: true, showAnswers: false,
          allowedUids: Array.from(new Set(allowedUids || [])),
          openedAt: nowTs(), openedBy: me.email, closedAt: null, updatedAt: nowTs(),
        }, extra || {}), { merge: true });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    setSession: async function (cid, qid, fields) {
      const me = auth.currentUser; if (!me) return { ok: false, error: "Не авторизован" };
      try {
        await db.collection("quiz_sessions").doc(sid(cid, qid)).set(Object.assign({ courseId: cid, quizId: qid, updatedAt: nowTs(), updatedBy: me.email }, fields), { merge: true });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    closeSession: function (cid, qid) { return API.setSession(cid, qid, { open: false, closedAt: nowTs() }); },
    watchAttempts: function (cid, qid, cb) {
      return db.collection("quiz_attempts").where("courseId", "==", cid).where("quizId", "==", qid)
        .onSnapshot(s => { const out = {}; s.forEach(d => { out[d.data().uid] = d.data(); }); cb(out); },
                    e => { console.warn("watchAttempts", e); cb({}); });
    },
    resetAttempt: async function (uid, cid, qid) {
      try { await db.collection("quiz_attempts").doc(aid(uid, cid, qid)).delete(); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    },

    // ---- студент ----
    attemptRef: function (uid, cid, qid) { return db.collection("quiz_attempts").doc(aid(uid, cid, qid)); },
    start: async function (user, cid, qid) {
      const ref = API.attemptRef(user.uid, cid, qid);
      await ref.set({ uid: user.uid, courseId: cid, quizId: qid, email: user.email || "",
                      startedAt: nowTs(), updatedAt: nowTs(), answers: {}, submitted: false });
      return (await ref.get()).data();
    },
    // Пробная запись: заодно даёт серверное время (смещение часов) и проверяет, не истёк ли срок.
    touch: async function (user, cid, qid) {
      const ref = API.attemptRef(user.uid, cid, qid);
      await ref.update({ updatedAt: nowTs() });
      return (await ref.get()).data();
    },
    saveAnswer: function (user, cid, qid, qi, opt) {
      const upd = { updatedAt: nowTs() }; upd["answers." + qi] = opt;
      return API.attemptRef(user.uid, cid, qid).update(upd);
    },
    submit: function (user, cid, qid) {
      return API.attemptRef(user.uid, cid, qid).update({ submitted: true, submittedAt: nowTs(), updatedAt: nowTs() });
    },
  };

  window.CFDQuiz = API;
})();
