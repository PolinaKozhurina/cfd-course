// ============================================================
// Homework API — assignments, submissions, оценки
// ------------------------------------------------------------
// Подключается ПОСЛЕ firebase-config.js, firebase-storage-compat.js,
// auth.js, courses.js.
// ============================================================

(function () {
  "use strict";

  if (typeof firebase === "undefined" || typeof firebaseConfig === "undefined") return;
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const auth = firebase.auth();
  const storage = (typeof firebase.storage === "function") ? firebase.storage() : null;

  function nowTs() { return firebase.firestore.FieldValue.serverTimestamp(); }
  function subDocId(aid, uid) { return aid + "_" + uid; }
  function slugify(s) {
    return String(s || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^\w.\-]+/g, "_").slice(0, 80);
  }

  // ---------- Storage upload helper (студенческие сдачи, если понадобится) ----------
  async function uploadTo(path, file, onProgress) {
    if (!storage) throw new Error("Firebase Storage не подключён");
    const ref = storage.ref().child(path);
    const task = ref.put(file, { contentType: file.type || undefined });
    if (typeof onProgress === "function") {
      task.on("state_changed", function (s) {
        onProgress(s.bytesTransferred / (s.totalBytes || 1));
      });
    }
    await task;
    const url = await ref.getDownloadURL();
    return { path: path, url: url, name: file.name, size: file.size,
             uploadedAt: new Date().toISOString(),
             contentType: file.type || "" };
  }

  // ---------- Worker upload: admin-условие ДЗ ----------
  // Загружает файл условия в основной публичный репо cfd-course через
  // Cloudflare Worker (endpoint /upload-common). Storage при этом не
  // используется вообще — Firebase Storage требует Blaze-плана и часто
  // молча висит в свободных проектах. Возвращает { path, url, name, size,
  // uploadedAt, contentType }.
  async function uploadCommonViaWorker(cid, aid, file, subdir, onProgress) {
    const me = auth.currentUser;
    if (!me) throw new Error("Не авторизован");
    if (typeof WORKER_URL === "undefined" || !WORKER_URL) {
      throw new Error("WORKER_URL не настроен — загрузка условия ДЗ невозможна");
    }
    if (file.size > 50 * 1024 * 1024) throw new Error("Файл больше 50 MB");
    if (typeof onProgress === "function") onProgress(0.05);
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] || "");
      r.onerror = () => rej(new Error("read"));
      r.readAsDataURL(file);
    });
    if (typeof onProgress === "function") onProgress(0.5);
    const token = await me.getIdToken();
    const resp = await fetch(WORKER_URL + "/upload-common", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: token, cid: cid, aid: aid,
        filename: file.name, base64: base64, size: file.size,
        subdir: subdir || "",
      }),
    });
    if (typeof onProgress === "function") onProgress(0.95);
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || "upload-common failed");
    if (typeof onProgress === "function") onProgress(1);
    return {
      path: data.path,
      url: data.url,
      name: file.name,
      size: file.size,
      uploadedAt: data.uploadedAt,
      contentType: file.type || "",
    };
  }

  window.CFDHomework = {
    // ==== ASSIGNMENTS ====

    // Создать assignment. filesCommon и variants[i].files — массивы File.
    createAssignment: async function (cid, data, filesCommon, variantsFiles, onProgress) {
      const me = auth.currentUser;
      if (!me) return { ok: false, error: "Не авторизован" };
      const ref = db.collection("assignments").doc(); // auto-id
      const aid = ref.id;
      try {
        // Загрузка файлов условий (common) — через Cloudflare Worker в
        // публичный репо cfd-course (Firebase Storage требует Blaze,
        // часто молча висит; Worker уже настроен и работает).
        const commonUploads = [];
        for (const f of (filesCommon || [])) {
          commonUploads.push(await uploadCommonViaWorker(cid, aid, f, "common", onProgress));
        }
        // Файлы вариантов (personal). variantsFiles: [[File...], [File...], ...]
        const variantsOut = [];
        const variants = data.variants || [];
        for (let i = 0; i < variants.length; i++) {
          const vfs = (variantsFiles && variantsFiles[i]) || [];
          const uploaded = [];
          for (const f of vfs) {
            uploaded.push(await uploadCommonViaWorker(cid, aid, f, "variants/" + i, onProgress));
          }
          variantsOut.push({ text: variants[i].text || "", files: uploaded });
        }
        const doc = {
          courseId: cid,
          title: data.title || "Без названия",
          description: data.description || "",
          mode: (data.mode === "personal") ? "personal" : "common",
          deadlineAt: data.deadlineAt || null,     // Timestamp или null
          deadlineTz: data.deadlineTz || "Europe/Moscow",
          strictDeadline: !!data.strictDeadline,
          filesCommon: commonUploads,
          variants: variantsOut,
          assignedVariants: data.assignedVariants || {},
          createdBy: me.email,
          createdByUid: me.uid,
          createdAt: nowTs(),
        };
        await ref.set(doc);
        return { ok: true, aid: aid };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    },

    // Простое частичное обновление (title/description/deadlineAt/strictDeadline/assignedVariants).
    // Файлы редактировать через отдельные методы (уже в п.12+).
    updateAssignment: async function (aid, patch) {
      try {
        await db.collection("assignments").doc(aid).update(patch);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Удалить assignment и все связанные Firestore-документы.
    // Файлы условия теперь лежат в GitHub-репо (cfd-course/_src/hw/…),
    // не в Firebase Storage — их удаление опционально и происходит best-effort
    // через Worker /file DELETE, если файл действительно в приватном репо
    // (cfd-submissions). Файлы, попавшие в открытый cfd-course, оставляем
    // как есть — они не критичны (потом при пересоздании ДЗ путь другой aid).
    deleteAssignment: async function (aid) {
      try {
        const snap = await db.collection("assignments").doc(aid).get();
        if (!snap.exists) return { ok: false, error: "not found" };
        const cid = (snap.data() || {}).courseId || "";
        // Сабмишны студентов (фильтр по courseId нужен правилам Firestore для курсового admin)
        let subQ = db.collection("submissions").where("assignmentId", "==", aid);
        if (cid) subQ = subQ.where("courseId", "==", cid);
        const subs = await subQ.get();
        // Best-effort удаление файлов сдач через Worker (они в приватном
        // cfd-submissions). Не блокируем удаление записей при ошибке.
        if (typeof WORKER_URL !== "undefined" && WORKER_URL) {
          try {
            const me = auth.currentUser;
            if (me) {
              const token = await me.getIdToken();
              for (const s of subs.docs) {
                for (const f of (s.data().files || [])) {
                  try {
                    await fetch(WORKER_URL + "/file?path=" + encodeURIComponent(f.path), {
                      method: "DELETE",
                      headers: { Authorization: "Bearer " + token },
                    });
                  } catch (_) {}
                }
              }
            }
          } catch (_) {}
        }
        // Удалить документы Firestore одним батчем
        const batch = db.batch();
        subs.forEach(s => batch.delete(s.ref));
        let grQ = db.collection("assignment_grades").where("assignmentId", "==", aid);
        if (cid) grQ = grQ.where("courseId", "==", cid);
        const grades = await grQ.get();
        grades.forEach(g => batch.delete(g.ref));
        batch.delete(db.collection("assignments").doc(aid));
        await batch.commit();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message || String(e) }; }
    },

    // Назначить вариант personal-assignment одному студенту.
    assignVariant: async function (aid, uid, variantIdx) {
      const patch = {};
      patch["assignedVariants." + uid] = variantIdx;
      try {
        await db.collection("assignments").doc(aid).update(patch);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // ==== SUBMISSIONS ====

    // Загрузить один файл сдачи → Cloudflare Worker → приватный GitHub-репо.
    // Возвращает { path, name, size, uploadedAt } (без прямой url — доступ
    // через downloadFile()).
    uploadSubmissionFile: async function (aid, cid, file, onProgress) {
      const me = auth.currentUser;
      if (!me) throw new Error("Не авторизован");
      // Форс-обновление токена — иначе Worker получит email_verified=false из старого токена.
      try { await me.reload(); await me.getIdToken(true); } catch (_) {}
      if (!me.emailVerified) throw new Error("Подтвердите email (ссылка в письме) и обновите страницу");
      if (typeof WORKER_URL === "undefined" || !WORKER_URL) {
        throw new Error("Загрузка файлов не настроена (WORKER_URL пуст). Пока пользуйтесь ссылками на облако.");
      }
      if (file.size > 50 * 1024 * 1024) throw new Error("Файл больше 50 MB");
      if (typeof onProgress === "function") onProgress(0.05);
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] || "");
        r.onerror = () => rej(new Error("read"));
        r.readAsDataURL(file);
      });
      if (typeof onProgress === "function") onProgress(0.5);
      const token = await me.getIdToken();
      // Взять ФИО из users doc (лучший читаемый идентификатор в GitHub-пути)
      let fio = "";
      try {
        const ud = await db.collection("users").doc(me.uid).get();
        if (ud.exists) fio = ud.data().fio || "";
      } catch (_) {}
      const resp = await fetch(WORKER_URL + "/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token, aid: aid, cid: cid, fio: fio,
          filename: file.name, base64: base64, size: file.size,
        }),
      });
      if (typeof onProgress === "function") onProgress(0.95);
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || "upload failed");
      if (typeof onProgress === "function") onProgress(1);
      return {
        path: data.path,
        name: file.name,
        size: file.size,
        uploadedAt: data.uploadedAt,
        contentType: file.type || "",
      };
    },

    // Скачать файл через Worker → отдать Blob (для download или preview).
    downloadFile: async function (path) {
      if (!path) throw new Error("Нет пути");
      if (typeof WORKER_URL === "undefined" || !WORKER_URL) {
        throw new Error("WORKER_URL не настроен");
      }
      const me = auth.currentUser;
      if (!me) throw new Error("Не авторизован");
      const token = await me.getIdToken();
      const resp = await fetch(WORKER_URL + "/file?path=" + encodeURIComponent(path), {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || "download failed");
      // Собираем Blob из base64 (может быть <50MB).
      const bin = atob(String(data.base64).replace(/\n/g, ""));
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return { blob: new Blob([buf]), name: data.name, size: data.size };
    },

    // Триггер download (создать <a download> и кликнуть).
    // iPad/iPhone (Safari): скачивание через <a download> для blob-ссылок не
    // работает или молча открывает пустую вкладку. Там открываем новую вкладку
    // СИНХРОННО (внутри клика — иначе Safari её блокирует), а после загрузки
    // показываем в ней PDF: из встроенного просмотрщика его можно «Поделиться»
    // → Файлы / Notability / Разметка Pencil-ом.
    triggerDownload: async function (path, name) {
      const ua = navigator.userAgent || "";
      const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      let tab = null;
      if (isIOS) {
        try { tab = window.open("", "_blank"); } catch (_) { tab = null; }
        if (tab) { try { tab.document.write('<p style="font-family:sans-serif;padding:2rem">Загрузка файла…</p>'); } catch (_) {} }
      }
      try {
        const d = await this.downloadFile(path);
        const isPdf = /\.pdf$/i.test(name || d.name || "");
        const blob = isPdf ? new Blob([d.blob], { type: "application/pdf" }) : d.blob;
        const url = URL.createObjectURL(blob);
        if (tab) {
          tab.location.href = url;
          setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
          return;
        }
        const a = document.createElement("a");
        a.href = url;
        a.download = name || d.name || "file";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      } catch (e) {
        if (tab) { try { tab.close(); } catch (_) {} }
        throw e;
      }
    },

    // Удалить файл на Worker-е и записать в submissions.
    deleteRemoteFile: async function (path) {
      if (typeof WORKER_URL === "undefined" || !WORKER_URL) return { ok: false, error: "WORKER_URL" };
      const me = auth.currentUser;
      if (!me) return { ok: false, error: "not authed" };
      const token = await me.getIdToken();
      const resp = await fetch(WORKER_URL + "/file?path=" + encodeURIComponent(path), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token },
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) return { ok: false, error: data.error };
      return { ok: true };
    },

    // Записать/обновить submission (после загрузки файлов).
    submit: async function (aid, cid, files, note) {
      const me = auth.currentUser;
      if (!me) return { ok: false, error: "Не авторизован" };
      // Форсируем обновление ID-токена: Firebase кэширует его ~1 час,
      // и после недавнего подтверждения email в токене всё ещё
      // email_verified=false — Firestore-правило isVerified() отбивает.
      try { await me.reload(); await me.getIdToken(true); } catch (_) {}
      if (!me.emailVerified) return { ok: false, error: "Подтвердите email (ссылка в письме) и обновите страницу" };
      const ref = db.collection("submissions").doc(subDocId(aid, me.uid));
      try {
        const snap = await ref.get();
        if (snap.exists) {
          const cur = snap.data();
          const merged = (cur.files || []).concat(files || []);
          await ref.update({
            files: merged,
            note: (note !== undefined ? note : (cur.note || "")),
            updatedAt: nowTs(),
          });
        } else {
          await ref.set({
            assignmentId: aid,
            uid: me.uid,
            courseId: cid,
            files: files || [],
            note: note || "",
            submittedAt: nowTs(),
            updatedAt: nowTs(),
          });
        }
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Добавить ссылку на облако (Google Drive / Я.Диск / … — что угодно).
    addSubmissionLink: async function (aid, cid, url, name) {
      const me = auth.currentUser;
      if (!me) return { ok: false, error: "Не авторизован" };
      try { await me.reload(); await me.getIdToken(true); } catch (_) {}
      if (!me.emailVerified) return { ok: false, error: "Подтвердите email (ссылка в письме) и обновите страницу" };
      url = String(url || "").trim();
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Ссылка должна начинаться с http(s)://" };
      const entry = { url: url, name: (name || url).trim().slice(0, 200), addedAt: new Date().toISOString() };
      const ref = db.collection("submissions").doc(subDocId(aid, me.uid));
      try {
        const snap = await ref.get();
        if (snap.exists) {
          const cur = snap.data();
          const links = (cur.links || []).concat([entry]);
          await ref.update({ links: links, updatedAt: nowTs() });
        } else {
          await ref.set({
            assignmentId: aid, uid: me.uid, courseId: cid,
            files: [], links: [entry], note: "",
            submittedAt: nowTs(), updatedAt: nowTs(),
          });
        }
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Удалить одну ссылку из своей сдачи.
    removeSubmissionLink: async function (aid, uid, url) {
      const ref = db.collection("submissions").doc(subDocId(aid, uid));
      try {
        const snap = await ref.get();
        if (!snap.exists) return { ok: false, error: "no submission" };
        const cur = snap.data();
        const links = (cur.links || []).filter(l => l.url !== url);
        await ref.update({ links: links, updatedAt: nowTs() });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Удалить один файл из своей сдачи (студент) или чужой (admin).
    // Удаляет файл и на Worker-е (в приватном GitHub-репо), и в Firestore.
    removeSubmissionFile: async function (aid, uid, fileEntry) {
      const ref = db.collection("submissions").doc(subDocId(aid, uid));
      try {
        const snap = await ref.get();
        if (!snap.exists) return { ok: false, error: "no submission" };
        const cur = snap.data();
        const files = (cur.files || []).filter(f => f.path !== fileEntry.path);
        // Best-effort delete на Worker (не падаем, если Worker не задан).
        try {
          if (typeof WORKER_URL !== "undefined" && WORKER_URL) {
            await this.deleteRemoteFile(fileEntry.path);
          }
        } catch (_) {}
        // Legacy Storage-остатки:
        try { if (storage) await storage.ref().child(fileEntry.path).delete(); } catch (_) {}
        await ref.update({ files: files, updatedAt: nowTs() });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Admin: скачать PDF по ссылке студента (Google Drive / Я.Диск / прямая
    // ссылка) через воркер — сам браузер не может из-за CORS. Возвращает
    // { blob, name }. Бросает Error; у ошибки e.code === "no-endpoint", если
    // воркер ещё не обновлён и /fetch-link у него нет.
    fetchLinkAsPdf: async function (cid, url) {
      const me = auth.currentUser;
      if (!me) throw new Error("Не авторизован");
      if (typeof WORKER_URL === "undefined" || !WORKER_URL) throw new Error("WORKER_URL не настроен");
      const token = await me.getIdToken();
      const resp = await fetch(WORKER_URL + "/fetch-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token, cid: cid, url: url }),
      });
      const ct = resp.headers.get("content-type") || "";
      if (resp.ok && /application\/pdf/i.test(ct)) {
        const blob = await resp.blob();
        let name = resp.headers.get("X-File-Name") || "";
        try { name = decodeURIComponent(name); } catch (_) {}
        return { blob: blob, name: name || "submission.pdf" };
      }
      let data = {};
      try { data = await resp.json(); } catch (_) {}
      const err = new Error(data.error || ("HTTP " + resp.status));
      if (resp.status === 404 && data.error === "not found") err.code = "no-endpoint";
      throw err;
    },

    // ==== REVIEWED (проверенные преподавателем файлы) ====

    // Admin: загрузить проверенный файл (обычно PDF с пометками маркером)
    // в приватный cfd-submissions рядом со сдачей. Возвращает { path, name,
    // size, uploadedAt } — сам путь потом сохраняется в submissions doc через
    // addReviewedFile.
    uploadReviewedFile: async function (aid, cid, targetUid, targetFio, file, onProgress) {
      const me = auth.currentUser;
      if (!me) throw new Error("Не авторизован");
      try { await me.reload(); await me.getIdToken(true); } catch (_) {}
      if (typeof WORKER_URL === "undefined" || !WORKER_URL) {
        throw new Error("WORKER_URL не настроен");
      }
      if (file.size > 50 * 1024 * 1024) throw new Error("Файл больше 50 MB");
      if (typeof onProgress === "function") onProgress(0.05);
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] || "");
        r.onerror = () => rej(new Error("read"));
        r.readAsDataURL(file);
      });
      if (typeof onProgress === "function") onProgress(0.5);
      const token = await me.getIdToken();
      const resp = await fetch(WORKER_URL + "/upload-reviewed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token, cid: cid, aid: aid,
          targetUid: targetUid, targetFio: targetFio || "",
          filename: file.name, base64: base64, size: file.size,
        }),
      });
      if (typeof onProgress === "function") onProgress(0.95);
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || "upload-reviewed failed");
      if (typeof onProgress === "function") onProgress(1);
      return {
        path: data.path,
        name: file.name,
        size: file.size,
        uploadedAt: data.uploadedAt,
        contentType: file.type || "application/pdf",
      };
    },

    // Записать в submission поле reviewedFiles (массив, дозаписью). Одновременно
    // проставляет reviewedAt/reviewedBy — можно потом отсортировать/показать.
    // reviewComment — опциональная короткая приписка к проверенному файлу
    // (кладётся в fileEntry.comment).
    addReviewedFile: async function (aid, targetUid, fileEntry, reviewComment) {
      const me = auth.currentUser;
      if (!me) return { ok: false, error: "Не авторизован" };
      const ref = db.collection("submissions").doc(subDocId(aid, targetUid));
      const entry = Object.assign({}, fileEntry, {
        uploadedBy: me.email,
        comment: reviewComment || "",
      });
      try {
        const snap = await ref.get();
        if (!snap.exists) return { ok: false, error: "нет сдачи для этого студента" };
        const cur = snap.data();
        const reviewed = (cur.reviewedFiles || []).concat([entry]);
        await ref.update({
          reviewedFiles: reviewed,
          reviewedAt: nowTs(),
          reviewedBy: me.email,
          updatedAt: nowTs(),
        });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Убрать один проверенный файл (и с Worker-а, и из Firestore).
    removeReviewedFile: async function (aid, targetUid, path) {
      const ref = db.collection("submissions").doc(subDocId(aid, targetUid));
      try {
        const snap = await ref.get();
        if (!snap.exists) return { ok: false, error: "нет сдачи" };
        const cur = snap.data();
        const kept = (cur.reviewedFiles || []).filter(f => f.path !== path);
        try {
          if (typeof WORKER_URL !== "undefined" && WORKER_URL) {
            await this.deleteRemoteFile(path);
          }
        } catch (_) {}
        await ref.update({ reviewedFiles: kept, updatedAt: nowTs() });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // ==== GRADES ====

    setGrade: async function (aid, uid, cid, grade, comment) {
      const me = auth.currentUser;
      const docId = aid + "_" + uid;
      try {
        await db.collection("assignment_grades").doc(docId).set({
          assignmentId: aid,
          uid: uid,
          courseId: cid,
          grade: grade,
          comment: comment || "",
          gradedAt: nowTs(),
          gradedBy: me ? me.email : null,
        }, { merge: true });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // ==== LIST ====

    listAssignmentsForCourse: async function (cid) {
      try {
        const snap = await db.collection("assignments").where("courseId", "==", cid).get();
        const out = [];
        snap.forEach(d => out.push({ id: d.id, ...d.data() }));
        return out.sort((a, b) => {
          const ta = a.createdAt ? a.createdAt.toMillis() : 0;
          const tb = b.createdAt ? b.createdAt.toMillis() : 0;
          return tb - ta;
        });
      } catch (e) { console.warn("listAssignmentsForCourse:", e); return []; }
    },

    // cid — courseId задания. Курсовому admin правила Firestore разрешают
    // читать сдачи только своего курса, и запрос без фильтра по courseId
    // отклоняется целиком; superadmin проходит и без него.
    listSubmissions: async function (aid, cid) {
      try {
        let q = db.collection("submissions").where("assignmentId", "==", aid);
        if (cid) q = q.where("courseId", "==", cid);
        const snap = await q.get();
        const out = {}; snap.forEach(d => { out[d.data().uid] = d.data(); });
        return out;
      } catch (e) { console.warn("listSubmissions:", e); return {}; }
    },

    listGrades: async function (aid, cid) {
      try {
        let q = db.collection("assignment_grades").where("assignmentId", "==", aid);
        if (cid) q = q.where("courseId", "==", cid);
        const snap = await q.get();
        const out = {}; snap.forEach(d => { out[d.data().uid] = d.data(); });
        return out;
      } catch (e) { console.warn("listGrades:", e); return {}; }
    },

    // Мои сдачи (для профиля).
    getMySubmission: async function (aid) {
      const me = auth.currentUser;
      if (!me) return null;
      try {
        const s = await db.collection("submissions").doc(subDocId(aid, me.uid)).get();
        return s.exists ? s.data() : null;
      } catch (_) { return null; }
    },

    getMyGrade: async function (aid) {
      const me = auth.currentUser;
      if (!me) return null;
      try {
        const g = await db.collection("assignment_grades").doc(subDocId(aid, me.uid)).get();
        return g.exists ? g.data() : null;
      } catch (_) { return null; }
    },
  };
})();
