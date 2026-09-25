# Публичные профили и новая анимация текста — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователям смотреть чужие профили и переходить в профиль автора текста, а также заменить покадровую буквенную анимацию текста на дешёвый пословный кроссфейд из трёх состояний.

**Architecture:** Express/Prisma получает публичные read-only маршруты `/users/:id` и `/users/:id/summary`, а `GET /lyrics/:trackId` — структурированного автора. На клиенте появляются `PublicProfilePage` и `AuthorCard`; `lyricMotion.ts` превращается в чистые функции расчёта состояний, `LyricsView` планирует время одним rAF-циклом, `LyricsLine` проставляет словам классы, а `index.css` рисует кроссфейд через CSS-переходы.

**Tech Stack:** TypeScript (strict), React 18, react-router-dom 6, @tanstack/react-query 5, Express 4, Prisma 5 (SQLite), Vite 5, Vitest 2, Tailwind 3 (только классы; основной стиль — `src/index.css`).

## Global Constraints

- Никаких новых зависимостей: `shadcn` и пакет `motion` не подключать; анимации — на существующем CSS и `framer-motion` не трогать.
- `npm test` и `npm run typecheck` должны проходить после каждого изменения.
- TypeScript strict; `.js`-расширения в импортах клиента и сервера сохранять как в существующем коде.
- Пользовательские строки — на русском; имена файлов, функций и CSS-классов — ASCII.
- Публичные маршруты доступны только вошедшим (они находятся после `router.use(userIdentity)`).
- Наружу не отдавать `lyricsData`, `LyricSubmission`, `TelegramConnection`, `WebSession`, `tokenHash` и иные приватные поля.
- Коммиты делать только если пользователь явно попросил. Шаги «Commit» ниже считать необязательными и по умолчанию пропускать.

---

## Файловая структура

Backend:

- `server/src/controllers/publicProfileController.ts` (создать) — публичный профиль и сводка.
- `server/src/controllers/lyricsController.ts` (изменить) — добавить `author`.
- `server/src/routes/api.ts` (изменить) — зарегистрировать `/users/:id` и `/users/:id/summary`.

Client API/типы/страницы:

- `src/types/index.ts` (изменить) — `PublicProfile`, `UserSummary`, `LyricAuthor`, `LyricsData.author`.
- `src/api/apiClient.ts` (изменить) — `getPublicProfile`, `getUserSummary`.
- `src/pages/PublicProfilePage.tsx` (создать).
- `src/App.tsx` (изменить) — маршрут `user/:id`.

Автор и анимация:

- `src/components/profile/AuthorCard.tsx` (создать).
- `src/components/lyrics/LyricsView.tsx` (изменить) — автор + единый планировщик.
- `src/components/lyrics/LyricsLine.tsx` (изменить) — классы слов.
- `src/utils/lyricMotion.ts` (переписать) — чистые функции.
- `src/index.css` (изменить) — состояния слов и стили автора.

Тесты и документация:

- `tests/publicProfile.test.ts` (создать) — API публичного профиля.
- `tests/lyricsAuthor.test.ts` (создать) — автор в ответе лирики.
- `tests/publicProfilePage.test.tsx` (создать).
- `tests/lyricMotion.test.ts` (переписать).
- `tests/lyricsRendering.test.tsx` (переписать).
- `docs/interference.md` (изменить).

---

### Task 1: Публичный профиль — API

**Files:**
- Create: `server/src/controllers/publicProfileController.ts`
- Modify: `server/src/routes/api.ts`
- Test: `tests/publicProfile.test.ts`

**Interfaces:**
- Consumes: `prisma` из `server/src/database/client.js`; модели `User`, `CreatorProfile`, `ProfileMusic`, `LyricContribution`.
- Produces: `publicProfileController.getPublicProfile` и `publicProfileController.getSummary`, обе `(req: Request, res: Response, next: NextFunction) => Promise<void>`.

- [ ] **Step 1: Написать падающий тест**

Create `tests/publicProfile.test.ts`:

