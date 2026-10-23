# Размещение Осколка

Сайт: https://oskolok.lol/ · VPS: 185.166.153.240 · Ubuntu 24.04 · Node 22.23.3.
Nginx проксирует HTTPS на Node, порт 5000 закрыт извне. SQLite используется намеренно; PostgreSQL здесь не установлен.

## Где что находится

- `/opt/oskolok/current` — ссылка на активный выпуск; активный путь определяется командой `readlink -f /opt/oskolok/current`.
- `/etc/oskolok/oskolok.env` — настройки и секреты, доступ только root и службе.
- `/var/lib/oskolok/oskolok.db` — база; `private/` — ключ шифрования и состояние бота; `user-content/` — загрузки.
- `/var/lib/oskolok/data` — кэш аудио, повторно скачивается при необходимости.
- `/opt/oskolok/venv` — Python и музыкальные адаптеры.
- `oskolok.service` — systemd, пользователь `oskolok`, автоматический перезапуск при сбое.
- `/var/backups/oskolok` — ежедневные согласованные снимки SQLite, ключа и загрузок; последние 14.
- `certbot.timer` — продление HTTPS; deploy hook проверяет и перечитывает Nginx.

SSH: `ssh -i ~/.ssh/oskolok_deploy_ed25519 -o IdentitiesOnly=yes root@185.166.153.240`.
Ключи и пароли не добавлять в репозиторий или приложения.

## Обслуживание

```sh
systemctl status oskolok --no-pager
journalctl -u oskolok -n 100 --no-pager
curl -fsS https://oskolok.lol/api/health
systemctl start oskolok-backup
```

Для публикации локальных изменений запустить `npm run deploy`. Команда проверяет сборку и тесты локально и на Linux с отдельной QA-базой, удаляет devDependencies, проверяет production-зависимости, делает backup, переключает ссылку и перезапускает службу. При ошибке запуска автоматически возвращает предыдущий выпуск. Базу, private и user-content она не заменяет. Старые файлы JS/CSS сохраняются, чтобы уже открытые клиенты могли догрузить компоненты во время обновления. Изменения основной Prisma-схемы требуют отдельной совместимой миграции; команда её автоматически не применяет.

Claude: открой этот каталог как проект, дай задачу на изменение исходников. В `CLAUDE.md` записаны правила проекта. После проверки попроси «Опубликуй через npm run deploy». Серверная сборка не мешает редактировать локальные исходники; публикация заменяет только программу, сохраняя данные слушателей.

Сайт и облачные приложения получают изменения интерфейса без переустановки. Открытый клиент проверяет `version.json` при возврате и каждые три минуты. Во время музыки/редактирования/диалога появляется кнопка «Обновить»; в спокойном состоянии перезагрузка выполняется автоматически. После внедрения этого механизма старый открытый клиент нужно один раз закрыть и открыть. Для изменения EXE/DMG/APK-оболочки нужна новая установка.

Восстановление: остановить службу; сохранить текущие данные; распаковать выбранный backup в отдельный каталог; проверить `PRAGMA integrity_check`, восстановить DB вместе с private и user-content, владельца oskolok и закрытые права; запустить службу. Потеря private/session.key лишает доступа к зашифрованным сессиям Telegram.

## Приложения

```sh
OSKOLOK_APP_URL=https://oskolok.lol npm run dist
OSKOLOK_APP_URL=https://oskolok.lol npm run build:dmg
npm run build:apk
```

Результат — `release/distribution/`. EXE и DMG содержат HTTPS-оболочку Electron; APK — Android WebView, Android 8+. Для APK нужны JDK 17, Android SDK platform 35 и build-tools 35.0.0; можно задать JAVA_HOME и ANDROID_HOME. Подпись APK хранится вне проекта в `~/.config/oskolok/android-signing/`; сохранить этот каталог для будущих обновлений, не публиковать.

Windows и macOS пока без сертификата издателя/нотарификации. Android APK подписан собственным постоянным ключом, не опубликован в Google Play. В версии 1.1.1 Android содержит нативную службу воспроизведения, MediaSession и системное уведомление; фон и кнопки требуют проверки на реальном устройстве. Установка на Windows/Android ещё не проверена на устройствах.

