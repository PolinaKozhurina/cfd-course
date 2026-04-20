# Развёртывание сайта курса — полная инструкция

## Шаг 1. Скачать все файлы (2 минуты)

### Из outputs (Claude) скачайте:
```
index.html              — главная страница
admin.html              — админ-панель
profile.html            — личный кабинет студента
flic_solver.html        — лекция FLIC
godunov_solver.html     — лекция Годунов
mader_solver.html       — лекция Мейдер 2DE
zachet_checklist.html   — чек-лист зачёта
js/firebase-config.js   — конфигурация Firebase
js/auth.js              — модуль авторизации
js/results.js           — проверка результатов
js/checklist-sync.js    — синхронизация галочек
```

### Ваши готовые лекции (уже есть на компьютере):
```
lecture_PIMLE.html
lecture_NonStrust.html
Построение_неструктурированных_сеток.html
mpi_unstructured_lecture.html
```

## Шаг 2. Собрать папку сайта (3 минуты)

Создайте папку `cfd-course-site` и разложите файлы с переименованием:

```
cfd-course-site/
│
├── index.html                      ← из outputs (без изменений)
├── admin.html                      ← из outputs
├── profile.html                    ← из outputs
│
├── flic.html                       ← переименовать flic_solver.html
├── godunov.html                    ← переименовать godunov_solver.html
├── mader.html                      ← переименовать mader_solver.html
├── pimple.html                     ← переименовать lecture_PIMLE.html
├── mesh.html                       ← переименовать Построение_неструктурированных_сеток.html
├── unstruct.html                   ← переименовать lecture_NonStrust.html
├── mpi.html                        ← переименовать mpi_unstructured_lecture.html
├── checklist.html                  ← переименовать zachet_checklist.html
│
├── js/
│   ├── firebase-config.js          ← из outputs/js (ЗАПОЛНИТЬ — см. шаг 4)
│   ├── auth.js                     ← из outputs/js
│   ├── results.js                  ← из outputs/js
│   └── checklist-sync.js           ← из outputs/js
│
└── SETUP.md                        ← эта инструкция
```

**Итого: 12 HTML-страниц + 4 JS-файла.**

## Шаг 3. Создать репозиторий на GitHub (3 минуты)

1. Зайти на https://github.com → Sign in
2. Нажать "+" → "New repository"
3. Имя: `cfd-course.github.io` (или любое другое)
4. Public ✓, без README
5. Create repository

В терминале (или через GitHub Desktop):

```bash
cd cfd-course-site
git init
git add .
git commit -m "Course site initial"
git remote add origin https://github.com/ВАШ_ЛОГИН/cfd-course.github.io.git
git branch -M main
git push -u origin main
```

## Шаг 4. Включить GitHub Pages (1 минута)

1. Зайти в репозиторий на GitHub
2. Settings → Pages
3. Source: "Deploy from a branch"
4. Branch: `main`, Folder: `/ (root)`
5. Save

**Через 1-2 минуты сайт доступен по адресу:**
```
https://ВАШ_ЛОГИН.github.io/cfd-course.github.io/
```
или (если имя репозитория точно `ВАШ_ЛОГИН.github.io`):
```
https://ВАШ_ЛОГИН.github.io/
```

На этом этапе сайт уже работает — лекции, солверы, чек-лист.
Авторизация пока отключена (заглушка).

## Шаг 5. Подключить Firebase (10 минут)

### 5.1 Создать проект Firebase
1. Зайти на https://console.firebase.google.com
2. "Add project" → название `cfd-course` → Continue
3. Google Analytics — отключить (не нужен) → Create project

### 5.2 Включить авторизацию
1. Build → Authentication → Get started
2. Sign-in method → Email/Password → Enable → Save

### 5.3 Создать базу данных
1. Build → Firestore Database → Create database
2. **Start in test mode** → Next
3. Регион: europe-west1 (Бельгия) → Enable

### 5.4 Зарегистрировать веб-приложение
1. Project Settings (шестерёнка вверху) → General
2. Внизу: "Your apps" → нажать `</>` (Web)
3. Nickname: `cfd-site` → Register app
4. Появится объект `firebaseConfig` — скопировать значения

### 5.5 Заполнить конфигурацию
Открыть файл `js/firebase-config.js` и вставить ваши данные:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyB...",              ← ваш ключ
  authDomain: "cfd-course.firebaseapp.com",
  projectId: "cfd-course",
  storageBucket: "cfd-course.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc..."
};