```ts
import {describe,it,expect,vi,beforeEach} from 'vitest';

const db=vi.hoisted(()=>({
  userFindUnique:vi.fn(),
  profileFindUnique:vi.fn(),
  musicFindMany:vi.fn(),
  musicCount:vi.fn(),
  contributionFindMany:vi.fn(),
  contributionCount:vi.fn(),
}));

vi.mock('../server/src/database/client.js',()=>({prisma:{
  user:{findUnique:db.userFindUnique},
  creatorProfile:{findUnique:db.profileFindUnique},
  profileMusic:{findMany:db.musicFindMany,count:db.musicCount},
  lyricContribution:{findMany:db.contributionFindMany,count:db.contributionCount},
}}));

import {publicProfileController} from '../server/src/controllers/publicProfileController.js';

function mockRes(){
  return {
    statusCode:200,
    body:undefined as any,
    status(code:number){this.statusCode=code;return this;},
    json(payload:any){this.body=payload;return this;},
    setHeader(){return this;},
  };
}

beforeEach(()=>vi.clearAllMocks());

describe('public profile API',()=>{
  it('returns identity, music and published texts without private data',async()=>{
    db.userFindUnique.mockResolvedValue({id:'telegram:7',name:'Борис',username:'boris',avatarUrl:'tg://a'});
    db.profileFindUnique.mockResolvedValue({displayName:'Боря',avatarUrl:'',bannerUrl:'banner://x',bio:'привет'});
    db.musicFindMany.mockResolvedValue([{trackData:JSON.stringify({id:'s:1',title:'Песня'})}]);
    db.contributionFindMany.mockResolvedValue([{id:'c1',trackId:'s:1',trackTitle:'Песня',artistName:'Артист',credit:'boris',updatedAt:new Date('2026-01-01')}]);
    const res=mockRes();
    await publicProfileController.getPublicProfile({params:{id:'telegram:7'}} as any,res as any,()=>{});
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({userId:'telegram:7',username:'boris',displayName:'Боря',bannerUrl:'banner://x',bio:'привет'});
    expect(res.body.data.music[0].title).toBe('Песня');
    expect(res.body.data.contributions[0].trackTitle).toBe('Песня');
    expect(JSON.stringify(res.body)).not.toContain('lyricsData');
  });

  it('returns 404 for an unknown user',async()=>{
    db.userFindUnique.mockResolvedValue(null);
    const res=mockRes();
    await publicProfileController.getPublicProfile({params:{id:'telegram:404'}} as any,res as any,()=>{});
    expect(res.statusCode).toBe(404);
  });

  it('returns counts for the hover summary',async()=>{
    db.userFindUnique.mockResolvedValue({id:'telegram:7',name:'Борис',username:null,avatarUrl:''});
    db.profileFindUnique.mockResolvedValue(null);
    db.musicCount.mockResolvedValue(3);
    db.contributionCount.mockResolvedValue(2);
    const res=mockRes();
    await publicProfileController.getSummary({params:{id:'telegram:7'}} as any,res as any,()=>{});
    expect(res.body.data).toMatchObject({displayName:'Борис',textsCount:2,musicCount:3});
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/publicProfile.test.ts`
Expected: FAIL — модуль `publicProfileController` не найден.

- [ ] **Step 3: Реализовать контроллер**

Create `server/src/controllers/publicProfileController.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../database/client.js';

const FALLBACK_NAME = 'Слушатель';

async function loadIdentity(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const profile = await prisma.creatorProfile.findUnique({ where: { userId } });
  return {
    user,
    displayName: profile?.displayName || user.name || FALLBACK_NAME,
    avatarUrl: profile?.avatarUrl || user.avatarUrl || '',
    bannerUrl: profile?.bannerUrl || '',
    bio: profile?.bio || '',
  };
}

export class PublicProfileController {
  public getPublicProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const userId = req.params.id;
      const identity = await loadIdentity(userId);
      if (!identity) {
        res.status(404).json({ error: { message: 'Пользователь не найден.' } });
        return;
      }
      const [music, contributions] = await Promise.all([
        prisma.profileMusic.findMany({ where: { userId }, orderBy: { addedAt: 'desc' } }),
        prisma.lyricContribution.findMany({
          where: { userId },
          select: { id: true, trackId: true, trackTitle: true, artistName: true, credit: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
        }),
      ]);
      res.json({
        data: {
          userId,
          username: identity.user.username || null,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          bannerUrl: identity.bannerUrl,
          bio: identity.bio,
          music: music.map((item) => JSON.parse(item.trackData)),
          contributions,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public getSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const userId = req.params.id;
      const identity = await loadIdentity(userId);
      if (!identity) {
        res.status(404).json({ error: { message: 'Пользователь не найден.' } });
        return;
      }
      const [textsCount, musicCount] = await Promise.all([
        prisma.lyricContribution.count({ where: { userId } }),
        prisma.profileMusic.count({ where: { userId } }),
      ]);
      res.json({
        data: {
          userId,
          username: identity.user.username || null,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          bio: identity.bio,
          textsCount,
          musicCount,
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

export const publicProfileController = new PublicProfileController();
```

- [ ] **Step 4: Зарегистрировать маршруты**

Modify `server/src/routes/api.ts`: add the import next to the other controller imports, and register the two explicit routes after `router.use(userIdentity);`:

```ts
import { publicProfileController } from '../controllers/publicProfileController.js';
```

```ts
router.get('/users/:id/summary', publicProfileController.getSummary);
router.get('/users/:id', publicProfileController.getPublicProfile);
```

Place it after `router.use(userIdentity);` and before `router.use('/profile', profileRoutes);`.

- [ ] **Step 5: Запустить тест**

Run: `npx vitest run tests/publicProfile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit (только по явному запросу)**

```bash
git add server/src/controllers/publicProfileController.ts server/src/routes/api.ts tests/publicProfile.test.ts
git commit -m "feat: add public profile API"
```

---

### Task 2: Автор в ответе лирики

**Files:**
- Modify: `server/src/controllers/lyricsController.ts`
- Test: `tests/lyricsAuthor.test.ts`

**Interfaces:**
- Consumes: `publicProfileController` не нужен; модели `LyricContribution`, `User`, `CreatorProfile`.
- Produces: поле `author: { id, username, displayName, avatarUrl, credit }` в `data` ответа `GET /api/lyrics/:trackId`.

- [ ] **Step 1: Написать падающий тест**

Create `tests/lyricsAuthor.test.ts`:

```ts
import {describe,it,expect,vi,beforeEach} from 'vitest';

const db=vi.hoisted(()=>({
  contributionFindFirst:vi.fn(),
  userFindUnique:vi.fn(),
  profileFindUnique:vi.fn(),
}));

