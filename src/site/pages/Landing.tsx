import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, AudioLines, Download, Globe2, Library, Lock, MessageCircle, Quote, Search, Send, Sparkles, Users } from 'lucide-react';
import logo from '../../assets/logo.png';
import homeShot from '../assets/app-home.webp';
import searchShot from '../assets/app-search.webp';
import lyricsShot from '../assets/app-lyrics.webp';
import waveShot from '../assets/app-wave.webp';
import collectionShot from '../assets/app-collection.webp';
import mobileHome from '../assets/app-mobile-home.webp';
import mobilePlayer from '../assets/app-mobile-player.webp';
import { siteApi, type ReleaseCatalog, type PlatformEntry } from '../api.js';
import { PLATFORM_NAMES, STATUS_NAMES } from '../platform.js';
import { CHANNEL_URL, PageShell, PlatformIcon, Reveal, Shards, usePageMeta } from '../components/chrome.js';

/** Recruitment state for the hero and the beta section; null while loading. */
function useBetaOpen() {
  const [open, setOpen] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    siteApi<{ open: boolean }>('/beta', { signal: controller.signal }).then(d => setOpen(d.open)).catch(() => setOpen(true));
    return () => controller.abort();
  }, []);
  return open;
}

function Hero({ betaOpen }: { betaOpen: boolean | null }) {
  return <section className="s-hero" aria-labelledby="hero-title">
    <Shards items={[{ i: 0, style: { width: 260, left: '-4%', top: '6%', rotate: '-14deg' } }, { i: 1, style: { width: 70, left: '38%', top: '2%', rotate: '20deg', opacity: .7 } }, { i: 3, style: { width: 180, right: '-3%', top: '64%', rotate: '8deg', opacity: .35 } }, { i: 5, style: { width: 64, right: '8%', top: '4%', rotate: '-18deg' } }]} />
    <div className="s-wrap s-hero-grid">
      <div className="s-hero-copy">
        <div className="s-hero-mark"><img src={logo} alt="" width="56" height="56" /><span>{betaOpen === false ? 'Закрытый бета-тест' : 'Идёт закрытый бета-тест'}</span></div>
        <h1 id="hero-title">Осколок<small>OSKOLOK · музыкальный плеер</small></h1>
        <p className="s-hero-sub">Слушай SoundCloud и YouTube в одном плеере, лови свою волну и показывай друзьям в Telegram, что играет сейчас.</p>
        <div className="s-hero-ctas">
          <a className="s-btn s-btn-primary s-btn-lg" href="/app">Открыть веб-плеер<ArrowRight size={18} aria-hidden="true" /></a>
          {betaOpen === false
            ? <Link className="s-btn s-btn-lg" to="/beta"><Lock size={16} aria-hidden="true" />Набор закрыт</Link>
            : <Link className="s-btn s-btn-lg" to="/beta">Подать заявку</Link>}
          <Link className="s-btn s-btn-ghost" to="/download"><Download size={17} aria-hidden="true" />Скачать</Link>
        </div>
      </div>
      <div className="s-stage">
        <div className="s-stage-screen"><img src={homeShot} alt="Главный экран Осколка: обложки треков в стеклянных осколках и кнопка Резонанса" width="1600" height="1000" {...{ fetchpriority: "high" }} decoding="async" /></div>
        <div className="s-stage-phone"><img src={mobilePlayer} alt="Полноэкранный плеер Осколка на телефоне" width="640" height="1385" decoding="async" /></div>
      </div>
    </div>
  </section>;
}

