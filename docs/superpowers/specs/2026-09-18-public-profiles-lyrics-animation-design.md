# Публичные профили и новая анимация текста — дизайн

Дата: 2026-09-18
Статус: утверждён к реализации

## 1. Контекст

Осколок — музыкальный плеер (React 18 + Vite, Express, Prisma/SQLite).
Тексты песен публикуются как `LyricContribution` (поля `userId`, `credit`,
`lyricsData`); заявки на публикацию хранятся в `LyricSubmission` и проходят
ручную проверку через `/api/admin`. `GET /lyrics/:trackId` уже отдаёт
`authorId`, но клиент его не использует.

Текущая анимация текста (`src/components/lyrics/LyricsLine.tsx` + `index.css`)
непрерывно, каждый кадр, пишет CSS-переменные `--glyph-tone` и
`--word-pulse` в DOM-узлы букв; для этого текст режется на графемы
(`Intl.Segmenter`). Это дорого: покадровые записи стилей, `filter`/`text-shadow`
на каждом кадре, несколько rAF-циклов.

Цель: показать авторов текста через публичные профили, добавить переход по
профилю автора из-под текста и заменить покадровую буквенную анимацию на
дискретный пословный кроссфейд с тремя состояниями, значительно дешевле по
производительности.

Принятые решения (по итогам вопросов):

- Чужой профиль — отдельная публичная страница `/user/:id`.
- Авторство — строка внизу текста + hover/focus-карточка со ссылкой на профиль.
- Анимация — адаптация в текущий стек без shadcn и без пакета `motion`.
- Кроссфейд — по словам, без внутренней заливки по буквам.
- В публичном профиле видны: ник, аватар, баннер, био, `@username`, публичная
  музыка профиля и опубликованные тексты. Заявки и приватные данные скрыты.

## 2. Публичный профиль

### 2.1 Backend

Новый `server/src/controllers/publicProfileController.ts`. Маршруты
регистрируются в `server/src/routes/api.ts` после `router.use(userIdentity)`,
то есть доступны любому вошедшему пользователю:

- `GET /users/:id` — публичный профиль;
- `GET /users/:id/summary` — лёгкая карточка для hover.

Ответ `GET /users/:id` (в `data`):

```ts
{
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string;   // creatorProfile.avatarUrl || user.avatarUrl || ""
  bannerUrl: string;   // creatorProfile.bannerUrl || ""
  bio: string;         // creatorProfile.bio || ""
  music: Track[];      // ProfileMusic.trackData, по addedAt desc
  contributions: Array<{
    id: string;
    trackId: string;
    trackTitle: string;
    artistName: string;
    credit: string;
    updatedAt: string;
  }>;                  // только LyricContribution, без lyricsData
}
```

Ответ `GET /users/:id/summary` (в `data`):

```ts
{
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string;
  bio: string;
  textsCount: number;  // число опубликованных LyricContribution
  musicCount: number;  // число ProfileMusic
}
```

Правила:

- `displayName` — `creatorProfile.displayName || user.name || "Слушатель"`.
- Если пользователь не найден — `404`
  `{error:{message:"Пользователь не найден."}}`.
- `Cache-Control: no-store`, как у остальных профильных маршрутов.
- `lyricsData`, `LyricSubmission`, `TelegramConnection`, `WebSession` и
  внутренние id наружу не отдаются.

### 2.2 Frontend

- `src/api/apiClient.ts`: `getPublicProfile(id): Promise<PublicProfile>`,
  `getUserSummary(id): Promise<UserSummary>`.
- `src/types/index.ts`: типы `PublicProfile`, `UserSummary`.
- `src/App.tsx`: маршрут `user/:id` → `<PublicProfilePage />` внутри `Layout`.
- `src/pages/PublicProfilePage.tsx` (новый):
  - загрузка через `useQuery` (`@tanstack/react-query` уже подключён в `App`);
  - шапка в стиле `ProfilePage`: баннер, аватар, имя, `@username`, био,
    счётчики «N треков · M текстов»;
  - секция «Музыка в профиле» — существующий `TrackRow`;
  - секция «Опубликованные тексты» — ссылки на `/track/:trackId`
    (`artistName — trackTitle`);
  - если `userId` совпадает с текущим — ссылка/редирект на `/profile`.
    Текущий id вычисляется как `telegram:${useTelegramStore.user.id}`
    (см. `server/src/middleware/userIdentity.ts`);
  - состояния загрузки/ошибки/пусто в существующих классах (`frost-panel`,
    `profile-*`), без кнопок редактирования и без вкладки заявок.

## 3. Авторство текста и карточка автора

### 3.1 Backend

`server/src/controllers/lyricsController.ts`: при наличии `LyricContribution`
добавить в ответ структурированного автора (join `User` + `CreatorProfile`):

```ts
author: {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string;
  credit: string;
}
```

Поле `authorId` сохраняется для совместимости.

### 3.2 Frontend

- `LyricsData` расширяется необязательным `author?`.
- `LyricsView` под блоком скролла (в `lyrics-footer` или отдельной строкой
  над ним) рендерит строку автора, если `author` присутствует:
  - аватар (или монограмма), `credit || displayName`, `@username`;
  - для каталоговых текстов без автора строка не показывается.
- `src/components/profile/AuthorCard.tsx` (новый): карточка-поповер над
  строкой автора. Открывается на hover (с небольшой задержкой) и на
  focus; закрывается на mouse leave, blur и Escape.
  Содержит: аватар, имя, `@username`, био, «N текстов», кнопку
  «Открыть профиль». Данные — `useQuery` на `/users/:id/summary`, `enabled`
  только когда карточка открыта.
- Клик по строке автора или по кнопке карточки — переход на `/user/:id`
  (`react-router-dom` `Link`/`useNavigate`).
