// ============================================================
// CFDLabs — закрытые лабораторные: сеансы, ключи, прогресс
// ------------------------------------------------------------
// Текст заданий лабы НЕ лежит в репозитории открыто: страница
// nm/wNN-lab.html содержит только шапку, а задания — в файле
// nm/wNN-lab.enc.json (AES-256-GCM). Ключ хранится в Firestore и по
// правилам читается только преподавателем курса или студентом, чей uid
// есть в списке допущенных ОТКРЫТОГО сеанса. Открывает/закрывает сеанс
// преподаватель кнопкой в админке (для отмеченных на занятии).
//
// Модель Firestore:
//   lab_sessions/{cid}_{lab} = { courseId, labId, open: bool,
//                                allowedUids: [uid…], attendanceId, title,
//                                openedAt, openedBy, closedAt, updatedAt }
//   lab_keys/{cid}_{lab}     = { key: base64(32 байта), updatedAt, updatedBy }
//   lab_progress/{uid}_{cid}_{lab} = { uid, courseId, labId,
//                                tasks: { taskId: 'ok'|'err' }, code: { editorId: text },
//                                done, total, updatedAt }
//
// Реестр лаб: window.CFD_LABS (js/courses.js).
// Зависит от firebase-*-compat + firebase-config.js.
// ============================================================
(function () {
  "use strict";
  if (typeof firebase === "undefined" || typeof firebaseConfig === "undefined") return;
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const auth = firebase.auth();
  const nowTs = () => firebase.firestore.FieldValue.serverTimestamp();
  const sid = (cid, lab) => cid + "_" + lab;
  const pid = (uid, cid, lab) => uid + "_" + cid + "_" + lab;

  function b64ToBytes(b64) {
    const bin = atob(b64); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function randomKeyB64() {
    const k = new Uint8Array(32); crypto.getRandomValues(k);
    let s = ""; k.forEach(b => s += String.fromCharCode(b));
    return btoa(s);
  }

  function currentUserPromise() {
    return new Promise(res => {
      const u = auth.currentUser;
      if (u) { res(u); return; }
      const un = auth.onAuthStateChanged(user => { un(); res(user); });
    });
  }

  const API = {
    labsOf: function (cid) { return ((window.CFD_LABS || {})[cid]) || []; },
    labInfo: function (cid, lab) { return API.labsOf(cid).find(l => l.id === lab) || { id: lab, title: lab, href: "" }; },

    // ---- сеансы ----
    getSession: async function (cid, lab) {
      try { const d = await db.collection("lab_sessions").doc(sid(cid, lab)).get(); return d.exists ? d.data() : null; }
      catch (e) { return null; }
    },
    watchSession: function (cid, lab, cb) {
      return db.collection("lab_sessions").doc(sid(cid, lab)).onSnapshot(
        d => cb(d.exists ? d.data() : null), () => cb(null));
    },
    // Открыть сеанс для списка uid (обычно — отмеченные «present» в занятии).
    openSession: async function (cid, lab, allowedUids, extra) {
      const me = auth.currentUser; if (!me) return { ok: false, error: "Не авторизован" };
      try {
        await db.collection("lab_sessions").doc(sid(cid, lab)).set(Object.assign({
          courseId: cid, labId: lab, open: true,
          allowedUids: Array.from(new Set(allowedUids || [])),
          openedAt: nowTs(), openedBy: me.email, closedAt: null, updatedAt: nowTs(),
        }, extra || {}), { merge: true });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    closeSession: async function (cid, lab) {
      const me = auth.currentUser; if (!me) return { ok: false, error: "Не авторизован" };
      try {
        await db.collection("lab_sessions").doc(sid(cid, lab)).set({
          courseId: cid, labId: lab, open: false, closedAt: nowTs(), closedBy: me.email, updatedAt: nowTs(),
        }, { merge: true });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // ---- ключ шифрования (admin) ----
    getKey: async function (cid, lab) {
      // Бросает permission-denied, если пользователю нельзя.
      const d = await db.collection("lab_keys").doc(sid(cid, lab)).get();
      return d.exists ? (d.data().key || null) : null;
    },
    setKey: async function (cid, lab, keyB64) {
      const me = auth.currentUser; if (!me) return { ok: false, error: "Не авторизован" };
      try {
        await db.collection("lab_keys").doc(sid(cid, lab)).set({ key: keyB64, updatedAt: nowTs(), updatedBy: me.email }, { merge: true });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    hasKey: async function (cid, lab) {
      try { const d = await db.collection("lab_keys").doc(sid(cid, lab)).get(); return d.exists && !!d.data().key; }
      catch (e) { return false; }
    },
    randomKey: randomKeyB64,

    // ---- ключ заметок докладчика (один на курс; читает/пишет только admin курса) ----
    hasNotesKey: async function (cid) {
      try { const d = await db.collection("notes_keys").doc(cid).get(); return d.exists && !!d.data().key; }
      catch (e) { return false; }
    },
    setNotesKey: async function (cid, keyB64) {
      const me = auth.currentUser; if (!me) return { ok: false, error: "Не авторизован" };
      try {
        await db.collection("notes_keys").doc(cid).set({ key: keyB64, updatedAt: nowTs(), updatedBy: me.email }, { merge: true });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // ---- расшифровка тела лабы ----
    decrypt: async function (enc, keyB64) {
      const key = await crypto.subtle.importKey("raw", b64ToBytes(keyB64), { name: "AES-GCM" }, false, ["decrypt"]);
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(enc.iv) }, key, b64ToBytes(enc.ct));
      return new TextDecoder().decode(pt);
    },

    // ---- прогресс ----
    loadProgress: async function (uid, cid, lab) {
      try { const d = await db.collection("lab_progress").doc(pid(uid, cid, lab)).get(); return d.exists ? d.data() : null; }
      catch (e) { return null; }
    },
    saveProgress: async function (uid, cid, lab, data) {
      try {
        await db.collection("lab_progress").doc(pid(uid, cid, lab)).set(Object.assign({
          uid: uid, courseId: cid, labId: lab, updatedAt: nowTs(),
        }, data), { merge: true });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    listMyProgress: async function (uid) {
      const out = [];
      try { const s = await db.collection("lab_progress").where("uid", "==", uid).get(); s.forEach(d => out.push(d.data())); }
      catch (e) {}
      return out;
    },
    listLabProgress: async function (cid, lab) {
      const out = {};
      try {
        const s = await db.collection("lab_progress").where("courseId", "==", cid).where("labId", "==", lab).get();
        s.forEach(d => { out[d.data().uid] = d.data(); });
      } catch (e) { console.warn("listLabProgress", e); }
      return out;
    },

    // ---- монтирование страницы лабы ----
    // opts: { cid, lab, encUrl, mount: Element, onReady(remoteProgress), onClosed() }
    mountLab: async function (opts) {
      const mount = opts.mount;
      const showMsg = (title, text) => {
        mount.innerHTML = '<div style="margin:2rem auto;max-width:560px;background:#fff;border:1px solid #d9cfc0;border-radius:12px;padding:1.6rem 2rem;text-align:center;box-shadow:0 8px 30px rgba(44,36,25,.08)">'
          + '<h2 style="font-family:Playfair Display,serif;font-size:1.5rem;font-weight:900;color:#b44a2d;margin:0 0 .5rem">' + title + '</h2>'
          + '<p style="color:#6b5d4f;margin:0;font-size:.95rem">' + text + '</p></div>';
      };
      showMsg("…", "проверка доступа к лабораторной");
      const user = await currentUserPromise();
      if (!user) { showMsg("🔒 Войдите на сайт", "Лабораторная доступна только записанным на курс студентам во время занятия."); return; }

      let mounted = false, unsub = null;
      const tryOpen = async () => {
        let keyB64 = null;
        try { keyB64 = await API.getKey(opts.cid, opts.lab); }
        catch (e) { keyB64 = null; }
        if (!keyB64) {
          showMsg("⏳ Лаба закрыта", "Преподаватель открывает лабораторную на занятии для отмеченных присутствующими. Если вы на паре и отмечены — попросите открыть доступ и обновите страницу.");
          return;
        }
        let enc;
        try { enc = await (await fetch(opts.encUrl, { cache: "no-cache" })).json(); }
        catch (e) { showMsg("Ошибка", "Не удалось загрузить задания: " + e.message); return; }
        let html;
        try { html = await API.decrypt(enc, keyB64); }
        catch (e) { showMsg("Ошибка", "Ключ не подходит к заданиям. Сообщите преподавателю."); return; }
        const remote = await API.loadProgress(user.uid, opts.cid, opts.lab);
        mount.innerHTML = html;
        // Скрипты из innerHTML не исполняются — пересоздаём их.
        mount.querySelectorAll("script").forEach(old => {
          const s = document.createElement("script");
          Array.from(old.attributes).forEach(a => s.setAttribute(a.name, a.value));
          s.textContent = old.textContent; old.replaceWith(s);
        });
        if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([mount]).catch(() => {});
        mounted = true;
        if (typeof opts.onReady === "function") opts.onReady(remote, user);
      };

      // Следим за сеансом: закрыли — прячем сразу.
      unsub = API.watchSession(opts.cid, opts.lab, sess => {
        const allowed = !!(sess && sess.open && Array.isArray(sess.allowedUids) && sess.allowedUids.indexOf(user.uid) !== -1);
        if (mounted && !allowed) {
          mounted = false;
          if (typeof opts.onClosed === "function") opts.onClosed();
          showMsg("🔒 Лаба закрыта", "Преподаватель закрыл доступ. Ваш прогресс сохранён — он виден в личном кабинете.");
        } else if (!mounted) {
          tryOpen();
        }
      });
      return { unmount: () => { if (unsub) unsub(); } };
    },
  };

  window.CFDLabs = API;
})();