function About() {
  return <section className="s-section" id="about" aria-labelledby="about-title">
    <div className="s-wrap s-about-grid">
      <div>
        <Reveal as="p" className="s-kicker">О проекте</Reveal>
        <Reveal as="h2" id="about-title" className="s-manifesto" delay={1} style={{ marginTop: 18 }}>Осколок собирает музыку из разных мест в <em>один тихий, красивый плеер</em> и живёт рядом с твоим Telegram.</Reveal>
        <Reveal className="s-about-text" delay={2}>
          <p>Треки приходят из SoundCloud и YouTube, а метаданные и обложки из музыкальных каталогов. Если у трека несколько версий, можно выбрать источник, и Осколок его запомнит.</p>
          <p>Вход только через Telegram. Плеер показывает в профиле, что ты слушаешь, умеет добавлять треки прямо в музыку профиля, а бот играет очередь в нативном плеере Telegram.</p>
          <p>Проект делает небольшая команда на энтузиазме. Багов пока хватает, поэтому мы собираем бета-тестеров и правим плеер почти каждый день.</p>
        </Reveal>
      </div>
      <Reveal className="s-glass s-diff" delay={2}>
        <div><Send size={20} /><p><b>Telegram вместо пароля</b><span>Вход по QR, номеру или через бота. Текущий трек виден в профиле.</span></p></div>
        <div><AudioLines size={20} /><p><b>Резонанс подстраивается</b><span>Рекомендации учитывают прослушивания, пропуски и лайки, а не случайный шаффл.</span></p></div>
        <div><Quote size={20} /><p><b>Текст, который двигается</b><span>Слова и слоги загораются в такт, как в Apple Music, с переводом и аннотациями Genius.</span></p></div>
        <div><Globe2 size={20} /><p><b>Одна коллекция везде</b><span>Сайт, Windows, macOS и Android открывают один и тот же Осколок.</span></p></div>
      </Reveal>
    </div>
  </section>;
}

function Features() {
  const shot = (src: string, alt: string) => <div className="s-tile-shot"><img src={src} alt={alt} loading="lazy" decoding="async" width="1600" height="1000" /></div>;
  return <section className="s-section" id="features" aria-labelledby="features-title" style={{ paddingTop: 0 }}>
    <div className="s-wrap">
      <Reveal className="s-section-head"><h2 id="features-title" className="s-h2">Что умеет Осколок</h2><p className="s-lead">Всё ниже уже работает в бете. Скриншоты сняты в настоящем плеере.</p></Reveal>
      <div className="s-bento">
        <Reveal as="article" className="s-tile wave"><h3>Резонанс, твоя волна</h3><p>Бесконечный поток, который учится на том, что ты слушаешь и пропускаешь. Можно задать занятие, язык музыки и характер: привычное, что-то нишевое или только из коллекции.</p>{shot(waveShot, 'Панель «Настроить Резонанс»: занятие, язык и характер волны')}</Reveal>
        <Reveal as="article" className="s-tile lyrics" delay={1}><h3>Текст по слогам</h3><p>Строки плавно загораются вместе с вокалом. Есть перевод.</p>{shot(lyricsShot, 'Полноэкранный плеер с текстом песни, подсвеченным по словам')}</Reveal>
        <Reveal as="article" className="s-tile search"><h3>Поиск по всем источникам</h3><p>Треки, исполнители, альбомы и плейлисты в одной выдаче. Из любого запроса можно включить Резонанс.</p>{shot(searchShot, 'Поиск Осколка с лучшим результатом и списком треков')}</Reveal>
        <Reveal as="article" className="s-tile collection" delay={1}><h3>Коллекция и перенос</h3><p>Плейлисты, любимые артисты и история. Плейлисты из Spotify и SoundCloud переносятся в пару нажатий.</p>{shot(collectionShot, 'Коллекция: плейлисты и любимые артисты')}</Reveal>
        <Reveal as="article" className="s-tile telegram"><span className="s-tile-icon"><MessageCircle size={22} /></span><h3>Трек в профиле Telegram</h3><p>Друзья видят, что ты слушаешь. Любой трек можно добавить в музыку профиля.</p></Reveal>
        <Reveal as="article" className="s-tile genius" delay={1}><span className="s-tile-icon"><Sparkles size={22} /></span><h3>Genius внутри плеера</h3><p>Об артисте, релизе и смысле строчек, не выходя из Осколка.</p></Reveal>
        <Reveal as="article" className="s-tile people" delay={2}><span className="s-tile-icon"><Users size={22} /></span><h3>Профили и друзья</h3><p>Аватар, баннер, витрина треков и статус. Найди знакомых из контактов.</p></Reveal>
      </div>
    </div>
  </section>;
}