- Если автор — текущий пользователь (`author.id === telegram:${user.id}`):
  показываем «Это вы» и ведём на `/profile`.
- Карточка — позиционированный `div` в существующем визуальном языке
  (frost-panel, тени, скругления), без новых зависимостей.

## 4. Анимация чтения

### 4.1 Состояния слова

Для слова с интервалом `[start, end]` в момент времени `t`:

- `t < start` — `unread`: серый (`--lyric-dim`);
- `start <= t < end` — `reading`: кроссфейд серое→белое, лёгкий подъём
  (~6px), длительность ~0.5s, ease-out `cubic-bezier(0.16, 1, 0.3, 1)`;
- `t >= end` — `read`: белый (`--lyric-lit`), без движения.

После завершения перехода слово остаётся белым. Перематывание назад
понижает число зажжённых слов, потому что состояние — чистая функция
времени, а не накопленный флаг.

Для строк без `words` (только строчные метки) кроссфейд применяется ко всей
строке по `line.time` / `line.end`. Заливки по буквам и графем больше нет.

### 4.2 Расчёт состояний

В `src/utils/lyricMotion.ts` вместо `glyphMotion`, `splitGraphemes`,
`wordPulse` — чистые функции без DOM:

- `litWordCount(time, words): number` — сколько слов уже началось
  (`start <= time`), т.е. сколько слов «зажжено»;
- `singingWordIndex(time, words): number` — индекс слова в интервале
  `[start, end)`, иначе `-1` (для подъёма активного слова);
- `isLineRevealed(time, line): boolean` — для строчного режима.

Функции тестируются юнит-тестами.

### 4.3 `LyricsView`

- Один планировщик времени: rAF крутится только при `isPlaying`; подписка
  `audioManager.subscribe({onTimeUpdate})` обрабатывает seek/pause.
- Границы (`boundaries`) расширяются стартами слов (плюс существующие времена
  и концы строк). Покадрово выполняется только бинарный поиск по границам;
  React-состояние `{activeLine, litCount, singingIndex}` обновляется лишь
  когда меняется индекс границы.
- Дублирующий вызов `update` из rAF и подписки сохраняется идемпотентным
  (обновление только при смене индекса).
- `LyricsLine` — memo; при смене слова перерисовывается только активная
  строка (её пропсы меняются), остальные строки пропускаются.

### 4.4 `LyricsLine`

- Убрать: rAF-цикл, refs, графемы, `--glyph-tone`, `--word-pulse`,
  покадровые записи стилей.
- Пропсы: `{line, isActive, isSung, litCount, singingIndex, onSeek}`;
  `offset` больше не нужен внутри компонента.
- Слова рендерятся как `span.lyric-word` с классами:
  - `is-lit` — индекс `< litCount`;
  - `is-singing` — `singingIndex`;
  - цвет «прочитано» задаётся классом строки `.sung` (уже существует),
    а не отдельным классом слова.
- Текст строки остаётся доступным: контейнер с `aria-label`, визуальные
  слова — `aria-hidden`.

### 4.5 CSS (`src/index.css`)

- `.lyric-word`: базовый цвет `--lyric-dim`; `transition: color .5s
  cubic-bezier(0.16,1,0.3,1), transform .5s ...`.
- `.lyric-word.is-lit`, `.lyric-word.is-singing`, `.sung .lyric-word` —
  `--lyric-lit`.
- `.lyric-word.is-singing` — статичный подъём и свечение (без покадровых
  `filter`/`text-shadow`).
- Удалить правила `--glyph-tone`, `--glyph-fill`, `--glyph-reveal`,
  `--word-pulse`, `.lyric-glyph`.
- `will-change: color, transform` только у слов активной строки.
- Вернуть `.lyric-slot { content-visibility:auto; contain-intrinsic-size:auto 110px }`,
  чтобы далёкие строки не рендерились. Если центрирование активной строки
  сломается — откатить этот пункт.
- `@media (prefers-reduced-motion: reduce)`: без подъёма/свечения, мгновенная
  смена цвета.

### 4.6 Документация

Обновить `docs/interference.md` (раздел про проявление букв): описать новый
пословный кроссфейд и удаление буквенной интерполяции.

## 5. Доступность

- Строка автора и карточка доступны с клавиатуры, закрываются по Escape.
- Hover-карточка не является единственным способом: клик по строке автора
  тоже ведёт в профиль.
- `prefers-reduced-motion` отключает движение, текст остаётся читаемым.
- Публичная страница использует семантические заголовки и ссылки.

## 6. Тесты

- `tests/lyricMotion.test.ts` — переписать под `litWordCount`,
  `singingWordIndex`, `isLineRevealed`: границы, пустые/нулевые интервалы,
  перемотка назад.
- `tests/lyricsRendering.test.tsx` — активная строка имеет `is-lit` /
  `is-singing`; прочитанная — `is-sung`; у неактивной нет зажжённых слов;
  `lyric-glyph` больше не встречается; строчный режим не изобретает слова.
- Прогон: `npm test`, `npm run typecheck`.

## 7. Вне рамок

- Подключение shadcn и пакета `motion`.
- Поиск/лента пользователей, подписки, уведомления.
- Изменение входа через Telegram и приватных настроек.
- Публикация локальных (не одобренных) текстов.

## 8. Риски

- `content-visibility:auto` может влиять на расчёт прокрутки к активной
  строке; при регрессии пункт откатывается, остальная оптимизация остаётся.
- Публичность `ProfileMusic` — осознанное расширение видимости; скрытых
  полей нет, музыка и так добавляется пользователем в профиль.
- Строка автора не показывается для текстов каталога — это ожидаемо.
