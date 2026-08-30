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

  // ---------- Storage upload helper ----------
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

  window.CFDHomework = {
    // ==== ASSIGNMENTS ====

    // Создать assignment. filesCommon и variants[i].files — массивы File.
    createAssignment: async function (cid, data, filesCommon, variantsFiles, onProgress) {
      const me = auth.currentUser;
      if (!me) return { ok: false, error: "Не авторизован" };
      const ref = db.collection("assignments").doc(); // auto-id
      const aid = ref.id;
      try {
        // Загрузка файлов условий (common)
        const commonUploads = [];
        for (const f of (filesCommon || [])) {
          const path = "homework/" + cid + "/" + aid + "/common/" + slugify(f.name);
          commonUploads.push(await uploadTo(path, f, onProgress));
        }
        // Файлы вариантов (personal). variantsFiles: [[File...], [File...], ...]
        const variantsOut = [];
        const variants = data.variants || [];
        for (let i = 0; i < variants.length; i++) {
          const vfs = (variantsFiles && variantsFiles[i]) || [];
          const uploaded = [];
          for (const f of vfs) {
            const path = "homework/" + cid + "/" + aid + "/variants/" + i + "/" + slugify(f.name);
            uploaded.push(await uploadTo(path, f, onProgress));
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

    // Удалить assignment и все связанные файлы Storage.
    deleteAssignment: async function (aid) {
      try {
        const snap = await db.collection("assignments").doc(aid).get();
        if (!snap.exists) return { ok: false, error: "not found" };
        const d = snap.data();
        const paths = [];
        (d.filesCommon || []).forEach(f => paths.push(f.path));
        (d.variants || []).forEach(v => (v.files || []).forEach(f => paths.push(f.path)));
        // Файлы всех сдач тоже удалим
        const subs = await db.collection("submissions").where("assignmentId", "==", aid).get();
        for (const s of subs.docs) {
          (s.data().files || []).forEach(f => paths.push(f.path));
        }
        // Удалить объекты Storage (best-effort)
        for (const p of paths) {
          try { await storage.ref().child(p).delete(); } catch (_) {}
        }
        // Удалить сабмишны
        const batch = db.batch();
        subs.forEach(s => batch.delete(s.ref));
        // Удалить оценки
        const grades = await db.collection("assignment_grades").where("assignmentId", "==", aid).get();
        grades.forEach(g => batch.delete(g.ref));
        batch.delete(db.collection("assignments").doc(aid));
        await batch.commit();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
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

    // Загрузить один файл сдачи → Storage → вернуть метаданные.
    uploadSubmissionFile: async function (aid, cid, file, onProgress) {
      const me = auth.currentUser;
      if (!me) throw new Error("Не авторизован");
      if (!me.emailVerified) throw new Error("Подтвердите email");
      const path = "homework/" + cid + "/" + aid + "/" + me.uid + "/" + Date.now() + "_" + slugify(file.name);
      return await uploadTo(path, file, onProgress);
    },

    // Записать/обновить submission (после загрузки файлов).
    submit: async function (aid, cid, files, note) {
      const me = auth.currentUser;
      if (!me) return { ok: false, error: "Не авторизован" };
      if (!me.emailVerified) return { ok: false, error: "Подтвердите email" };
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

    // Удалить один файл из своей сдачи (студент) или чужой (admin).
    removeSubmissionFile: async function (aid, uid, fileEntry) {
      const ref = db.collection("submissions").doc(subDocId(aid, uid));
      try {
        const snap = await ref.get();
        if (!snap.exists) return { ok: false, error: "no submission" };
        const cur = snap.data();
        const files = (cur.files || []).filter(f => f.path !== fileEntry.path);
        try { await storage.ref().child(fileEntry.path).delete(); } catch (_) {}
        await ref.update({ files: files, updatedAt: nowTs() });
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

    listSubmissions: async function (aid) {
      try {
        const snap = await db.collection("submissions").where("assignmentId", "==", aid).get();
        const out = {}; snap.forEach(d => { out[d.data().uid] = d.data(); });
        return out;
      } catch (e) { console.warn("listSubmissions:", e); return {}; }
    },

    listGrades: async function (aid) {
      try {
        const snap = await db.collection("assignment_grades").where("assignmentId", "==", aid).get();
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
