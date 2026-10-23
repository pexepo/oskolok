# Сайт oskolok.lol, бета-набор, Telegram-бот и релизы

Документ для разработчика, который впервые открывает проект. Короткая инструкция для владельца: `docs/beta-owner-guide.md`. iOS: `docs/ios.md`.

## Архитектура

Один Vite/React-фронтенд и один Express-сервер (SQLite через Prisma), как и раньше. Новое:

| Адрес | Что это | Код |
|---|---|---|
| `/` | Лендинг | `src/site/pages/Landing.tsx` |
| `/beta` | Заявка на бету | `src/site/pages/BetaPage.tsx` |
| `/beta/status` | Статус заявки (noindex) | `src/site/pages/BetaStatusPage.tsx` |
| `/download`, `/download/ios`, `/download/android`, `/download/desktop` | Загрузки и гайды | `src/site/pages/DownloadPage.tsx`, `IosGuidePage.tsx`, `OtherGuides.tsx` |
| `/privacy` | Политика конфиденциальности | `src/site/pages/PrivacyPage.tsx` |
| `/app/*` | Веб-плеер (прежнее приложение целиком) | `src/App.tsx` с `basename="/app"` |

`src/main.tsx` решает до загрузки бандлов (`src/routing.ts`):

- публичные адреса грузят только `src/site/siteEntry.tsx` (без плеера, Tailwind и Telegram SDK);
- `/app/*` грузит `src/appEntry.tsx` (прежний `main.tsx`);
- старые ссылки плеера (`/search`, `/track/…`, `/users/…`) переписываются на `/app/…` с сохранением query и hash;
- `/` открывает плеер в Electron, Android/iOS-оболочке (`OskolokAndroid/` / `OskolokIOS/` в User-Agent), Telegram Mini App (`tgWebAppData`), установленном PWA и во вкладке, которая была плеером до обновления и перезагрузилась на `/`.

Сервер (`server/src/server.ts`) отдаёт для публичных адресов статический HTML из `dist/site-pages/*.html` с правильными title/description/canonical/Open Graph (их генерирует `scripts/sitePages.mjs` при `npm run build:client`), для `/app` и `/beta/status` ставит `X-Robots-Tag: noindex`. `public/robots.txt`, `dist/sitemap.xml`, `public/og-image.jpg`, `public/manifest.webmanifest`, `public/sw.js`.

PWA: `public/sw.js` кэширует только оболочку и хешированные ассеты; `/api`, `/downloads`, `version.json`, аудио и Range-запросы не трогает. Имя кэша содержит buildId (подставляется `sitePages.mjs`), старые кэши удаляются при активации. Механизм автообновления клиента (`version.json`) не изменён.

## Backend

Новые таблицы (аддитивно, `server/src/database/ensureBetaSchema.ts`, модели в обеих Prisma-схемах):