vi.mock('../server/src/database/client.js',()=>({prisma:{
  lyricContribution:{findFirst:db.contributionFindFirst},
  user:{findUnique:db.userFindUnique},
  creatorProfile:{findUnique:db.profileFindUnique},
}}));
vi.mock('../server/src/services/LyricsService.js',()=>({lyricsService:{getLyrics:vi.fn()}}));

import {lyricsController} from '../server/src/controllers/lyricsController.js';

function mockRes(){
  return {statusCode:200,body:undefined as any,json(payload:any){this.body=payload;return this;},status(code:number){this.statusCode=code;return this;}};
}

beforeEach(()=>vi.clearAllMocks());

it('attaches structured author info to an Oskolok contribution',async()=>{
  db.contributionFindFirst.mockResolvedValue({userId:'telegram:7',credit:'boris',lyricsData:JSON.stringify([{time:0,text:'строка'}])});
  db.userFindUnique.mockResolvedValue({id:'telegram:7',name:'Борис',username:'boris',avatarUrl:'tg://a'});
  db.profileFindUnique.mockResolvedValue({displayName:'Боря',avatarUrl:'avatar://x'});
  const res=mockRes();
  await lyricsController.getLyrics({params:{trackId:'s:1'},query:{}} as any,res as any,()=>{});
  expect(res.body.data.author).toEqual({id:'telegram:7',username:'boris',displayName:'Боря',avatarUrl:'avatar://x',credit:'boris'});
  expect(res.body.data.authorId).toBe('telegram:7');
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/lyricsAuthor.test.ts`
Expected: FAIL — `res.body.data.author` is `undefined`.

- [ ] **Step 3: Добавить автора**

Modify `server/src/controllers/lyricsController.ts`. Replace the block

```ts
      const contribution=await prisma.lyricContribution.findFirst({where:{trackId},orderBy:{updatedAt:'desc'}});
      if(contribution){res.json({data:{trackId,isSynced:true,syncedLyrics:JSON.parse(contribution.lyricsData),provider:`Осколок · ${contribution.credit}`,authorId:contribution.userId}});return;}
```

with:

```ts
      const contribution=await prisma.lyricContribution.findFirst({where:{trackId},orderBy:{updatedAt:'desc'}});
      if(contribution){
        const [user,profile]=await Promise.all([
          prisma.user.findUnique({where:{id:contribution.userId}}),
          prisma.creatorProfile.findUnique({where:{userId:contribution.userId}}),
        ]);
        const author={
          id:contribution.userId,
          username:user?.username||null,
          displayName:profile?.displayName||user?.name||'Слушатель',
          avatarUrl:profile?.avatarUrl||user?.avatarUrl||'',
          credit:contribution.credit,
        };
        res.json({data:{trackId,isSynced:true,syncedLyrics:JSON.parse(contribution.lyricsData),provider:`Осколок · ${contribution.credit}`,authorId:contribution.userId,author}});
        return;
      }
```

- [ ] **Step 4: Запустить тест**

Run: `npx vitest run tests/lyricsAuthor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (только по явному запросу)**

```bash
git add server/src/controllers/lyricsController.ts tests/lyricsAuthor.test.ts
git commit -m "feat: expose lyric author in lyrics API"
```

---

### Task 3: Клиентские типы и API

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/apiClient.ts`

**Interfaces:**
- Produces: `PublicProfile`, `PublicProfileContribution`, `UserSummary`, `LyricAuthor`, `LyricsData.author`.
- Produces: `apiClient.getPublicProfile(id)` и `apiClient.getUserSummary(id)`.

- [ ] **Step 1: Добавить типы**

Modify `src/types/index.ts`. Перед `export interface LyricsData` добавить:

```ts
export interface LyricAuthor {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string;
  credit: string;
}
```

В `LyricsData` добавить строку:

```ts
  author?: LyricAuthor;
```

В конец файла добавить:

```ts
export interface PublicProfileContribution {
  id: string;
  trackId: string;
  trackTitle: string;
  artistName: string;
  credit: string;
  updatedAt: string;
}

export interface PublicProfile {
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string;
  bannerUrl: string;
  bio: string;
  music: Track[];
  contributions: PublicProfileContribution[];
}

export interface UserSummary {
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string;
  bio: string;
  textsCount: number;
  musicCount: number;
}
```

- [ ] **Step 2: Добавить методы API**

Modify `src/api/apiClient.ts`. Обновить импорт типов:

```ts
  PublicProfile,
  UserSummary,
```

Добавить перед закрывающей `}` класса (после `getRecommendations`):

```ts
  public async getPublicProfile(id: string): Promise<PublicProfile> {
    return this.request<PublicProfile>(`/users/${encodeURIComponent(id)}`);
  }

  public async getUserSummary(id: string): Promise<UserSummary> {
    return this.request<UserSummary>(`/users/${encodeURIComponent(id)}/summary`);
  }
```

- [ ] **Step 3: Проверить типы**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit (только по явному запросу)**

```bash
git add src/types/index.ts src/api/apiClient.ts
git commit -m "feat: add public profile client types and API"
```

---

### Task 4: Страница публичного профиля

**Files:**
- Create: `src/pages/PublicProfilePage.tsx`
- Modify: `src/App.tsx`
- Test: `tests/publicProfilePage.test.tsx`

**Interfaces:**
- Consumes: `apiClient.getPublicProfile`, `PublicProfile`, `TrackRow`, `useTelegramStore`.
- Produces: компонент `PublicProfilePage`, маршрут `/user/:id`.

- [ ] **Step 1: Написать падающий тест**

Create `tests/publicProfilePage.test.tsx`:

```tsx
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {describe,it,expect,vi,beforeEach} from 'vitest';

vi.mock('../src/api/apiClient.js',()=>({apiClient:{getPublicProfile:vi.fn(),getUserSummary:vi.fn()}}));

import {PublicProfilePage} from '../src/pages/PublicProfilePage.js';
import {useTelegramStore} from '../src/telegram/runtime.js';

const profile={userId:'telegram:7',username:'boris',displayName:'Борис',avatarUrl:'',bannerUrl:'',bio:'привет',music:[],contributions:[]};

function renderAt(id:string){
  const client=new QueryClient();
  client.setQueryData(['public-profile',id],profile);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/user/${id}`]}>
        <Routes><Route path="/user/:id" element={<PublicProfilePage/>}/></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(()=>useTelegramStore.setState({user:null}));

it('renders a public profile without editing controls',()=>{
  const html=renderAt('telegram:7');
  expect(html).toContain('Борис');
  expect(html).toContain('@boris');
  expect(html).not.toContain('Редактировать профиль');
  expect(html).not.toContain('Мои заявки');
});

it('shows an "это вы" shortcut for the current user',()=>{
  useTelegramStore.setState({user:{id:7,first_name:'Борис'}});
  const html=renderAt('telegram:7');
  expect(html).toContain('Это вы');
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/publicProfilePage.test.tsx`
Expected: FAIL — модуль `PublicProfilePage` не найден.

- [ ] **Step 3: Создать страницу**

Create `src/pages/PublicProfilePage.tsx`:

```tsx
import React from 'react';
import {Link,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {apiClient} from '../api/apiClient.js';
import {TrackRow} from '../components/tracks/TrackRow.js';
import {useTelegramStore} from '../telegram/runtime.js';

export function PublicProfilePage(){
  const {id}=useParams<{id:string}>();
  const telegramUser=useTelegramStore(s=>s.user);
  const isSelf=!!telegramUser&&id===`telegram:${telegramUser.id}`;
  const query=useQuery({
    queryKey:['public-profile',id],
    queryFn:()=>apiClient.getPublicProfile(id!),
    enabled:!!id&&!isSelf,
  });
  if(isSelf)return <div className="page-crystal profile-page"><div className="frost-panel profile-form"><span className="eyebrow">ВАШ ПРОФИЛЬ</span><h1>Это вы</h1><p>Здесь публичная страница выглядела бы так, как её видят другие.</p><Link className="primary-button" to="/profile">Открыть личный кабинет</Link></div></div>;
  if(query.isLoading)return <div className="frost-panel">Открываем профиль…</div>;
  if(query.error||!query.data)return <div className="frost-panel">{query.error instanceof Error?query.error.message:'Профиль не найден.'}</div>;
  const p=query.data;
  return <div className="page-crystal profile-page">
    <header className="profile-cover frost-panel">
      <div className="profile-banner">{p.bannerUrl?<img src={p.bannerUrl} alt="" aria-hidden="true"/>:null}</div>
      <div className="profile-identity">
        {p.avatarUrl?<img src={p.avatarUrl} alt="Аватар"/>:<span className="profile-avatar">{p.displayName.slice(0,1)||'?'}</span>}
        <div className="profile-identity-copy">
          <span className="eyebrow">ПРОФИЛЬ</span>
          <h1>{p.displayName}</h1>
          <p>{p.username?`@${p.username}`:'@username скрыт'} · {p.music.length} треков · {p.contributions.length} текстов</p>
          {p.bio&&<p className="profile-bio">{p.bio}</p>}
        </div>
      </div>
    </header>
    <section className="frost-panel profile-form">
      <h2>Музыка в профиле</h2>
      {p.music.length?p.music.map((track,i)=><div className="profile-music-row" key={track.id}><TrackRow track={track} index={i} collection={p.music}/></div>):<p className="profile-empty">Здесь пока тихо.</p>}
    </section>
    <section className="frost-panel profile-form">
      <h2>Опубликованные тексты</h2>
      {p.contributions.length?p.contributions.map(c=><div className="contribution-row" key={c.id}><div><Link to={`/track/${encodeURIComponent(c.trackId)}`}>{c.artistName} — {c.trackTitle}</Link><small>{c.credit}</small></div></div>):<p className="profile-empty">Пока нет опубликованных текстов.</p>}
    </section>
  </div>;
}
```

- [ ] **Step 4: Зарегистрировать маршрут**

Modify `src/App.tsx`: add the import next to `ProfilePage` and the route after `profile`:

```tsx
import {PublicProfilePage} from './pages/PublicProfilePage.js';
```

```tsx
              <Route path="user/:id" element={<PublicProfilePage />} />
```

- [ ] **Step 5: Запустить тест**

Run: `npx vitest run tests/publicProfilePage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit (только по явному запросу)**

```bash
git add src/pages/PublicProfilePage.tsx src/App.tsx tests/publicProfilePage.test.tsx
git commit -m "feat: add public profile page"
```

---

### Task 5: Карточка автора и строка авторства

**Files:**
- Create: `src/components/profile/AuthorCard.tsx`
- Modify: `src/components/lyrics/LyricsView.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `LyricAuthor`, `apiClient.getUserSummary`, `useTelegramStore`.
- Produces: компонент `AuthorCard({author}:{author:LyricAuthor})`.

- [ ] **Step 1: Создать AuthorCard**

Create `src/components/profile/AuthorCard.tsx`:

```tsx
import React,{useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {apiClient} from '../../api/apiClient.js';
import {useTelegramStore} from '../../telegram/runtime.js';
import type {LyricAuthor} from '../../types/index.js';

export function AuthorCard({author}:{author:LyricAuthor}){
  const [open,setOpen]=useState(false);
  const timer=useRef<number>();
  const telegramUser=useTelegramStore(s=>s.user);
  const isSelf=!!telegramUser&&author.id===`telegram:${telegramUser.id}`;
  const href=isSelf?'/profile':`/user/${encodeURIComponent(author.id)}`;
  const summary=useQuery({
    queryKey:['user-summary',author.id],
    queryFn:()=>apiClient.getUserSummary(author.id),
    enabled:open&&!isSelf,
  });
  const scheduleOpen=()=>{timer.current=window.setTimeout(()=>setOpen(true),180);};
  const cancel=()=>{if(timer.current)window.clearTimeout(timer.current);};
  const close=()=>{cancel();setOpen(false);};
  useEffect(()=>{
    if(!open)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[open]);
  return <div className="lyrics-author" onMouseEnter={scheduleOpen} onMouseLeave={close}>
    <Link className="lyrics-author-link" to={href} onFocus={()=>setOpen(true)} onBlur={close}>
      {author.avatarUrl?<img className="lyrics-author-avatar" src={author.avatarUrl} alt=""/>:<span className="lyrics-author-avatar">{author.displayName.slice(0,1)||'?'}</span>}
      <span className="lyrics-author-copy">
        <span className="lyrics-author-name">{author.credit||author.displayName}</span>
        <span className="lyrics-author-handle">{isSelf?'Это вы':author.username?`@${author.username}`:'Автор текста'}</span>
      </span>
    </Link>
    {open&&!isSelf&&<div className="author-card" role="dialog" aria-label="Профиль автора">
      <strong>{summary.data?.displayName||author.displayName}</strong>
      {summary.data?.username&&<small>@{summary.data.username}</small>}
      {summary.data?.bio&&<p>{summary.data.bio}</p>}
      {summary.data&&<small>{summary.data.textsCount} текстов · {summary.data.musicCount} треков</small>}
      <Link className="secondary-button" to={href}>Открыть профиль</Link>
    </div>}
  </div>;
}
```

- [ ] **Step 2: Показать автора в LyricsView**

Modify `src/components/lyrics/LyricsView.tsx`:

1. Import: `import type { LyricLine, LyricAuthor } from '../../types/index.js';` and `import { AuthorCard } from '../profile/AuthorCard.js';`.
2. Add state next to `provider`: `const [author,setAuthor]=useState<LyricAuthor>();`.
3. In the track-change reset line (`setRaw([]);setPlain('');...`) add `setAuthor(undefined);`.
4. In the catalog-load branch (`setRaw(data?.syncedLyrics||...);setPlain(...);setProvider(...)`) add `setAuthor(data?.author);`.
5. In the local-file branch (where `setProvider('Ваш файл')`) leave `author` undefined.
6. Directly above `<div className="lyrics-footer">` add:

```tsx
    {author&&<AuthorCard author={author}/>}
```

- [ ] **Step 3: Добавить стили автора**

Append to `src/index.css`:

```css
.lyrics-author{position:relative;padding-top:10px;border-top:1px solid var(--edge);flex-shrink:0}
.lyrics-author-link{display:inline-flex;align-items:center;gap:10px;padding:4px 2px;border-radius:14px}
.lyrics-author-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;background:var(--glass);display:grid;place-items:center;color:var(--muted);font-weight:600}
.lyrics-author-copy{display:flex;flex-direction:column;line-height:1.25}
.lyrics-author-name{font-size:13px;font-weight:600;color:var(--ink)}
.lyrics-author-handle{font-size:11px;color:var(--muted)}
.author-card{position:absolute;left:0;bottom:calc(100% + 8px);z-index:20;min-width:220px;max-width:280px;display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:18px;background:var(--frost-face);border:1px solid var(--edge);box-shadow:0 18px 50px #15233233}
.author-card strong{font-size:15px;color:var(--ink)}
.author-card small{font-size:11px;color:var(--muted)}
.author-card p{font-size:12px;line-height:1.5;color:var(--muted)}
.author-card .secondary-button{align-self:flex-start;margin-top:4px}
@media(prefers-reduced-motion:reduce){.lyrics-author-link,.author-card{transition:none}}
```

- [ ] **Step 4: Проверить типы и сборку страницы**

Run: `npm run typecheck && npx vitest run tests/publicProfilePage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit (только по явному запросу)**

```bash
git add src/components/profile/AuthorCard.tsx src/components/lyrics/LyricsView.tsx src/index.css
git commit -m "feat: show lyric author with profile hover card"
```

---

### Task 6: Чистые функции состояний текста

**Files:**
- Modify: `src/utils/lyricMotion.ts`
- Test: `tests/lyricMotion.test.ts`

**Interfaces:**
- Produces: `litWordCount(time:number, words?:LyricWord[]):number`, `singingWordIndex(time:number, words?:LyricWord[]):number`, `isLineRevealed(time:number, line:LyricLine):boolean`.

- [ ] **Step 1: Переписать тест**

Replace `tests/lyricMotion.test.ts`:

```ts
import {describe,it,expect} from 'vitest';
import {litWordCount,singingWordIndex,isLineRevealed} from '../src/utils/lyricMotion.js';
import type {LyricWord} from '../src/types/index.js';

const words:LyricWord[]=[
  {text:'Один',start:1,end:2},
  {text:'длинный',start:2,end:3},
  {text:'текст',start:3,end:3},
];

describe('per-word reading states',()=>{
  it('counts words that have started',()=>{
    expect(litWordCount(0.5,words)).toBe(0);
    expect(litWordCount(1,words)).toBe(1);
    expect(litWordCount(2.5,words)).toBe(2);
    expect(litWordCount(9,words)).toBe(3);
    expect(litWordCount(0,undefined)).toBe(0);
  });
  it('rewinds when playback goes backwards',()=>{
    expect(litWordCount(3,words)).toBe(3);
    expect(litWordCount(1.5,words)).toBe(1);
  });
  it('finds the word currently being sung',()=>{
    expect(singingWordIndex(0.5,words)).toBe(-1);
    expect(singingWordIndex(1.5,words)).toBe(0);
    expect(singingWordIndex(2.5,words)).toBe(1);
    expect(singingWordIndex(3,words)).toBe(-1);
    expect(singingWordIndex(0,undefined)).toBe(-1);
  });
  it('reveals a line once playback reaches it',()=>{
    expect(isLineRevealed(0.9,{time:1,text:'x'})).toBe(false);
    expect(isLineRevealed(1,{time:1,text:'x'})).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/lyricMotion.test.ts`
Expected: FAIL — `litWordCount` не экспортируется.

- [ ] **Step 3: Переписать утилиты**

Replace `src/utils/lyricMotion.ts`:

```ts
import type { LyricLine, LyricWord } from '../types/index.js';

/** Сколько слов уже началось к моменту time. */
export function litWordCount(time: number, words?: LyricWord[]): number {
  if (!words?.length) return 0;
  let count = 0;
  for (const word of words) {
    if (word.start <= time) count += 1;
    else break;
  }
  return count;
}

/** Индекс слова в интервале [start, end), иначе -1. */
export function singingWordIndex(time: number, words?: LyricWord[]): number {
  if (!words?.length) return -1;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (time < word.start) break;
    if (time < word.end) return index;
  }
  return -1;
}

/** Строчный режим без word-таймингов раскрывается целиком по line.time. */
export function isLineRevealed(time: number, line: LyricLine): boolean {
  return time >= line.time;
}
```

- [ ] **Step 4: Запустить тест**

Run: `npx vitest run tests/lyricMotion.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (только по явному запросу)**

```bash
git add src/utils/lyricMotion.ts tests/lyricMotion.test.ts
git commit -m "refactor: replace glyph motion with per-word state helpers"
```

---

### Task 7: Линия и вьюпорт текста на новых состояниях

**Files:**
- Modify: `src/components/lyrics/LyricsLine.tsx`
- Modify: `src/components/lyrics/LyricsView.tsx`
- Test: `tests/lyricsRendering.test.tsx`

**Interfaces:**
- Consumes: `litWordCount`, `singingWordIndex`.
- Produces: `LyricsLine` с пропсами `{line, isActive, isSung, litCount, singingIndex, onSeek}`.

- [ ] **Step 1: Переписать тест рендера**

Replace `tests/lyricsRendering.test.tsx`:

```tsx
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
vi.mock('../src/audio/AudioManager.js',()=>({audioManager:{getCurrentTime:()=>0}}));
import {LyricsLine} from '../src/components/lyrics/LyricsLine.js';
const line={time:0,end:5,text:'Один длинный текст',words:[{text:'Один',start:0,end:1},{text:'длинный',start:1,end:3},{text:'текст',start:3,end:5}]};
describe('lyrics rendering states',()=>{
 it('marks only started words as lit and the current one as singing',()=>{
  const html=renderToStaticMarkup(<LyricsLine line={line} isActive litCount={2} singingIndex={1} onSeek={()=>{}}/>);
  expect(html.match(/is-lit/g)?.length).toBe(2);
  expect(html.match(/is-singing/g)?.length).toBe(1);
  expect(html).not.toContain('lyric-glyph');
 });
 it('keeps completed lines white through the line class',()=>{
  const html=renderToStaticMarkup(<LyricsLine line={line} isActive={false} isSung litCount={0} singingIndex={-1} onSeek={()=>{}}/>);
  expect(html).toContain('sung');
  expect(html).not.toContain('is-lit');
 });
 it('line-timed lyrics never invent word highlighting',()=>{
  const html=renderToStaticMarkup(<LyricsLine line={{...line,estimated:true}} isActive litCount={3} singingIndex={2} onSeek={()=>{}}/>);
  expect(html).toContain('line-timed');
  expect(html).not.toContain('is-lit');
 });
 it('only the active line receives lit words',()=>{
  const html=renderToStaticMarkup(<>{Array.from({length:500},(_,i)=><LyricsLine key={i} line={line} isActive={i===250} litCount={i===250?2:0} singingIndex={i===250?1:-1} isSung={i<250} onSeek={()=>{}}/>)}</>);
  expect(html.match(/is-lit/g)?.length).toBe(2);
  expect(html.match(/is-singing/g)?.length).toBe(1);
 });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/lyricsRendering.test.tsx`
Expected: FAIL — `LyricsLine` пока не принимает `litCount`/`singingIndex` и рендерит `lyric-glyph`.

- [ ] **Step 3: Переписать LyricsLine**

Replace `src/components/lyrics/LyricsLine.tsx`:

```tsx
import React, { memo } from 'react';
import type { LyricLine } from '../../types/index.js';

export const LyricsLine = memo(function LyricsLine({ line, isActive, isSung = false, litCount, singingIndex, onSeek }: {
  line: LyricLine; isActive: boolean; isSung?: boolean; litCount: number; singingIndex: number; onSeek: (time: number) => void;
}) {
  const words = !line.estimated && line.words?.length ? line.words : undefined;
  return <div className={`lyric-voice ${line.role==='background'?'lyric-background':''}`} data-agent={line.agent}>
    {line.agentName&&!/^v\d+$/i.test(line.agentName)&&<span className="lyric-agent">{line.agentName}</span>}
    <button onClick={() => onSeek(line.time)} aria-label={line.text} aria-current={isActive ? 'true' : undefined} className={`interference-line ${isActive ? 'active' : ''} ${isSung ? 'sung' : ''} ${words?'word-timed':'line-timed'}`}>
      <span aria-hidden="true">{words?words.map((word,i) => <span key={i} className={`lyric-word ${word.joinNext?'lyric-syllable':''} ${i<litCount?'is-lit':''} ${i===singingIndex?'is-singing':''}`}>{word.text}</span>):line.text}</span>
    </button>
    {line.romanization&&<p className="lyric-romanization">{line.romanization}</p>}
    {line.translation&&<p className="lyric-translation">{line.translation}</p>}
  </div>;
});
```

- [ ] **Step 4: Обновить планировщик LyricsView**

Modify `src/components/lyrics/LyricsView.tsx`:

1. Replace the import `import { parseLrc, parseLyricsFile, withWordTiming, getActiveLyricIndex } from '../../utils/lyricsParser.js';` — keep it — and add `import { litWordCount, singingWordIndex } from '../../utils/lyricMotion.js';`.
2. Replace the `boundaries` memo:

```tsx
  const boundaries=useMemo(()=>[...new Set(lines.flatMap(l=>[l.time,(l.end??l.time+5)+.001,...(!l.estimated?(l.words??[]).map(w=>w.start):[])]))].sort((a,b)=>a-b),[lines]);
```

3. After `const time=clock+offset,active=getActiveLyricIndex(lines,time);` add:

```tsx
  const activeLine=active>=0?lines[active]:undefined;
  const activeWords=activeLine&&!activeLine.estimated?activeLine.words:undefined;
  const activeSinging=!!activeLine&&time>=activeLine.time&&time<=(activeLine.end??activeLine.time+5);
  const litCount=activeSinging&&activeWords?litWordCount(time,activeWords):0;
  const singingIndex=activeSinging&&activeWords?singingWordIndex(time,activeWords):-1;
```

4. Replace the line-render expression inside `lines.map(...)`:

```tsx
lines.map((line,i)=>{const singing=time>=line.time&&time<=(line.end??line.time+5);const sung=time>(line.end??line.time+5);const current=i===active&&activeSinging;return <div className="lyric-slot" key={`${line.time}:${i}`} ref={i===active?activeRef:undefined}><LyricsLine line={line} isActive={singing} isSung={sung} litCount={current?litCount:0} singingIndex={current?singingIndex:-1} onSeek={seekLine}/></div>;})
```

- [ ] **Step 5: Запустить тесты**

Run: `npx vitest run tests/lyricsRendering.test.tsx tests/lyricMotion.test.ts`
Expected: PASS.

- [ ] **Step 6: Проверить типы**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit (только по явному запросу)**

```bash
git add src/components/lyrics/LyricsLine.tsx src/components/lyrics/LyricsView.tsx tests/lyricsRendering.test.tsx
git commit -m "perf: drive lyric highlight with per-word states"
```

---

### Task 8: CSS состояний и очистка мёртвых правил

**Files:**
- Modify: `src/index.css`

**Interfaces:**
- Consumes: классы `is-lit`, `is-singing` из Task 7.
- Produces: визуальные состояния `unread` / `reading` / `read`.

- [ ] **Step 1: Удалить правила графем**

В `src/index.css` удалить блоки по селекторам (номера строк могут сдвигаться, искать по селектору):

- `.lyric-glyph{...}` (два правила, около строк 312 и 388);
- `.interference-modal .lyric-glyph{...}` (около строки 376);
- **оба** правила `.interference-line.active .lyric-word, .interference-line.active .lyric-word{color:transparent;...}` и `color:inherit;...` (около строк 259 и 311). Оба обязательны к удалению: первое делает активные слова прозрачными через `--fill`, второе его перекрывает. Если оставить первое, базовый серый проиграет по специфичности.
- `.interference-line.active .lyric-word.singing{...}` (около строки 260) — класс `.singing` больше не существует.
- `.interference-lyrics .lyric-word{... transform:scale(calc(1 + var(--word-pulse...` (около строк 387 и 419);

Правила, ссылающиеся на `--glyph-*` и `--word-pulse`, удалить целиком. Не удалять `.lyric-word{display:inline-block;...}` базовые правила.

- [ ] **Step 2: Добавить состояния слов**

Append to `src/index.css`:

```css
/* Per-word reading crossfade: gray unread -> white reading -> white read. */
.interference-lyrics .lyric-word{color:var(--lyric-dim);text-shadow:none;transform:none;transition:color .5s cubic-bezier(.16,1,.3,1),transform .5s cubic-bezier(.16,1,.3,1),text-shadow .5s cubic-bezier(.16,1,.3,1)}
.interference-lyrics .lyric-word.is-lit,
.interference-lyrics .lyric-word.is-singing,
.interference-lyrics .interference-line.sung .lyric-word{color:var(--lyric-lit)}
.interference-lyrics .interference-line.active .lyric-word.is-singing{transform:translateY(-2px);text-shadow:0 0 12px rgb(255 255 255 / .35)}
.interference-lyrics .interference-line.active .lyric-word{will-change:color,transform}
.lyric-slot{content-visibility:auto;contain-intrinsic-size:auto 110px}
@media(prefers-reduced-motion:reduce){
  .interference-lyrics .lyric-word{transition:color .001s linear}
  .interference-lyrics .interference-line.active .lyric-word.is-singing{transform:none;text-shadow:none}
}
```

- [ ] **Step 3: Проверить тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Визуальная проверка**

Run: `npm run dev:web`, открыть трек с синхронизированным текстом, включить воспроизведение.
Expected: нечитаные слова серые; на старте слова — плавное высветление с лёгким подъёмом; после слова остаются белыми; перемотка назад возвращает серый. Если прокрутка к активной строке смещается — удалить строку `.lyric-slot{content-visibility:auto;...}` и повторить.

- [ ] **Step 5: Commit (только по явному запросу)**

```bash
git add src/index.css
git commit -m "style: per-word lyric crossfade states"
```

---

### Task 9: Документация и финальная проверка

**Files:**
- Modify: `docs/interference.md`

**Interfaces:**
- Consumes: результат Task 7–8.
- Produces: актуальное описание анимации.

- [ ] **Step 1: Обновить документацию**

В `docs/interference.md` заменить раздел «Проявление букв и стекло — 16 сентября» на текст:

```markdown
## Пословный кроссфейд — 18 сентября

Текст читается по словам: нечитаное слово серое, на старте слова происходит
плавный кроссфейд к белому с лёгким подъёмом, после окончания слово остаётся
белым. Строчные тексты без пословных метк раскрываются целиком по времени
строки. Буквенной интерполяции и бегущего блика внутри слова больше нет:
состояние — чистая функция времени, поэтому перемотка назад корректно
возвращает серый цвет.

Анимация вынесена в CSS-переходы `color`/`transform`, а React обновляет
состояние только на границах слов, а не каждый кадр. Системное уменьшение
движения отключает подъём и свечение. Публикация и проверка текстов не
изменились.
```

- [ ] **Step 2: Полная проверка**

Run: `npm test && npm run typecheck`
Expected: PASS без падений.

- [ ] **Step 3: Проверить публичный профиль вручную**

Run: `npm run dev:web`, открыть `/track/<id>` с текстом Осколка, навести на строку автора → открывается карточка, клик ведёт на `/user/<authorId>`; страница профиля показывает музыку и опубликованные тексты, без кнопок редактирования и без вкладки заявок.

- [ ] **Step 4: Commit (только по явному запросу)**

```bash
git add docs/interference.md
git commit -m "docs: describe per-word lyric crossfade"
```

---

## Self-Review

**1. Покрытие спецификации:**

- Публичный API `/users/:id` и `/users/:id/summary` — Task 1.
- Приватность полей — Task 1 (select без `lyricsData`, 404 для чужого/несуществующего).
- Типы и клиент — Task 3.
- Страница `/user/:id` без редактирования и заявок — Task 4.
- `author` в ответе лирики — Task 2.
- Строка автора + hover/focus-карточка + переход на профиль — Task 5.
- Три состояния слова и пословный кроссфейд — Task 6–8.
- Оптимизация (один rAF, обновление на границах, без `--glyph-tone`/`--word-pulse`, `content-visibility`) — Task 7–8.
- Доступность (focus/Escape, клик, reduced motion) — Task 5, 8.
- Тесты — Task 1–4, 6, 7; финальный `npm test`/`typecheck` — Task 8, 9.
- Документация — Task 9.

**2. Placeholder scan:** плейсхолдеров нет; каждый шаг содержит код или точную команду.

**3. Type consistency:** `litWordCount`, `singingWordIndex`, `isLineRevealed` определены в Task 6 и используются в Task 7 под теми же именами. `LyricAuthor` определён в Task 3 и используется в Task 2 (серверный ответ) и Task 5. `PublicProfile`/`UserSummary` определены в Task 3 и используются в Task 4/5. Пропсы `LyricsLine` согласованы между Task 4 (тест) и Task 7 (реализация); тест Task 7 написан до реализации и потому сначала падает.
