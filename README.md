# Oskolok — музыкальный плеер

Веб- и десктоп-плеер на React 18, TypeScript, Vite и Tailwind CSS. Десктопная оболочка — Electron, сервер — Express, база данных — SQLite через Prisma (есть отдельная схема PostgreSQL).

## Возможности

- Поиск музыки через SoundCloud, YouTube и каталог Spotify/Deezer.
- Воспроизведение, перемотка, громкость и очередь треков.
- Избранное, плейлисты и история прослушиваний локального пользователя.
- Синхронизированные тексты песен и рекомендации «Моя волна».

## Локальный запуск

Нужны Node.js, npm, Python 3 с модулем `yt-dlp` и ffmpeg для извлечения аудио.

```bash
npm ci
cp .env.example .env
```

В `.env` задайте:

```env
NODE_ENV=development
PORT=5000
DATABASE_URL=file:./dev.db
CORS_ORIGIN=http://localhost:3000
VITE_API_URL=/api
```

Если порт 5000 занят (например, службой AirPlay в macOS), используйте `PORT=5001`. Vite и десктопный запуск учитывают этот порт.

Для Python можно создать локальное окружение:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install yt-dlp
```

Укажите абсолютный путь к Python окружения в `PYTHON_PATH` в `.env`. На Windows это `.venv/Scripts/python.exe`. При необходимости укажите `FFMPEG_PATH`.

```bash
npm run db:push
npm run dev
```

`db:push` нужен при первоначальной настройке или изменении схемы; существующая база содержит плейлисты, избранное и историю.

## Команды

| Команда | Назначение |
|---|---|
| `npm run dev` | Сервер, Vite и окно Electron |
| `npm run dev:web` | Сервер и веб-плеер на http://localhost:3000 |
| `npm run desktop` | Открыть Electron с уже запущенным сервером |
| `npm run build` | Собрать сервер и фронтенд |
| `npm run mobile:test` | Собрать и запустить сервер, бота и временный HTTPS-домен; обновлять кнопку бота при смене адреса |
| `npm run mobile:test:stop` | Остановить мобильный тестовый запуск |
| `npm run typecheck` | Проверить типы клиента и сервера |
| `npm test` | Запустить тесты очереди и текстов песен |

## Структура

- `src/` — страницы, компоненты, состояние и аудиоплеер.
- `server/src/` — API, каталоги музыки, стриминг и работа с базой.
- `electron/` — десктопная оболочка.
- `prisma/` — схемы базы данных и локальная база.
- `tests/` — тесты Vitest.

Настройки серверного размещения описаны в [DEPLOY.md](DEPLOY.md).
Для проверки Mini App на телефоне добавьте `TELEGRAM_BOT_TOKEN` в `.env`, затем запустите `npm run mobile:test`. Текущий адрес находится в `/tmp/oskolok-mobile-tunnel-url`; подробности — в [гайде по Telegram](docs/telegram-feasibility.md).