const DEMO = [
  { id: 'player', icon: AudioLines, title: 'Плеер', text: 'Обложка, управление и текст песни на весь экран. Фон окрашивается в цвета трека.', src: lyricsShot, alt: 'Полноэкранный плеер с текстом песни', phone: mobilePlayer },
  { id: 'wave', icon: Sparkles, title: 'Резонанс', text: 'Настройки волны: занятие, язык, характер. Сохраняются сразу.', src: waveShot, alt: 'Настройки Резонанса', phone: mobileHome },
  { id: 'search', icon: Search, title: 'Поиск', text: 'Лучший результат, треки и альбомы. Нижняя панель плеера всегда под рукой.', src: searchShot, alt: 'Поиск по исполнителю', phone: mobilePlayer },
  { id: 'collection', icon: Library, title: 'Коллекция', text: 'Плейлисты в стеклянных гранях, любимые артисты и треки.', src: collectionShot, alt: 'Коллекция', phone: mobileHome },
];
function Demo() {
  const [active, setActive] = React.useState(0);
  const tabs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (active + step + DEMO.length) % DEMO.length;
    setActive(next); tabs.current[next]?.focus();
  };
  return <section className="s-section" aria-labelledby="demo-title" style={{ paddingTop: 0 }}>
    <div className="s-wrap">
      <Reveal className="s-section-head"><h2 id="demo-title" className="s-h2">Загляни внутрь</h2><p className="s-lead">Переключай экраны. Это тот же интерфейс, что откроется по кнопке «Открыть веб-плеер».</p></Reveal>
      <div className="s-demo">
        <div className="s-demo-tabs" role="tablist" aria-label="Экраны плеера" aria-orientation="vertical" onKeyDown={onKey}>
          {DEMO.map((d, i) => <button key={d.id} ref={el => { tabs.current[i] = el; }} role="tab" id={`demo-tab-${d.id}`} aria-controls="demo-panel" aria-selected={i === active} tabIndex={i === active ? 0 : -1} className="s-demo-tab" onClick={() => setActive(i)}>
            <d.icon size={22} aria-hidden="true" /><span style={{ display: 'contents' }}><b>{d.title}</b><span>{d.text}</span></span>
          </button>)}
        </div>
        <Reveal className="s-demo-view" id="demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${DEMO[active].id}`}>
          <div className="s-demo-frame">{DEMO.map((d, i) => <img key={d.id} src={d.src} alt={i === active ? d.alt : ''} aria-hidden={i !== active} className={i === active ? 'is-active' : ''} loading="lazy" decoding="async" />)}</div>
          <div className="s-demo-phone"><img src={DEMO[active].phone} alt="" loading="lazy" decoding="async" /></div>
          <p className="s-demo-caption">Экраны из бета-версии на тестовом аккаунте.</p>
        </Reveal>
      </div>
    </div>
  </section>;
}

function BetaSection({ open }: { open: boolean | null }) {
  return <section className="s-section" id="beta" aria-labelledby="beta-title" style={{ paddingTop: 0 }}>
    <div className="s-wrap">
      <Reveal className="s-glass s-beta">
        <div className="s-beta-head">
          <p className="s-kicker">Бета-тест</p>
          <h2 id="beta-title" className="s-h2">Стань частью бета-тестирования Осколка</h2>
          <p className="s-lead">Бета нужна, чтобы найти баги и понять, каким Осколок должен стать к открытому релизу. Тестеры первыми получают новые версии, могут слушать на всех платформах и напрямую влияют на плеер своими репортами.</p>
        </div>
        <ol className="s-steps">
          <li><b>Заявка на сайте</b><span>Telegram username, пара слов о себе и зачем тебе бета.</span></li>
          <li><b>Подтверждение</b><span>Одна кнопка в нашем боте привязывает настоящий Telegram-аккаунт.</span></li>
          <li><b>Рассмотрение</b><span>Мы читаем каждую заявку вручную. Сроки зависят от числа заявок.</span></li>
          <li><b>Доступ</b><span>Бот напишет о решении. Вход в плеер через тот же Telegram.</span></li>
        </ol>
        <div className="s-beta-foot">
          {open === false
            ? <div className="s-closed" role="status"><Lock size={18} /><p>Набор на бета-тестирование временно закрыт. Следи за новостями проекта в нашем <a className="s-link" href={CHANNEL_URL} target="_blank" rel="noopener noreferrer">Telegram-канале</a>.</p></div>
            : <Link className="s-btn s-btn-primary s-btn-lg" to="/beta">Подать заявку<ArrowRight size={18} aria-hidden="true" /></Link>}
          <Link className="s-link" to="/beta/status">Проверить статус заявки</Link>
        </div>
      </Reveal>
    </div>
  </section>;
}

