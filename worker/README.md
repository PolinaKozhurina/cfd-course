# CFD Course Worker — деплой на Cloudflare (10 минут)

Этот Worker принимает файл от студента → кладёт в приватный репо
`PolinaKozhurina/cfd-submissions`; отдаёт файл автору или админу.
Free-тариф Cloudflare, без карты.

## 1. Создать Worker

1. https://dash.cloudflare.com/ → **Workers & Pages** (в левой панели) → **Create** → **Create Worker**.
2. Имя: `cfd-course-worker` (можно любое; станет частью URL).
3. Кнопка **Deploy** внизу — задеплоит заглушку «Hello World».
4. **Edit code** → откроется веб-редактор.

## 2. Вставить код

1. В веб-редакторе слева файл `worker.js` (или `index.js` — зависит от того что дали) — целиком заменить его содержимым файла [`worker/worker.js`](worker.js) из этого репозитория.
2. Нажать **Deploy**. Сохранит и перевыкатит.

## 3. Задать переменные окружения

Кнопка **← назад** к странице Worker-а → вкладка **Settings** → **Variables and Secrets**.

Добавить (кнопка **Add**):

| Тип | Имя | Значение |
|-----|-----|----------|
| Plaintext | `GITHUB_OWNER` | `PolinaKozhurina` |
| Plaintext | `GITHUB_REPO` | `cfd-submissions` |
| Plaintext | `FIREBASE_PROJECT_ID` | `cfd-course` |
| Plaintext | `SUPERADMINS` | `polinakozhurina2020@gmail.com` |
| Plaintext | `ALLOWED_ORIGIN` | `https://polinakozhurina.github.io` |
| **Secret** | `GITHUB_PAT` | `github_pat_…` (см. п.4) |

**Важно:** `GITHUB_PAT` — именно тип **Secret** (Encrypt). После сохранения его нельзя посмотреть, только заменить.

После добавления/изменения любой переменной — сверху появится жёлтая кнопка **Deploy** (или Cloudflare сам перевыкатит).

## 4. Создать GitHub PAT

1. https://github.com/settings/personal-access-tokens/new
2. Token name: `cfd-worker`, Expiration: **No expiration** или год.
3. Resource owner: **PolinaKozhurina**.
4. Repository access: **Only select repositories** → выбрать **cfd-submissions**.
5. Repository permissions: **Contents → Read and write**.
6. **Generate token** → скопировать `github_pat_…`.
7. Вставить в поле `GITHUB_PAT` в Cloudflare (п.3). **Никогда не отправляйте PAT в чат/переписку/код.**

## 5. Проверить

Открыть в браузере: `https://cfd-course-worker.<ваш-логин>.workers.dev/health`

Должно вернуть `{"ok":true,"ts":…}`.

## 6. Дать URL Worker-а сайту

URL посмотреть на странице Worker-а в Cloudflare (сверху, вида
`https://cfd-course-worker.polinakozhurina.workers.dev`).

Скопировать этот URL и написать нам — я вставлю его в
`js/firebase-config.js` как `WORKER_URL`. С этого момента сайт
начнёт грузить файлы через Worker.

## Что дальше

- Файлы студентов лежат в `PolinaKozhurina/cfd-submissions` по пути
  `{courseId}/{aid}/{uid}_{fio}/{timestamp}_{filename}`.
- Права: студент может загрузить/скачать/удалить только свой файл;
  Полина (SUPERADMINS) — любой.
- Курсовому admin читать чужие файлы через Worker пока нельзя (нужно
  добавить его email в `SUPERADMINS` — временное решение, потом
  сделаю проверку через `managedCourses`).

## Диагностика

- **`{"ok":false,"error":"bad iss"}`** — Firebase токен не для этого
  проекта. Проверьте `FIREBASE_PROJECT_ID` = `cfd-course`.
- **`{"ok":false,"error":"forbidden"}`** — не ваш файл и вы не super.
- **`{"ok":false,"error":"github PUT 401: …"}`** — PAT неверный или
  без прав. Перевыпустите с Contents R/W на `cfd-submissions`.
- **`{"ok":false,"error":"github PUT 404: …"}`** — репо `cfd-submissions`
  не существует у `PolinaKozhurina` или PAT не видит его.
- **Логи** — в Cloudflare, страница Worker → **Logs** → **Live** (три
  минуты стрима запросов).
