# Осколок — панель разработчика

Отдельное приложение для проверки заявок на тексты и публикации TTML/LRC/JSON без очереди.

```bash
cp .env.example .env
npm ci
npm run build
npm start
```

Панель слушает `PORT` (по умолчанию `4100`). Сервер панели проксирует только разрешённые admin-маршруты к `OSKOLOK_API_URL`, поэтому `ADMIN_API_KEY` никогда не попадает в браузер. Для публикации задайте один и тот же `ADMIN_API_KEY` в `.env` плеера и панели, а `PANEL_PASSWORD` используйте только для входа в панель.

Для Docker:

```bash
docker build -t oskolok-developer-panel .
docker run --env-file .env -p 4100:4100 oskolok-developer-panel
```

Перед первым запуском основного сервера выполните `npm run db:push`, чтобы добавить таблицы заявок и музыки профиля.