const PLATFORM_ORDER = ['web', 'windows', 'macos', 'android', 'ios', 'linux'] as const;
const PLATFORM_FALLBACK: Record<string, PlatformEntry['status']> = { web: 'available', windows: 'available', macos: 'available', android: 'beta', ios: 'development', linux: 'soon' };
const PLATFORM_TEXT: Record<string, string> = {
  web: 'Любой современный браузер. Можно установить как приложение.',
  windows: 'Установщик и portable-версия для Windows 10 и 11.',
  macos: 'Отдельные сборки для Apple Silicon и Intel.',
  android: 'APK для Android 8 и новее, системные кнопки плеера.',
  ios: 'Приложение для iPhone готовится. Сейчас работает веб-версия.',
  linux: 'Отдельной сборки нет, веб-версия работает.',
};
function Platforms() {
  const [catalog, setCatalog] = React.useState<ReleaseCatalog | null>(null);
  React.useEffect(() => { siteApi<ReleaseCatalog>('/releases').then(setCatalog).catch(() => setCatalog(null)); }, []);
  return <section className="s-section" aria-labelledby="platforms-title" style={{ paddingTop: 0 }}>
    <div className="s-wrap">
      <Reveal className="s-section-head"><h2 id="platforms-title" className="s-h2">Где слушать</h2><p className="s-lead">Статусы честные: доступная сборка помечена как доступная, остальное пока в работе.</p></Reveal>
      <Reveal className="s-platforms">
        {PLATFORM_ORDER.map(p => {
          const entry = catalog?.platforms.find(x => x.platform === p);
          const status = entry?.status || PLATFORM_FALLBACK[p];
          const build = entry?.builds[0];
          const to = p === 'web' ? '/app' : p === 'ios' ? '/download/ios' : p === 'android' ? '/download/android' : `/download?platform=${p}`;
          const text = p === 'ios' && status !== 'development' ? 'Сборка для участников беты. Установка через компьютер или как веб-приложение.' : PLATFORM_TEXT[p];
          return <a key={p} className="s-platform" href={to}>
            <div className="s-platform-top"><span className="s-platform-icon"><PlatformIcon platform={p} /></span><span className="s-chip" data-tone={status}>{STATUS_NAMES[status]}</span></div>
            <h3>{PLATFORM_NAMES[p]}{build ? <span className="s-muted" style={{ fontFamily: 'var(--s-sans)', fontSize: 14, fontWeight: 500 }}> {build.version}</span> : null}</h3>
            <p>{text}</p>
          </a>;
        })}
      </Reveal>
      <Reveal className="s-soon" delay={1} aria-label="Что может появиться позже">
        {['Студия текста', 'ИИ-ассистент', 'Миксинг', 'Комментарии', 'Новые источники'].map(s => <span key={s}>В планах: {s}</span>)}
      </Reveal>
    </div>
  </section>;
}

export function Landing() {
  usePageMeta('Осколок: музыкальный плеер с волной, текстами и Telegram', 'Кроссплатформенный музыкальный плеер: SoundCloud и YouTube в одном месте, Резонанс, текст по слогам, трек в профиле Telegram. Веб-версия, Windows, macOS и Android.', '/');
  const betaOpen = useBetaOpen();
  return <PageShell><Hero betaOpen={betaOpen} /><About /><Features /><Demo /><BetaSection open={betaOpen} /><Platforms /></PageShell>;
}