const ADMIN_EMAILS = ["ваш_email@university.ru"];  ← ваш email!
```

### 5.6 Раскомментировать скрипты в index.html
Открыть `index.html`, найти закомментированный блок и убрать `<!--` и `-->`:

```html
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
<script src="js/firebase-config.js"></script>
<script src="js/auth.js"></script>
```

### 5.7 Настроить правила безопасности Firestore
Firebase Console → Firestore Database → Rules → заменить на:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /groups/{groupId}/{document=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    match /grades/{groupId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

### 5.8 Загрузить обновления
```bash
git add .
git commit -m "Enable Firebase auth"
git push
```

**Готово! Авторизация работает.**

## Шаг 6. Первый вход как администратор

1. Открыть сайт
2. Нажать "Войти" → Зарегистрироваться с email из `ADMIN_EMAILS`
3. Перейти на `/admin.html`
4. Вы увидите админ-панель (пока пустую — студентов ещё нет)

## Шаг 7. Как пользоваться

### Вы (администратор):

| Действие | Где |
|----------|-----|
| Посмотреть кто зарегистрировался | admin.html → Студенты |
| Назначить студента в группу | admin.html → Студенты → dropdown «Назначить группу» |
| Посмотреть результаты тестов | admin.html → Результаты тестов |
| Посмотреть прогресс чек-листа | admin.html → Чек-лист (самооценка) |
| Поставить оценку | admin.html → Оценки → ввести число + комментарий → Сохр. |
| Скачать всё в Excel | admin.html → Студенты → Экспорт CSV |

### Студенты:

| Действие | Где |
|----------|-----|
| Зарегистрироваться | Любая страница → кнопка «Войти» |
| Узнать свою группу | profile.html (после назначения админом) |
| Изучать лекции | index.html → карточки лекций |
| Запускать солверы | Страницы лекций → кнопка «Запустить» |
| Отмечать готовое в чек-листе | checklist.html → ставить галочки (автосохранение) |
| Отправить контрольные числа | checklist.html → ввести числа → Проверить |
| Посмотреть свой прогресс | profile.html |
| Посмотреть оценку | profile.html → блок «Итоговая оценка» |

### Порядок работы студента:
1. Зарегистрироваться на сайте
2. Подождать пока преподаватель назначит группу
3. Изучить лекцию → запустить солвер → сравнить с эталоном
4. Написать свой код на C++ → получить контрольные числа
5. Зайти в чек-лист → отметить галочки → ввести числа → Проверить
6. Перед зачётом: все галочки должны быть зелёными

## Шаг 8. Обновление сайта

```bash
# Отредактировали файл
git add .
git commit -m "Описание изменений"
git push
# Через 30 секунд изменения на сайте
```

## Структура данных в Firestore

```
users/                              ← профили пользователей
  {uid}/
    email: "ivanov@mail.ru"
    group: "group_01"

groups/                             ← данные по группам
  group_01/
    results/                        ← контрольные числа (автопроверка)
      sod_flic/
        values: { rho_06: "0.4259", allPass: true, ... }
        submittedBy: "ivanov@mail.ru"
        submittedAt: Timestamp
    checklist/                      ← галочки чек-листа (самооценка)
      FLIC_LAGRANGE/
        checked: true
        checkedBy: "ivanov@mail.ru"
        timestamp: Timestamp
      HLLC_SOLVER/
        checked: true
        ...

grades/                             ← оценки (ставит админ)
  group_01/
    grade: "8"
    comment: "Хорошо, но Мейдер не доделан"
    updatedAt: Timestamp
```

## Стоимость

**Всё бесплатно:**
- GitHub Pages: бесплатно (100 GB bandwidth)
- Firebase Auth Spark: бесплатно (3000 DAU)
- Firestore Spark: бесплатно (1 GB хранения, 50K чтений/день)
- Для 50 студентов — запас в 100x

## Рекомендуемые Firestore Rules

Firebase Console → Firestore Database → Rules → заменить на:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users — каждый может читать всех (для админки), писать только свой документ
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    // Task claims — все авторизованные читают, писать может любой
    match /task_claims/{doc} {
      allow read, write: if request.auth != null;
    }
    // Grades — все читают свои, писать может только админ
    match /individual_grades/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if request.auth != null && request.auth.token.email == "polinakozhurina2020@gmail.com";
    }
    // Groups, results, checklist — все авторизованные
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

→ Нажать **Publish**

**Пока для простоты** можно использовать упрощённые правила:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