Публичные сборки 1.1.1 находятся в `/var/www/oskolok-downloads`; Nginx разрешает только пять имён файлов. Ссылки: `/downloads/Oskolok-Setup.exe`, `/downloads/Oskolok-Portable.exe`, `/downloads/Oskolok.apk`, `/downloads/Oskolok-arm64.dmg`, `/downloads/Oskolok-x64.dmg`. Эти файлы обновляются отдельно от `npm run deploy`; перед заменой проверять подпись APK и SHA-256. Данные в `/var/lib/oskolok` остаются закрытыми.

Старые EXE вне distribution не распространять: они содержат личные данные.

## Docker

Dockerfile и compose исправлены под SQLite и Python-адаптеры. База и ключи вынесены в постоянный том, порт привязан к loopback, процесс не root. Контекст исключает секреты, базы, загрузки и архивы. Docker на этом VPS не используется; контейнерная сборка здесь не проверена. Архивная Oracle/PM2/PostgreSQL-инструкция сохранена отдельно в docs/deploy-oracle-legacy.md.

## Выпуск 2026-10-17 (Резонанс v2, события, импорт)

- Миграция аддитивная: при старте создаются таблицы `TrackEvent`, `UserConsent`, `RecommendationModel`, `PlaylistImportRequest` (`ensureTelemetrySchema`). Существующие таблицы не меняются, поэтому предыдущий выпуск запускается на новой базе без правок.
- Откат программы: `ln -sfn /opt/oskolok/releases/<прежний> /opt/oskolok/current && systemctl restart oskolok` (прежний выпуск хранится; список — `ls -1t /opt/oskolok/releases`). Откат данных не нужен: новые таблицы старая версия игнорирует. Если всё же нужно удалить собранные события — `DROP TABLE` этих четырёх таблиц после остановки службы; восстанавливать старую базу целиком нельзя без оценки потери новых записей слушателей.
- Триггеры отката: служба не стартует или `/api/health` не `ok` дольше 2 минут; рост ошибок уровня 50 в журнале выше обычного (до выпуска — 0 за час); массовые `AUDIO_UNAVAILABLE`; доступ к чужому приватному плейлисту.
- Версии ранжирования: `node dist-server/cli/recs.js list|evaluate|save|activate` (запуск от `oskolok` с `DATABASE_URL` из `/etc/oskolok/oskolok.env`). Откат весов — `activate <прежняя версия>` или `activate builtin`.

## Выпуск 2026-10-18 (сайт, бета-заявки, загрузки, iOS)

- Публичный сайт: `/`, `/beta`, `/beta/status`, `/download`, `/download/ios|android|desktop`, `/privacy`. Плеер переехал на `/app`; старые адреса (`/search`, `/track/…`, `/users/…`) редиректятся на `/app/…`, оболочки EXE/DMG/APK и Telegram Mini App на `/` попадают в плеер. Подробно: `docs/site-and-beta.md`.
- Миграция аддитивная (`ensureBetaSchema`): таблицы `BetaApplication`, `BetaApplicationEvent`, `SiteSetting`, `AppRelease` и индексы. Предыдущий выпуск на новой базе запускается без правок.
- В `/etc/oskolok/oskolok.env` добавлены `BETA_ADMIN_IDS=1784522503` и `PRIVATE_RELEASES_DIR=/var/lib/oskolok/releases` (копия до изменения: `oskolok.env.bak-20261018`); каталог `/var/lib/oskolok/releases` (oskolok, 750) создан.
- Управление набором — в боте (`docs/beta-owner-guide.md`). Публикация сборок — `node dist-server/cli/releases.js` (`docs/site-and-beta.md`, раздел «Релизы»).
- iOS: исходники `ios/`, сборка в приватном `pexepo/oskolok-ios` через GitHub Actions (`docs/ios.md`).
- Откат программы: `ln -sfn /opt/oskolok/releases/<прежний> /opt/oskolok/current && systemctl restart oskolok`. Переменные окружения старой версии не мешают. Триггеры отката: `/api/health` не `ok`, главная или `/app` не открываются, массовые 5xx на `/api/site/*`.
