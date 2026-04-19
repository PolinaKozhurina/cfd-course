// ============================================================
// Firebase Configuration
// ============================================================
// 1. Зайдите на https://console.firebase.google.com
// 2. Создайте проект → Settings → Web app → скопируйте config
// 3. Вставьте значения ниже
// 4. Впишите свой email в ADMIN_EMAILS
// ============================================================

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxxxxxx"
};

// ============================================================
// Администраторы — впишите свой email
// При входе с этого email система даёт права admin
// Можно указать несколько: ["admin1@mail.ru", "admin2@mail.ru"]
// ============================================================
const ADMIN_EMAILS = ["YOUR_EMAIL@university.ru"];
