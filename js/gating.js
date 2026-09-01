// ============================================================
// Gating: контроль доступа к лекциям (открыта/закрыта/по дате)
// ------------------------------------------------------------
// Подключается через js/nav.js (автоматически на всех страницах).
// Умеет:
//   • на index.html — рендерить бейджи и админ-панельки у карточек;
//   • на страницах лекций — прятать контент и показывать оверлей,
//     если у пользователя нет доступа.
//
// Модель Firestore:
//   lectures/{cid}_{lecId} = { courseId, lectureId, releasedAt: Timestamp|null }
//     null / отсутствует → закрыто;
//     releasedAt <= now  → открыто;
//     releasedAt >  now  → откроется в дату.
// ============================================================

(function () {
  "use strict";

  // Определить cid и lecId страницы.
  function pageCid() {
    return document.documentElement.getAttribute("data-course")
        || (document.body && document.body.getAttribute("data-course"))
        || null;
  }

  // Страница помечена как admin-only, если <html> или <body> несёт
  // data-admin-only="true". Такие страницы (например, решения ДЗ)
  // видны только superadmin и admin с этим курсом в managedCourses.
  function isAdminOnlyPage() {
    return document.documentElement.getAttribute("data-admin-only") === "true"
        || (document.body && document.body.getAttribute("data-admin-only") === "true");
  }
  function pageLecId() {
    const f = location.pathname.split("/").pop() || "";
    return f.replace(/\.html?$/i, "") || "index";
  }
  function docId(cid, lec) { return cid + "_" + lec; }

  // Пути к скриптам (js/xxx.js) относительно текущей страницы.
  function jsPath(name) {
    // ищем в загруженных <script> — nav.js уже точно есть.
    const scripts = document.getElementsByTagName("script");
    for (const s of scripts) {
      if (s.src && /\/js\/nav\.js/.test(s.src)) return s.src.replace(/nav\.js.*/, name);
    }
    // фолбэк
    return "js/" + name;
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // Автоподгрузка Firebase compat SDK и firebase-config.js, если их нет.
  async function ensureFirebase() {
    if (typeof firebase !== "undefined" && typeof firebaseConfig !== "undefined") return;
    const scriptsToTry = [];
    if (typeof firebase === "undefined") {
      scriptsToTry.push("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
      scriptsToTry.push("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js");
      scriptsToTry.push("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js");
    }
    for (const s of scriptsToTry) await loadScript(s);
    if (typeof firebaseConfig === "undefined") {
      try { await loadScript(jsPath("firebase-config.js")); } catch (_) {}
    }
    if (typeof firebase !== "undefined" && typeof firebaseConfig !== "undefined" && !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
  }

  // Дождаться, пока auth.onAuthStateChanged даст пользователя (или null).
  function currentUserPromise() {
    return new Promise(function (res) {
      const u = firebase.auth().currentUser;
      if (u !== undefined && u !== null) { res(u); return; }
      const un = firebase.auth().onAuthStateChanged(function (user) { un(); res(user); });
    });
  }

  // Модель доступа.
  // Возвращает { open, reason, releasedAt, role }.
  //   reason: 'ok' | 'not-logged' | 'not-enrolled' | 'not-released' | 'no-course-id'
  async function computeAccess(cid, lec) {
    if (!cid) return { open: true, reason: "no-course-id" }; // не страница курса
    await ensureFirebase();
    const db = firebase.firestore();
    const user = await currentUserPromise();
    // superadmin: определяем по ADMIN_EMAILS
    const supers = (typeof ADMIN_EMAILS !== "undefined")
      ? (Array.isArray(ADMIN_EMAILS) ? ADMIN_EMAILS : [ADMIN_EMAILS]) : [];
    const isSuper = user && supers.indexOf(user.email) !== -1;
    if (isSuper) return { open: true, reason: "ok", role: "super" };

    if (!user) return { open: false, reason: "not-logged" };

    // Проверить isAdmin + managedCourses.
    let isAdmin = false, managedCourses = [];
    try {
      const u = await db.collection("users").doc(user.uid).get();
      if (u.exists) {
        isAdmin = !!u.data().isAdmin;
        managedCourses = Array.isArray(u.data().managedCourses) ? u.data().managedCourses : [];
      }
    } catch (_) {}
    if (isAdmin && managedCourses.indexOf(cid) !== -1) return { open: true, reason: "ok", role: "admin" };

    // Проверить enrollment approved.
    let approved = false;
    try {
      const e = await db.collection("enrollments").doc(user.uid + "_" + cid).get();
      if (e.exists && e.data().status === "approved") approved = true;
    } catch (_) {}
    if (!approved) return { open: false, reason: "not-enrolled" };

    // Проверить releasedAt.
    let releasedAt = null;
    try {
      const l = await db.collection("lectures").doc(docId(cid, lec)).get();
      if (l.exists) releasedAt = l.data().releasedAt || null;
    } catch (_) {}
    if (!releasedAt) return { open: false, reason: "not-released", role: "student" };
    if (releasedAt.toMillis() > Date.now()) return { open: false, reason: "not-released", releasedAt: releasedAt, role: "student" };
    return { open: true, reason: "ok", releasedAt: releasedAt, role: "student" };
  }

  // ---------- Оверлей на странице лекции ----------
  function showBlocker(access) {
    // Прячем контент, добавляем свой оверлей.
    const style = document.createElement("style");
    style.textContent = "html.gated body>*{display:none!important}html.gated body>.gating-blocker{display:flex!important}";
    document.head.appendChild(style);
    document.documentElement.classList.add("gated");
    const b = document.createElement("div");
    b.className = "gating-blocker";
    b.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#faf8f4;font-family:Source Serif 4,Georgia,serif;padding:2rem;z-index:99999";
    let msg = "";
    if (access.reason === "not-logged") {
      msg = "<h2 style=\"font-family:Playfair Display,serif;font-size:1.8rem;font-weight:900;color:#b44a2d;margin-bottom:.5rem\">🔒 Войдите на сайт</h2>"
          + "<p style=\"color:#6b5d4f;margin-bottom:1rem\">Эта лекция доступна только записанным на курс студентам.</p>";
    } else if (access.reason === "not-enrolled") {
      msg = "<h2 style=\"font-family:Playfair Display,serif;font-size:1.8rem;font-weight:900;color:#b44a2d;margin-bottom:.5rem\">✋ Запишитесь на курс</h2>"
          + "<p style=\"color:#6b5d4f;margin-bottom:1rem\">Материалы курса открываются только записанным студентам.</p>";
    } else if (access.reason === "admin-only") {
      msg = "<h2 style=\"font-family:Playfair Display,serif;font-size:1.8rem;font-weight:900;color:#b44a2d;margin-bottom:.5rem\">🔒 Только для преподавателя</h2>"
          + "<p style=\"color:#6b5d4f;margin-bottom:1rem\">Эта страница доступна только администраторам курса.</p>";
    } else if (access.reason === "not-released") {
      if (access.releasedAt) {
        const when = new Date(access.releasedAt.toMillis()).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "long", timeStyle: "short" }) + " МСК";
        msg = "<h2 style=\"font-family:Playfair Display,serif;font-size:1.8rem;font-weight:900;color:#b44a2d;margin-bottom:.5rem\">⏳ Лекция ещё не открыта</h2>"
            + "<p style=\"color:#6b5d4f;margin-bottom:1rem\">Откроется <strong>" + when + "</strong>.</p>";
      } else {
        msg = "<h2 style=\"font-family:Playfair Display,serif;font-size:1.8rem;font-weight:900;color:#b44a2d;margin-bottom:.5rem\">🔒 Лекция пока закрыта</h2>"
            + "<p style=\"color:#6b5d4f;margin-bottom:1rem\">Преподаватель откроет её позднее — следите за расписанием.</p>";
      }
    }
    // Найти путь к главной (index.html) относительно текущей страницы.
    const upToRoot = location.pathname.replace(/\/[^\/]*$/, "/").replace(/\/[^\/]+\//g, "../").replace(/^\.\.\//, "");
    b.innerHTML = "<div style=\"max-width:520px;background:#fff;border:1px solid #d9cfc0;border-radius:12px;padding:2rem;text-align:center;box-shadow:0 8px 30px rgba(44,36,25,.08)\">"
                + msg
                + "<a href=\"../index.html\" style=\"display:inline-block;font-family:JetBrains Mono,monospace;font-size:.85rem;padding:.5rem 1.2rem;border-radius:6px;background:#b44a2d;color:#fff;text-decoration:none\">На главную</a>"
                + "</div>";
    document.body.appendChild(b);
  }

  // Прячем контент лекции СРАЗУ, до асинхронной проверки прав.
  // Иначе студент видит закрытую лекцию первые ~2–5 секунд (пока
  // подгружается firebase, определяется user, читаются user doc /
  // enrollment / releasedAt). Ставим маркер на <html> моментально —
  // после проверки либо снимаем его (доступ есть), либо показываем
  // блокер (тогда маркер уже стоит и контент так и не мелькнёт).
  function preHideLectureIfNeeded() {
    const adminOnly = isAdminOnlyPage();
    const cid = pageCid();
    const lec = pageLecId();
    if (!adminOnly) {
      if (!cid) return false;
      if (lec === "index") return false;
      if (/^([a-z]+\-)?reference$/i.test(lec)) return false;
      if (/^practice$/i.test(lec)) return false;
    }
    // Синхронно — до firebase, до пикселя рендера.
    const style = document.createElement("style");
    style.id = "gating-prehide";
    style.textContent = "html.gating-checking body>*{visibility:hidden!important}"
                      + "html.gated body>*{display:none!important}"
                      + "html.gated body>.gating-blocker,"
                      + "html.gating-checking body>.gating-loader{display:flex!important;visibility:visible!important}";
    document.head.appendChild(style);
    document.documentElement.classList.add("gating-checking");
    // Лёгкий лоадер, чтобы страница не была совсем пустой во время проверки.
    const loader = document.createElement("div");
    loader.className = "gating-loader";
    loader.style.cssText = "position:fixed;inset:0;display:none;align-items:center;justify-content:center;"
                         + "background:#faf8f4;font-family:'JetBrains Mono',monospace;font-size:.85rem;color:#9a8d7e;z-index:99998";
    loader.textContent = "…проверка доступа к лекции";
    // Добавим loader после того как body появится
    if (document.body) document.body.appendChild(loader);
    else document.addEventListener("DOMContentLoaded", function(){ document.body.appendChild(loader); });
    return true;
  }

  async function enforceLecturePage() {
    if (isAdminOnlyPage()) { await enforceAdminOnlyPage(); return; }
    const cid = pageCid();
    const lec = pageLecId();
    if (!cid) return; // не лекция
    if (lec === "index") return; // обзорная страница курса — не блокируем
    if (/^([a-z]+\-)?reference$/i.test(lec)) return;
    if (/^practice$/i.test(lec)) return;
    const access = await computeAccess(cid, lec);
    // Проверка завершена — снимаем «шторку» перед принятием решения.
    document.documentElement.classList.remove("gating-checking");
    const ld = document.querySelector(".gating-loader");
    if (ld) ld.remove();
    if (!access.open) showBlocker(access);
  }

  // Проверка доступа для admin-only страницы: superadmin — всегда,
  // admin — при cid ∈ managedCourses (либо при отсутствии cid).
  async function enforceAdminOnlyPage() {
    await ensureFirebase();
    const user = await currentUserPromise();
    const supers = (typeof ADMIN_EMAILS !== "undefined")
      ? (Array.isArray(ADMIN_EMAILS) ? ADMIN_EMAILS : [ADMIN_EMAILS]) : [];
    const isSuper = user && supers.indexOf(user.email) !== -1;
    let allowed = isSuper;
    if (!allowed && user) {
      try {
        const u = await firebase.firestore().collection("users").doc(user.uid).get();
        if (u.exists) {
          const isAdmin = !!u.data().isAdmin;
          const managed = Array.isArray(u.data().managedCourses) ? u.data().managedCourses : [];
          const cid = pageCid();
          if (isAdmin && (!cid || managed.indexOf(cid) !== -1)) allowed = true;
        }
      } catch (_) {}
    }
    document.documentElement.classList.remove("gating-checking");
    const ld = document.querySelector(".gating-loader");
    if (ld) ld.remove();
    if (!allowed) {
      showBlocker({ open: false, reason: user ? "admin-only" : "not-logged" });
    } else {
      // Явно снимаем pre-hide, если он был поставлен в самом HTML
      // (см. <style>html[data-admin-only=true] body{visibility:hidden}</style>).
      document.documentElement.classList.add("gating-ok");
    }
  }

  // Вызвать pre-hide как можно раньше — синхронно при загрузке скрипта.
  preHideLectureIfNeeded();

  // ---------- Публичное API ----------
  window.CFDGating = {
    computeAccess: computeAccess,
    ensureFirebase: ensureFirebase,
    // Для admin-панели на главной:
    setLectureRelease: async function (cid, lec, releasedAt) {
      await ensureFirebase();
      const db = firebase.firestore();
      const me = firebase.auth().currentUser;
      try {
        await db.collection("lectures").doc(docId(cid, lec)).set({
          courseId: cid, lectureId: lec,
          releasedAt: releasedAt || null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: me ? me.email : null,
        }, { merge: true });
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    getLectureRelease: async function (cid, lec) {
      await ensureFirebase();
      const db = firebase.firestore();
      try {
        const d = await db.collection("lectures").doc(docId(cid, lec)).get();
        return d.exists ? (d.data().releasedAt || null) : null;
      } catch (_) { return null; }
    },
    // Все releasedAt курса одним запросом → { lec: Timestamp|null }.
    getReleasesForCourse: async function (cid) {
      await ensureFirebase();
      const db = firebase.firestore();
      const res = {};
      try {
        const snap = await db.collection("lectures").where("courseId", "==", cid).get();
        snap.forEach(function (d) { res[d.data().lectureId] = d.data().releasedAt || null; });
      } catch (_) {}
      return res;
    },
    // Массовая установка releasedAt (одним батчем).
    // entries: [{ lec, releasedAt: Timestamp|null }, …]
    setManyReleases: async function (cid, entries) {
      await ensureFirebase();
      const db = firebase.firestore();
      const me = firebase.auth().currentUser;
      const batch = db.batch();
      entries.forEach(function (e) {
        const ref = db.collection("lectures").doc(docId(cid, e.lec));
        batch.set(ref, {
          courseId: cid, lectureId: e.lec,
          releasedAt: e.releasedAt || null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: me ? me.email : null,
        }, { merge: true });
      });
      try { await batch.commit(); return { ok: true, n: entries.length }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    // Список лекций курса — тянем и парсим главную index.html,
    // чтобы не размножать источники истины. Кэшируется на страницу.
    listCourseLectures: async function (cid) {
      window.CFDGating._indexCache = window.CFDGating._indexCache || (async function () {
        const href = new URL("index.html", location.href).toString();
        const r = await fetch(href, { cache: "no-cache" });
        return await r.text();
      })();
      const html = await window.CFDGating._indexCache;
      const doc = new DOMParser().parseFromString(html, "text/html");
      const block = doc.querySelector('.course-block[data-course="' + cid + '"]');
      if (!block) return [];
      const out = [];
      block.querySelectorAll('.card[href], a.card').forEach(function (card) {
        const hr = card.getAttribute("href") || "";
        const m = hr.match(/([^\/]+)\.html?$/i);
        if (!m) return;
        const lec = m[1];
        if (/^index$/i.test(lec) || /^([a-z]+\-)?reference$/i.test(lec) || /^practice$/i.test(lec)) return;
        const h4 = card.querySelector("h4");
        const label = h4 ? (h4.textContent || "").trim() : lec;
        out.push({ lec: lec, href: hr, label: label });
      });
      return out;
    },
  };

  // ---------- Бейджи и админ-панельки у карточек на главной ----------
  async function decorateCards() {
    // Ищем блоки курсов
    const blocks = document.querySelectorAll(".course-block[data-course]");
    if (!blocks.length) return;
    await ensureFirebase();
    const db = firebase.firestore();
    const user = await currentUserPromise();
    // Кто наш пользователь
    const supers = (typeof ADMIN_EMAILS !== "undefined")
      ? (Array.isArray(ADMIN_EMAILS) ? ADMIN_EMAILS : [ADMIN_EMAILS]) : [];
    const isSuper = user && supers.indexOf(user.email) !== -1;
    let managedCourses = [], enrolledApproved = {};
    if (user && !isSuper) {
      try {
        const u = await db.collection("users").doc(user.uid).get();
        if (u.exists && Array.isArray(u.data().managedCourses)) managedCourses = u.data().managedCourses;
      } catch (_) {}
      try {
        const es = await db.collection("enrollments").where("uid", "==", user.uid).get();
        es.forEach(function (d) { if (d.data().status === "approved") enrolledApproved[d.data().courseId] = true; });
      } catch (_) {}
    }

    for (const block of blocks) {
      const cid = block.getAttribute("data-course");
      // Один запрос на все лекции курса.
      const lecMap = {};
      try {
        const snap = await db.collection("lectures").where("courseId", "==", cid).get();
        snap.forEach(function (d) { lecMap[d.data().lectureId] = d.data(); });
      } catch (_) {}
      const canEdit = isSuper || managedCourses.indexOf(cid) !== -1;
      const isEnrolled = isSuper || canEdit || !!enrolledApproved[cid];

      const cards = block.querySelectorAll(".card[href], a.card");
      cards.forEach(function (card) {
        const href = card.getAttribute("href") || "";
        // Извлечь lecId: basename без .html.
        const m = href.match(/([^\/]+)\.html?$/i);
        if (!m) return;
        const lec = m[1];
        if (/^index$/i.test(lec) || /^([a-z]+\-)?reference$/i.test(lec) || /^practice$/i.test(lec)) return;
        const data = lecMap[lec];
        const releasedAt = data && data.releasedAt || null;
        const isReleased = releasedAt && releasedAt.toMillis() <= Date.now();
        // Уже был бейдж? — удаляем.
        card.querySelectorAll(".gate-badge, .gate-adm").forEach(function (n) { n.remove(); });
        // Формируем бейдж
        const b = document.createElement("span");
        b.className = "gate-badge";
        b.style.cssText = "display:inline-block;position:absolute;top:.55rem;left:.7rem;font-family:'JetBrains Mono',monospace;font-size:.58rem;padding:.15rem .4rem;border-radius:3px;letter-spacing:.05em;text-transform:uppercase";
        if (canEdit) {
          // Admin/super: всегда открыто; статус + шестерёнка.
          if (isReleased)      { b.textContent = "✓ открыта";  b.style.background = "#e8f4f0"; b.style.color = "#1a6b5a"; }
          else if (releasedAt) { b.textContent = "⏳ " + fmtShort(releasedAt); b.style.background = "#faeeda"; b.style.color = "#854f0b"; }
          else                 { b.textContent = "🔒 закрыта"; b.style.background = "#fde8e8"; b.style.color = "#c44"; }
          const gear = document.createElement("button");
          gear.className = "gate-adm";
          gear.textContent = "⚙";
          gear.title = "Управление доступом";
          gear.style.cssText = "position:absolute;top:.4rem;right:.4rem;background:rgba(255,255,255,.85);border:1px solid #d9cfc0;border-radius:4px;cursor:pointer;font-size:.85rem;padding:1px 6px;z-index:5";
          gear.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openLectureGate(cid, lec, releasedAt); };
          card.appendChild(gear);
        } else if (!user) {
          b.textContent = "🔒 войдите"; b.style.background = "#fde8e8"; b.style.color = "#c44";
          card.addEventListener("click", function (e) { e.preventDefault(); alert("Войдите на сайт, чтобы читать лекции курса."); });
          card.style.opacity = ".7";
        } else if (!isEnrolled) {
          b.textContent = "✋ запишитесь"; b.style.background = "#fde8e8"; b.style.color = "#c44";
          card.addEventListener("click", function (e) { e.preventDefault(); alert("Запишитесь на курс на главной, чтобы получить доступ к лекциям."); });
          card.style.opacity = ".7";
        } else if (!isReleased) {
          if (releasedAt) {
            b.textContent = "⏳ " + fmtShort(releasedAt);
            b.style.background = "#faeeda"; b.style.color = "#854f0b";
          } else {
            b.textContent = "🔒 закрыта"; b.style.background = "#fde8e8"; b.style.color = "#c44";
          }
          card.addEventListener("click", function (e) {
            e.preventDefault();
            alert(releasedAt
              ? "Лекция откроется " + fmtLong(releasedAt) + " МСК."
              : "Лекция пока закрыта преподавателем.");
          });
          card.style.opacity = ".7";
        } else {
          b.textContent = "✓ открыта"; b.style.background = "#e8f4f0"; b.style.color = "#1a6b5a";
        }
        // Позиционировать бейдж — .card уже position:relative по стилям.
        card.style.position = card.style.position || "relative";
        card.appendChild(b);
      });
    }
  }

  function fmtShort(ts) {
    return new Date(ts.toMillis()).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  }
  function fmtLong(ts) {
    return new Date(ts.toMillis()).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "long", timeStyle: "short" });
  }

  // Модалка управления открытием (для admin/super).
  function openLectureGate(cid, lec, currentReleasedAt) {
    let box = document.getElementById("gate-modal");
    if (box) box.remove();
    box = document.createElement("div");
    box.id = "gate-modal";
    box.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center";
    const curLocal = currentReleasedAt
      ? new Date(currentReleasedAt.toMillis() + 3 * 3600 * 1000).toISOString().slice(0, 16) // МСК-конверсия для datetime-local
      : "";
    box.innerHTML =
      "<div style=\"background:#fff;border-radius:10px;padding:1rem 1.3rem;width:360px;max-width:92%;box-shadow:0 12px 40px rgba(0,0,0,.2);font-family:'Source Serif 4',Georgia,serif\">"
      + "<h3 style=\"margin:0 0 .5rem;font-family:'Playfair Display',serif;font-size:1.1rem\">Доступ к лекции</h3>"
      + "<p style=\"font-size:.82rem;color:#6b5d4f;margin-bottom:.6rem\">Курс: <strong>" + cid + "</strong> · Лекция: <strong>" + lec + "</strong></p>"
      + "<label style=\"font-family:'JetBrains Mono',monospace;font-size:.72rem;color:#6b5d4f\">Дата и время открытия (МСК)</label>"
      + "<input type=\"datetime-local\" id=\"gate-dt\" value=\"" + curLocal + "\" style=\"width:100%;font-family:'JetBrains Mono',monospace;font-size:.9rem;padding:6px 10px;border:1px solid #d9cfc0;border-radius:4px;margin-bottom:.6rem\">"
      + "<div style=\"display:flex;flex-wrap:wrap;gap:.4rem\">"
      + "<button id=\"gate-open-now\" style=\"flex:1;font-family:'JetBrains Mono',monospace;font-size:.78rem;padding:6px 12px;border-radius:5px;background:#1a6b5a;color:#fff;border:none;cursor:pointer\">Открыть сейчас</button>"
      + "<button id=\"gate-schedule\" style=\"flex:1;font-family:'JetBrains Mono',monospace;font-size:.78rem;padding:6px 12px;border-radius:5px;background:#b44a2d;color:#fff;border:none;cursor:pointer\">Запланировать</button>"
      + "<button id=\"gate-close\" style=\"flex:1;font-family:'JetBrains Mono',monospace;font-size:.78rem;padding:6px 12px;border-radius:5px;background:#c44;color:#fff;border:none;cursor:pointer\">Закрыть</button>"
      + "</div>"
      + "<button id=\"gate-cancel\" style=\"margin-top:.5rem;width:100%;font-family:'JetBrains Mono',monospace;font-size:.78rem;padding:6px 12px;border-radius:5px;background:none;border:1px solid #d9cfc0;cursor:pointer\">Отмена</button>"
      + "<div id=\"gate-status\" style=\"font-family:'JetBrains Mono',monospace;font-size:.75rem;color:#9a8d7e;margin-top:.4rem;min-height:1em\"></div>"
      + "</div>";
    document.body.appendChild(box);
    const status = box.querySelector("#gate-status");
    async function save(ts) {
      status.textContent = "сохранение…";
      const r = await window.CFDGating.setLectureRelease(cid, lec, ts);
      if (!r.ok) { status.textContent = "✗ " + r.error; return; }
      status.textContent = "✓ сохранено";
      setTimeout(function () { box.remove(); decorateCards(); }, 500);
    }
    box.querySelector("#gate-open-now").onclick = function () {
      save(firebase.firestore.Timestamp.fromDate(new Date()));
    };
    box.querySelector("#gate-schedule").onclick = function () {
      const v = box.querySelector("#gate-dt").value;
      if (!v) { status.textContent = "выберите дату"; return; }
      const [d, t] = v.split("T");
      const [Y, M, D] = d.split("-").map(Number);
      const [h, m] = t.split(":").map(Number);
      // МСК = UTC+3, без DST
      const ms = Date.UTC(Y, M - 1, D, h - 3, m);
      save(firebase.firestore.Timestamp.fromDate(new Date(ms)));
    };
    box.querySelector("#gate-close").onclick = function () { save(null); };
    box.querySelector("#gate-cancel").onclick = function () { box.remove(); };
    box.onclick = function (e) { if (e.target === box) box.remove(); };
  }

  // Автозапуск: если это страница внутри курса — включаем блокировку.
  document.addEventListener("DOMContentLoaded", enforceLecturePage);
  if (document.readyState !== "loading") enforceLecturePage();

  // На главной / странице курса — декорируем карточки.
  document.addEventListener("DOMContentLoaded", decorateCards);
  if (document.readyState !== "loading") decorateCards();
})();
