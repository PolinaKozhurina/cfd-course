// ============================================================
// Firebase Configuration — CFD Course
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyCi1suitiJ3VnmGOneM-6cwRrHsEBhsG9o",
  authDomain: "cfd-course.firebaseapp.com",
  projectId: "cfd-course",
  storageBucket: "cfd-course.firebasestorage.app",
  messagingSenderId: "869540217179",
  appId: "1:869540217179:web:d522254c167250dc241a7e"
};

// ============================================================
// Администраторы
// ============================================================
const ADMIN_EMAILS = ["polinakozhurina2020@gmail.com"];

// ============================================================
// Cloudflare Worker (для загрузки файлов ДЗ в приватный репо)
// ------------------------------------------------------------
// Заполнить после развёртывания worker/ по инструкции worker/README.md.
// Пример: "https://cfd-course-worker.polinakozhurina.workers.dev"
// Пока пусто — загрузка файлов отключена (см. profile.html), студент
// может сдавать только ссылками.
// ============================================================
const WORKER_URL = "https://cfd-course.polinakozhurina2020.workers.dev";

// ============================================================
// E2E: переключение на локальные Firebase-эмуляторы.
// Тесты Playwright ставят localStorage.cfd_use_emulator='1' до загрузки
// страницы (addInitScript). В обычном браузере ветка неактивна.
// ============================================================
(function () {
  try {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem('cfd_use_emulator') !== '1') return;
    // firebase-*-compat SDK и initializeApp уже загружены страницей до config.js
    // — на самом деле config.js грузится ПЕРВЫМ. Отложим useEmulator в
    // одну micro-tick после initializeApp. Оборачиваем в setTimeout,
    // чтобы поймать любой порядок загрузки.
    var apply = function () {
      if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
        return setTimeout(apply, 0);
      }
      if (firebase.auth && !firebase._e2eAuthEmul)     { firebase.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); firebase._e2eAuthEmul = true; }
      if (firebase.firestore && !firebase._e2eFsEmul)  { firebase.firestore().useEmulator('127.0.0.1', 8080); firebase._e2eFsEmul = true; }
      if (firebase.storage && !firebase._e2eStEmul)    { try { firebase.storage().useEmulator('127.0.0.1', 9199); firebase._e2eStEmul = true; } catch (_) {} }
    };
    apply();
  } catch (_) {}
})();