- `BetaApplication` — заявка. `id` — только номер для показа (#000125). Секреты: `statusTokenHash` (ссылка на статус), `verifyTokenHash` + `verifyExpiresAt` (одноразовая ссылка в бота, 30 минут). `telegramUserId`/`verifiedUsername` появляются только после подтверждения в боте. Состояния доставки: `adminNotifyState`, `adminMessages` (id сообщений у админов), `userNotifyState`.
- Частичный уникальный индекс `BetaApplication_active_telegram_key`: одна активная (pending/approved) заявка на Telegram ID.
- `BetaApplicationEvent` — история (created, verified, approved, rejected, duplicate, comment, reason) с автором.
- `SiteSetting` — `beta.open` (`true`/`false`).
- `AppRelease` — метаданные сборок (platform, variant, version, build_number, release_date, changelog, file_size, checksum, availability, beta_only, storage public/private). Пять опубликованных сборок 1.1.1 добавляются при старте (`seedPublishedReleases`, без перезаписи правок).

Старая версия программы эти таблицы игнорирует, поэтому откат программы не требует отката базы.

API (`server/src/controllers/siteController.ts`, смонтирован в `routes/api.ts` до проверки Telegram-сессии):

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/site/beta` | открыт ли набор, одноразовый билет формы, лимиты |
| POST | `/api/site/beta/applications` | новая заявка → `{number, statusToken, verifyUrl}` |
| POST | `/api/site/beta/status` | статус по `statusToken` (в теле, не в URL) |
| POST | `/api/site/beta/status/verify-link` | новая ссылка подтверждения |
| GET | `/api/site/beta/mine` | заявки вошедшего Telegram-аккаунта и наличие доступа |
| GET | `/api/site/releases` | каталог сборок и статусов платформ |
| POST | `/api/site/releases/:id/link` | (только с бета-доступом) подписанная ссылка на 10 минут |
| GET | `/api/site/releases/:id/file?e&u&s` | выдача закрытой сборки по подписи |

Логика: `server/src/services/betaApplications.ts` (валидация, антиспам, создание, подтверждение, атомарные решения, статистика, экспорт, удаление старых данных), `server/src/services/releases.ts`.

### Защита

- Валидация на сервере (username нормализуется и проверяется по правилам Telegram; тексты 10–1000 символов, удаляются управляющие и bidi-символы; платформы из списка). Текст хранится как есть и нигде не интерпретируется: React экранирует, бот шлёт entities без HTML.
- Антиспам: honeypot-поле, подписанный одноразовый билет формы (не раньше 3 секунд и не позже 6 часов после загрузки), лимит 6 отправок за 15 минут с IP, не больше 4 заявок в сутки с одного отпечатка (HMAC от IP + User-Agent, без хранения адреса), не больше 3 неподтверждённых заявок на username в сутки, глобальный предел 120 неподтверждённых в час. Ответы на сработавший антиспам одинаковые и не раскрывают механизм; события пишутся в журнал как `beta.suspicious`.
- Тело запросов `/api/site` ограничено 16 КБ; изменения требуют JSON и доверенного Origin (существующий `requireTrustedMutation`, защита от CSRF).
- IDOR: статус выдаётся только по 192-битному секрету или по Telegram-сессии; номер заявки ничего не открывает.
- Username никогда не считается доказательством: доступ выдаётся по Telegram ID, подтверждённому ботом.
- Закрытые сборки: проверка беты на сервере, ссылка подписана HMAC, живёт 10 минут; файлы лежат вне Nginx (`PRIVATE_RELEASES_DIR`).
- Секреты: ключи HMAC создаются при первом запуске в `OSKOLOK_PRIVATE_DIR` (`site-form.key`, `site-source.key`, `release-links.key`), токен бота только в `/etc/oskolok/oskolok.env`.
- Хранение: неподтверждённые заявки удаляются через 30 дней, отклонённые и повторные через 180, отпечаток источника обнуляется через 30 дней (`purgeOldApplications`, раз в 6 часов).

## Telegram-бот

Тот же бот @oskolokplayerbot, тот же long polling (`telegramBot.ts`). Вебхук не используется, поэтому secret token вебхука не нужен; если перейти на вебхук, проверять заголовок `X-Telegram-Bot-Api-Secret-Token`.

- `/start beta_<token>` — подтверждение заявки (работает и без беты). Повторное нажатие или чужой аккаунт получают «ссылка недействительна».
- Заявка уходит админам только после подтверждения Telegram: это и фильтр спама, и гарантия, что бот сможет написать заявителю.
- Админы — только числовые ID из `BETA_ADMIN_IDS`. У них отдельное меню команд: `/admin`, `/stats`, `/applications [pending|approved|rejected|unverified] [ios|android|…]`, `/app 125`, `/find username`, `/open_beta`, `/close_beta`, `/beta_status`, `/export` (CSV файлом в чат). Остальные получают обычный кабинет; `/beta_status` у них показывает свою заявку.
- Кнопки `ba:*`: ✅ Принять, ❌ Отклонить, 👤 Профиль (только при подтверждённом username), 📋 Подробнее (история), 💬 Комментарий (внутренний), 📝 Причина отказа (видна заявителю на странице статуса, в Telegram сама не отправляется).

Надёжность (`betaBot.ts`):

- Решение — одна транзакция: compare-and-set `pending → approved/rejected`, запись в историю, выдача `BetaAccess` по Telegram ID. Второе нажатие, второй админ или старая кнопка получают «Уже решено», карточка перерисовывается по базе.
- Сообщения админам и заявителям отправляет очередь (outbox, каждые 20 секунд). 4xx от Telegram (бот заблокирован) — `failed`, 429 — повтор позже, таймаут/5xx — `unknown` без повтора, чтобы не прислать сообщение дважды. После падения процесса «зависшие» отправки помечаются как доставленные/неизвестные.
- Решение сохраняется независимо от того, удалось ли отредактировать сообщение в Telegram.

## Переменные окружения

| Переменная | Значение |
|---|---|
| `BETA_ADMIN_IDS` | числовые Telegram ID админов через запятую (на production `1784522503`) |
| `PUBLIC_SITE_URL` | `https://oskolok.lol` (по умолчанию) |
| `PRIVATE_RELEASES_DIR` | каталог закрытых сборок, на VPS `/var/lib/oskolok/releases` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `OSKOLOK_PRIVATE_DIR` | как раньше |

## Релизы

Публичные файлы: `/var/www/oskolok-downloads` (Nginx пропускает только пять имён). Закрытые: `PRIVATE_RELEASES_DIR`, владелец `oskolok`, права 750.

```sh
sudo -u oskolok bash -c 'set -a; . /etc/oskolok/oskolok.env; cd /opt/oskolok/current && node dist-server/cli/releases.js list'
sudo -u oskolok bash -c 'set -a; . /etc/oskolok/oskolok.env; cd /opt/oskolok/current && node dist-server/cli/releases.js add --platform ios --version 1.0.0 --build 1 --label IPA --private --beta-only --requirements "iOS 15 или новее" --changelog "Первая сборка" --file /var/lib/oskolok/releases/Oskolok-1.0.0-unsigned.ipa'
```

Размер и SHA-256 считаются из файла. `deactivate <id>` скрывает сборку.

## Тесты

- `tests/betaApplications.integration.test.ts` — настоящий Express + SQLite: корректная/некорректная заявка, XSS-текст, honeypot и билет формы, повторы и лимиты, закрытый набор, размер тела, чужой статус, подтверждение и повтор ссылки, гонка подтверждений, уведомление админов с inline-кнопками, одобрение/отклонение/повтор, одновременные решения, посторонний в боте, закрытие/открытие набора, ошибки Telegram (сеть, 429, 403), экспорт CSV с защитой от формул, каталог релизов, закрытая сборка без доступа и по подписи, недоступная база.
- `tests/siteRouting.test.ts` — маршрутизация сайт/плеер, совпадение клиентской и серверной валидации username, статический HTML страниц.

## Развёртывание и откат

`npm run deploy` (см. `DEPLOY.md`). Перед первым выпуском этой версии на VPS один раз добавить в `/etc/oskolok/oskolok.env` `BETA_ADMIN_IDS` и `PRIVATE_RELEASES_DIR` и создать каталог `/var/lib/oskolok/releases`. Откат программы: `ln -sfn /opt/oskolok/releases/<прежний> /opt/oskolok/current && systemctl restart oskolok`; новые таблицы старой версии не мешают.

## Известные ограничения

- Текст поста t.me/oskolokch/15 публично недоступен; описание проекта взято из текста, присланного владельцем, и из кода.
- Иллюстрации гайдов — схемы экранов с настоящими подписями iOS, а не скриншоты с устройства.
- Старые EXE/DMG/APK открывают `/`, сайт сам переводит их на `/app`; новая сборка оболочек не требуется.
- Заявку без подтверждения Telegram админ видит только в `/applications unverified` и может только отклонить.
