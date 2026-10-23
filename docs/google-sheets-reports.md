# Обращения «Сообщить о проблеме» → Google Таблица

Сервер после сохранения каждого обращения отправляет его строкой в таблицу через веб-приложение Apps Script. Если таблица недоступна, обращение всё равно сохраняется в базе и видно в админке, а в лог пишется предупреждение `Report sheet: …`.

## Настройка (5 минут)

1. Создайте Google Таблицу, например «Осколок — обращения».
2. Откройте «Расширения → Apps Script», замените код на скрипт ниже и сохраните.
3. В строке `SECRET` придумайте длинную случайную строку.
4. Нажмите «Развернуть → Новое развертывание → Веб-приложение»:
   - «Выполнять как»: **Я**;
   - «У кого есть доступ»: **Все**. Сам адрес никому не показывается, а без секрета скрипт строки не принимает.
5. Скопируйте URL веб-приложения (`https://script.google.com/macros/s/…/exec`) и добавьте в `.env` сервера:

```env
REPORTS_SHEET_WEBHOOK_URL=https://script.google.com/macros/s/…/exec
REPORTS_SHEET_SECRET=та-же-строка-что-в-скрипте
```

6. Перезапустите сервер и отправьте тестовое обращение — в таблице появится строка.

## Скрипт

```js
const SECRET = 'замените-на-длинную-случайную-строку';
const HEADER = ['Дата', '№', 'Тип', 'Причина', 'Описание', 'Пользователь', 'Страница', 'Трек', 'Вложений', 'Диагностика', 'Статус'];

function doPost(e) {
  const data = JSON.parse(e.postData.contents || '{}');
  if (data.secret !== SECRET) return ContentService.createTextOutput('forbidden');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADER.length).setFontWeight('bold');
  }
  sheet.appendRow([
    new Date(data.createdAt), String(data.id || '').slice(0, 8), data.kindLabel || data.kind,
    data.reason || '', data.description || '', data.user || '', data.page || '',
    data.track || '', data.attachments || 0, data.diagnostics || '', 'Новое',
  ]);
  return ContentService.createTextOutput('ok');
}
```

Колонка «Статус» заполняется вручную, сервер её не трогает. Вложения (скриншоты, аудио) в таблицу не уходят: их смотрят в админке по номеру обращения.
