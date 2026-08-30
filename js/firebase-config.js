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
