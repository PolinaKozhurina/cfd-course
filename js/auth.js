// ============================================================
// Auth Module — Login / Register / Group Selection
// ============================================================
// Подключение: добавьте в <head> любой страницы:
//   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
//   <script src="js/firebase-config.js"></script>
//   <script src="js/auth.js"></script>
// ============================================================

(function () {
  "use strict";

  // --- Init Firebase ---
  if (typeof firebase === "undefined" || typeof firebaseConfig === "undefined") {
    console.warn("Firebase SDK or config not loaded. Auth disabled.");
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const auth = firebase.auth();
  const db = firebase.firestore();

  // --- Inject Modal CSS ---
  const style = document.createElement("style");
  style.textContent = `
    .auth-overlay{position:fixed;inset:0;background:rgba(44,36,25,.45);z-index:9999;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .2s}
    .auth-overlay.open{opacity:1;pointer-events:auto}
    .auth-modal{background:#faf8f4;border-radius:12px;padding:2rem;width:90%;max-width:380px;box-shadow:0 12px 40px rgba(44,36,25,.15);font-family:'Source Serif 4',Georgia,serif;position:relative}
    .auth-modal h3{font-family:'Playfair Display',serif;font-size:1.3rem;font-weight:900;margin-bottom:.2rem;color:#2c2419}
    .auth-modal .sub{font-size:.85rem;color:#6b5d4f;margin-bottom:1.2rem}
    .auth-modal label{display:block;font-size:.78rem;color:#6b5d4f;margin-bottom:.15rem;font-family:'JetBrains Mono',monospace}
    .auth-modal input,.auth-modal select{width:100%;padding:.5rem .7rem;border:1px solid #d9cfc0;border-radius:6px;font-size:.9rem;font-family:'Source Serif 4',serif;background:#fff;color:#2c2419;margin-bottom:.8rem}
    .auth-modal input:focus,.auth-modal select:focus{outline:none;border-color:#b44a2d}
    .auth-modal .btn{width:100%;padding:.6rem;border:none;border-radius:6px;font-family:'Source Serif 4',serif;font-size:.95rem;font-weight:600;cursor:pointer;transition:opacity .15s}
    .auth-modal .btn:hover{opacity:.85}
    .auth-modal .btn-primary{background:#b44a2d;color:#fff}
    .auth-modal .btn-secondary{background:#e8f4f0;color:#1a6b5a;margin-top:.5rem}
    .auth-modal .btn-logout{background:#fde8e8;color:#c44;margin-top:.5rem}
    .auth-modal .error{background:#fde8e8;color:#c44;font-size:.82rem;padding:.4rem .6rem;border-radius:4px;margin-bottom:.8rem;display:none}
    .auth-modal .close{position:absolute;top:.8rem;right:1rem;background:none;border:none;font-size:1.3rem;cursor:pointer;color:#9a8d7e;line-height:1}
    .auth-modal .switch{text-align:center;font-size:.82rem;color:#6b5d4f;margin-top:.8rem}
    .auth-modal .switch a{color:#b44a2d;cursor:pointer;text-decoration:none;border-bottom:1px solid transparent}
    .auth-modal .switch a:hover{border-bottom-color:#b44a2d}
    .auth-user-bar{display:flex;align-items:center;gap:.5rem;font-family:'JetBrains Mono',monospace;font-size:.72rem;color:#6b5d4f}
    .auth-user-bar .email{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .auth-user-bar .group-badge{background:#e8f4f0;color:#1a6b5a;padding:.15rem .4rem;border-radius:3px;font-weight:500}
  `;
  document.head.appendChild(style);

  // --- Inject Modal HTML ---
  const overlay = document.createElement("div");
  overlay.className = "auth-overlay";
  overlay.innerHTML = `
    <div class="auth-modal">
      <button class="close" onclick="CFDAuth.closeModal()">&times;</button>
      <div id="auth-login-view">
        <h3 id="auth-title">Вход</h3>
        <p class="sub" id="auth-subtitle">Войдите, чтобы отправлять результаты расчётов</p>
        <div class="error" id="auth-error"></div>
        <div id="auth-fio-fields" style="display:none">
          <label>ФИО</label>
          <input type="text" id="auth-fio" placeholder="Иванов Иван Иванович">
          <label>Учебная группа (МИФИ)</label>
          <input type="text" id="auth-study-group" placeholder="Б22-505">
        </div>
        <label>Email</label>
        <input type="email" id="auth-email" placeholder="ivanov@university.ru">
        <label>Пароль</label>
        <input type="password" id="auth-pass" placeholder="Минимум 6 символов">
        <button class="btn btn-primary" id="auth-main-btn" onclick="CFDAuth.login()">Войти</button>
        <button class="btn btn-secondary" id="auth-alt-btn" onclick="CFDAuth.showRegister()">У меня нет аккаунта</button>
        <p class="switch" id="auth-switch">Забыли пароль? <a onclick="CFDAuth.resetPassword()">Сбросить</a></p>
      </div>
      <div id="auth-profile-view" style="display:none">
        <h3>Профиль</h3>
        <p class="sub" id="auth-profile-email"></p>
        <label>Номер группы</label>
        <select id="auth-group">
          <option value="">— выберите —</option>
        </select>
        <button class="btn btn-primary" onclick="CFDAuth.saveGroup()">Сохранить группу</button>
        <button class="btn btn-logout" onclick="CFDAuth.logout()">Выйти</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Populate group options (01..20)
  const groupSelect = document.getElementById("auth-group");
  for (let i = 1; i <= 5; i++) {
    const opt = document.createElement("option");
    opt.value = "group_" + String(i).padStart(2, "0");
    opt.textContent = "Группа " + String(i).padStart(2, "0");
    groupSelect.appendChild(opt);
  }

  // --- Auth State ---
  let currentUser = null;
  let userGroup = null;

  // --- Public API ---
  window.CFDAuth = {
    openModal: function () {
      overlay.classList.add("open");
    },
    closeModal: function () {
      overlay.classList.remove("open");
    },
    login: async function () {
      const email = document.getElementById("auth-email").value.trim();
      const pass = document.getElementById("auth-pass").value;
      hideError();
      try {
        await auth.signInWithEmailAndPassword(email, pass);
        this.closeModal();
      } catch (e) {
        showError(translateError(e.code));
      }
    },
    showRegister: function() {
      document.getElementById("auth-title").textContent = "Регистрация";
      document.getElementById("auth-subtitle").textContent = "Заполните данные для создания аккаунта";
      document.getElementById("auth-fio-fields").style.display = "";
      document.getElementById("auth-main-btn").textContent = "Зарегистрироваться";
      document.getElementById("auth-main-btn").onclick = function() { CFDAuth.register(); };
      document.getElementById("auth-alt-btn").textContent = "Уже есть аккаунт";
      document.getElementById("auth-alt-btn").onclick = function() { CFDAuth.showLogin(); };
      document.getElementById("auth-switch").style.display = "none";
    },
    showLogin: function() {
      document.getElementById("auth-title").textContent = "Вход";
      document.getElementById("auth-subtitle").textContent = "Войдите, чтобы отправлять результаты расчётов";
      document.getElementById("auth-fio-fields").style.display = "none";
      document.getElementById("auth-main-btn").textContent = "Войти";
      document.getElementById("auth-main-btn").onclick = function() { CFDAuth.login(); };
      document.getElementById("auth-alt-btn").textContent = "У меня нет аккаунта";
      document.getElementById("auth-alt-btn").onclick = function() { CFDAuth.showRegister(); };
      document.getElementById("auth-switch").style.display = "";
    },
    register: async function () {
      const email = document.getElementById("auth-email").value.trim();
      const pass = document.getElementById("auth-pass").value;
      const fio = (document.getElementById("auth-fio").value || "").trim();
      const studyGroup = (document.getElementById("auth-study-group").value || "").trim();
      hideError();
      if (!fio) { showError("Введите ФИО"); return; }
      if (!studyGroup) { showError("Введите учебную группу"); return; }
      if (pass.length < 6) { showError("Пароль должен быть не менее 6 символов"); return; }
      try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        // Save FIO and study group immediately
        await db.collection("users").doc(cred.user.uid).set({
          email: email,
          fio: fio,
          studyGroup: studyGroup,
          registeredAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        this.closeModal();
      } catch (e) {
        showError(translateError(e.code));
      }
    },
    logout: async function () {
      await auth.signOut();
      this.closeModal();
    },
    resetPassword: async function () {
      const email = document.getElementById("auth-email").value.trim();
      if (!email) {
        showError("Введите email для сброса пароля");
        return;
      }
      try {
        await auth.sendPasswordResetEmail(email);
        showError("Ссылка для сброса отправлена на " + email);
        document.getElementById("auth-error").style.background = "#e8f4f0";
        document.getElementById("auth-error").style.color = "#1a6b5a";
      } catch (e) {
        showError(translateError(e.code));
      }
    },
    saveGroup: async function () {
      const group = document.getElementById("auth-group").value;
      if (!group) {
        showError("Выберите группу");
        return;
      }
      if (!currentUser) return;
      try {
        await db.collection("users").doc(currentUser.uid).set(
          { email: currentUser.email, group: group },
          { merge: true }
        );
        userGroup = group;
        updateUI();
        this.closeModal();
      } catch (e) {
        showError("Ошибка сохранения: " + e.message);
      }
    },
    getUser: function () {
      return currentUser;
    },
    getGroup: function () {
      return userGroup;
    },
    // Submit results for a test (called from checklist page)
    submitResults: async function (testId, values) {
      if (!currentUser || !userGroup) {
        this.openModal();
        return false;
      }
      try {
        await db
          .collection("groups")
          .doc(userGroup)
          .collection("results")
          .doc(testId)
          .set({
            values: values,
            submittedBy: currentUser.email,
            submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        return true;
      } catch (e) {
        console.error("Submit error:", e);
        return false;
      }
    },
    // Get results for current group
    getResults: async function (testId) {
      if (!userGroup) return null;
      try {
        const doc = await db
          .collection("groups")
          .doc(userGroup)
          .collection("results")
          .doc(testId)
          .get();
        return doc.exists ? doc.data() : null;
      } catch (e) {
        return null;
      }
    },
  };

  // --- Auth State Listener ---
  auth.onAuthStateChanged(async function (user) {
    currentUser = user;
    if (user) {
      // Ensure user document exists in Firestore (create on first login)
      try {
        const doc = await db.collection("users").doc(user.uid).get();
        if (doc.exists) {
          // Load existing data
          if (doc.data().group) {
            userGroup = doc.data().group;
            document.getElementById("auth-group").value = userGroup;
          }
          window._userApproved = !!doc.data().approved;
          window._userIsAdmin = !!doc.data().isAdmin;
          window._userFio = doc.data().fio || '';
          window._userStudyGroup = doc.data().studyGroup || '';
          window._userRole = doc.data().isAdmin ? 'admin' : 'student';
          // Check superadmin
          if (typeof ADMIN_EMAILS !== 'undefined' && ADMIN_EMAILS.includes(user.email)) {
            window._userRole = 'superadmin';
            window._userIsAdmin = true;
          }
        } else {
          // First login — create user document so admin can see them
          await db.collection("users").doc(user.uid).set({
            email: user.email,
            approved: false,
            registeredAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          window._userApproved = false;
          window._userIsAdmin = false;
          window._userFio = '';
          window._userRole = 'student';
        }
      } catch (e) {
        console.warn("Could not load/create user:", e);
      }
    } else {
      userGroup = null;
    }
    // Dispatch event so comment scripts can react
    window.dispatchEvent(new CustomEvent('authReady', { detail: { user: user, approved: !!window._userApproved } }));
    updateUI();

    // Check for unread DMs and show badge
    if (user && !window._userIsAdmin) {
      checkUnreadDm(user);
    }
  });

  // --- Check unread DMs ---
  async function checkUnreadDm(user) {
    try {
      var admins = (typeof ADMIN_EMAILS !== 'undefined') ? (Array.isArray(ADMIN_EMAILS) ? ADMIN_EMAILS : [ADMIN_EMAILS]) : [];
      if (admins.length === 0) return;
      var adminSnap = await db.collection('users').where('email', '==', admins[0]).limit(1).get();
      if (adminSnap.empty) return;
      var adminUid = adminSnap.docs[0].id;
      var dmId = [user.uid, adminUid].sort().join('_');
      // Listen for unread messages in real-time
      db.collection('dm').doc(dmId).collection('messages')
        .where('readAt', '==', null)
        .onSnapshot(function(snap) {
          var unread = 0;
          snap.forEach(function(doc) {
            if (doc.data().authorUid !== user.uid) unread++;
          });
          showDmBadge(unread);
        }, function() {});
    } catch(e) {}
  }

  function showDmBadge(count) {
    var existing = document.getElementById('dm-unread-badge');
    if (existing) existing.remove();
    if (count <= 0) return;
    var container = document.getElementById('auth-container');
    if (!container) return;
    var badge = document.createElement('span');
    badge.id = 'dm-unread-badge';
    badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:9px;background:#c44;color:#fff;font-family:JetBrains Mono,monospace;font-size:.6rem;font-weight:700;padding:0 4px;margin-left:4px;cursor:pointer;animation:dm-pulse 2s infinite';
    badge.textContent = count;
    badge.title = count + ' непрочитанных личных сообщений';
    badge.onclick = function() { window.location.href = 'profile.html'; };
    container.appendChild(badge);
    // Add pulse animation if not exists
    if (!document.getElementById('dm-badge-style')) {
      var s = document.createElement('style');
      s.id = 'dm-badge-style';
      s.textContent = '@keyframes dm-pulse{0%,100%{opacity:1}50%{opacity:.6}}';
      document.head.appendChild(s);
    }
  }

  // --- UI Updates ---
  function updateUI() {
    // Find or create the auth container in nav
    let container = document.getElementById("auth-container");
    if (!container) {
      // First run: wrap existing authBtn or create container
      const existingBtn = document.getElementById("authBtn");
      if (existingBtn) {
        container = document.createElement("div");
        container.id = "auth-container";
        container.style.display = "inline-flex";
        container.style.alignItems = "center";
        existingBtn.parentNode.insertBefore(container, existingBtn);
        container.appendChild(existingBtn);
      } else {
        // Create container in nav-bar or global-nav
        const navBar = document.querySelector(".nav-bar") || document.getElementById("global-nav");
        if (navBar) {
          container = document.createElement("div");
          container.id = "auth-container";
          container.style.display = "inline-flex";
          container.style.alignItems = "center";
          navBar.appendChild(container);
        } else return;
      }
    }

    if (currentUser) {
      // Show user info bar
      var roleBadge = '';
      if (window._userRole === 'superadmin') roleBadge = '<span style="font-family:JetBrains Mono,monospace;font-size:.62rem;background:#faeeda;color:#854f0b;padding:1px 5px;border-radius:3px;font-weight:700">главный</span>';
      else if (window._userRole === 'admin') roleBadge = '<span style="font-family:JetBrains Mono,monospace;font-size:.62rem;background:#fde8e8;color:#c44;padding:1px 5px;border-radius:3px">admin</span>';
      container.innerHTML = `
        <div class="auth-user-bar">
          <span class="email">${window._userRole === "superadmin" ? "Admin" : (window._userFio || currentUser.email)}</span>
          ${roleBadge}
          ${userGroup ? '<span class="group-badge">' + userGroup.replace("group_", "Гр.") + "</span>" : ""}
          <button class="auth-btn" onclick="CFDAuth.openModal()" style="font-size:.68rem;padding:.25rem .5rem">Профиль</button>
        </div>
      `;
      // Show profile view in modal
      document.getElementById("auth-login-view").style.display = "none";
      document.getElementById("auth-profile-view").style.display = "";
      document.getElementById("auth-profile-email").textContent = currentUser.email;
    } else {
      // Show login button
      container.innerHTML = '<button class="auth-btn" onclick="CFDAuth.openModal()">Войти</button>';
      // Show login view in modal, clear fields
      document.getElementById("auth-login-view").style.display = "";
      document.getElementById("auth-profile-view").style.display = "none";
      document.getElementById("auth-email").value = "";
      document.getElementById("auth-pass").value = "";
    }
  }

  function showError(msg) {
    const el = document.getElementById("auth-error");
    el.textContent = msg;
    el.style.display = "";
    el.style.background = "";
    el.style.color = "";
  }
  function hideError() {
    document.getElementById("auth-error").style.display = "none";
  }

  function translateError(code) {
    const map = {
      "auth/email-already-in-use": "Этот email уже зарегистрирован",
      "auth/invalid-email": "Некорректный email",
      "auth/user-not-found": "Пользователь не найден",
      "auth/wrong-password": "Неверный пароль",
      "auth/weak-password": "Слишком простой пароль (мин. 6 символов)",
      "auth/too-many-requests": "Слишком много попыток, подождите",
      "auth/invalid-credential": "Неверный email или пароль",
    };
    return map[code] || "Ошибка: " + code;
  }

  // Auth button is managed by updateUI()

  // Close modal on overlay click
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) CFDAuth.closeModal();
  });

  // Close on Escape
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") CFDAuth.closeModal();
  });
})();
