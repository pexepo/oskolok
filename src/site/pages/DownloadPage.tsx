import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Copy, Download, Info, Lock, ShieldCheck } from 'lucide-react';
import { siteApi, SiteApiError, type Build, type Platform, type ReleaseCatalog } from '../api.js';
import { PageShell, PlatformIcon, usePageMeta } from '../components/chrome.js';
import { detectPlatform, formatDate, formatSize, PLATFORM_NAMES, STATUS_NAMES } from '../platform.js';

const ORDER: Platform[] = ['windows', 'macos', 'linux', 'android', 'ios', 'web'];
const GUIDE: Record<Platform, { requirements: string; steps: React.ReactNode[]; note?: React.ReactNode; more?: { to: string; label: string } }> = {
  windows: {
    requirements: 'Windows 10 или 11, 64-бит, интернет.',
    steps: ['Скачай установщик (или portable, если не хочешь ничего устанавливать).', 'Запусти файл. Если Windows покажет «Система Windows защитила ваш компьютер», нажми «Подробнее», затем «Выполнить в любом случае».', 'Войди через Telegram. Музыка, коллекция и настройки подтянутся с сервера.'],
    note: 'Сборки пока без сертификата издателя, поэтому SmartScreen предупреждает. Сверить файл можно по SHA-256 ниже.',
    more: { to: '/download/desktop', label: 'Подробная инструкция для Windows и macOS' },
  },
  macos: {
    requirements: 'macOS 12 или новее. Выбери сборку под свой процессор: Apple Silicon (M1 и новее) или Intel.',
    steps: ['Скачай DMG и открой его.', 'Перетащи Осколок в папку «Программы».', 'При первом запуске macOS может сказать, что не удалось проверить разработчика. Открой «Системные настройки» → «Конфиденциальность и безопасность» и нажми «Всё равно открыть».'],
    note: 'Приложение пока не нотарифицировано Apple, поэтому нужно это разрешение один раз.',
    more: { to: '/download/desktop', label: 'Подробная инструкция для Windows и macOS' },
  },
  linux: {
    requirements: 'Любой современный браузер: Chrome, Chromium, Edge, Firefox.',
    steps: ['Открой веб-версию Осколка.', 'В Chrome, Chromium или Edge нажми значок установки в адресной строке, чтобы Осколок открывался в своём окне.', 'Войди через Telegram.'],
    note: 'Отдельной сборки для Linux пока нет. Веб-версия использует тот же интерфейс и ту же коллекцию.',
  },
  android: {
    requirements: 'Android 8.0 или новее.',
    steps: ['Скачай APK на телефон.', 'Открой файл. Если Android попросит, разреши браузеру устанавливать приложения.', 'Если Play Защита предупредит о неизвестном приложении, нажми «Всё равно установить».', 'Войди через Telegram.'],
    note: 'APK подписан постоянным ключом Осколка, обновления ставятся поверх. В Google Play приложения пока нет.',
    more: { to: '/download/android', label: 'Подробная инструкция для Android' },
  },
  ios: {
    requirements: 'iPhone с iOS 15 или новее.',
    steps: ['Самый простой путь без компьютера: открой веб-версию в Safari и добавь её на экран «Домой».', 'Нативное приложение ставится через компьютер с Sideloadly или AltStore. Подробный гайд с картинками по кнопке ниже.'],
    more: { to: '/download/ios', label: 'Гайд по установке на iPhone' },
  },
  web: {
    requirements: 'Свежий Chrome, Edge, Safari, Firefox или Яндекс Браузер.',
    steps: ['Открой веб-плеер и войди через Telegram.', 'Чтобы Осколок открывался как приложение: в Chrome и Edge нажми значок установки в адресной строке, на iPhone в Safari выбери «Поделиться» → «На экран «Домой»».'],
    note: 'Офлайн открывается только оболочка приложения. Музыке нужен интернет.',
  },
};

function BuildCard({ build, betaAllowed, signedIn }: { build: Build; betaAllowed: boolean; signedIn: boolean }) {
  const [state, setState] = React.useState<{ busy: boolean; error: string }>({ busy: false, error: '' });
  const [copied, setCopied] = React.useState(false);
  const fetchLink = async () => {
    setState({ busy: true, error: '' });
    try { const r = await siteApi<{ url: string }>(`/releases/${build.id}/link`, { method: 'POST', body: {} }); location.href = r.url; setState({ busy: false, error: '' }); }
    catch (e) { setState({ busy: false, error: e instanceof SiteApiError && e.status === 401 ? 'Войди в Осколок через Telegram, чтобы скачать бета-сборку.' : e instanceof SiteApiError && e.status === 403 ? 'Эта сборка доступна только участникам бета-теста.' : e instanceof Error ? e.message : 'Не удалось получить ссылку.' }); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(build.checksum); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* Checksum stays visible. */ } };
  return <div className="s-build">
    <div className="s-build-row">
      <h3>{build.label || 'Сборка'}{build.betaOnly && <span className="s-chip" data-tone="beta" style={{ marginLeft: 10 }}>Только для бета-тестеров</span>}</h3>
      {build.downloadUrl
        ? <a className="s-btn s-btn-primary" href={build.downloadUrl} download><Download size={17} aria-hidden="true" />Скачать · {formatSize(build.fileSize)}</a>
        : betaAllowed
          ? <button className="s-btn s-btn-primary" type="button" onClick={fetchLink} disabled={state.busy}>{state.busy ? <span className="s-spinner" aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}Скачать · {formatSize(build.fileSize)}</button>
          : <span className="s-actions">{signedIn ? <Link className="s-btn" to="/beta"><Lock size={15} aria-hidden="true" />Нужен бета-доступ</Link> : <a className="s-btn" href="/app"><Lock size={15} aria-hidden="true" />Войти, чтобы скачать</a>}</span>}
    </div>
    <div className="s-build-meta"><span>Версия <b>{build.version}</b>{build.buildNumber ? ` (${build.buildNumber})` : ''}</span><span>Выпуск <b>{formatDate(build.releaseDate)}</b></span>{build.requirements && <span>{build.requirements}</span>}</div>
    {build.changelog && <p className="s-note">{build.changelog}</p>}
    {build.checksum && <div className="s-copy"><span className="s-sum">SHA-256: {build.checksum}</span><button className="s-btn s-btn-sm s-btn-ghost" type="button" onClick={copy} aria-label="Скопировать SHA-256"><Copy size={14} aria-hidden="true" />{copied ? 'Скопировано' : ''}</button></div>}
    {state.error && <div className="s-form-alert" role="alert"><AlertCircle size={18} />{state.error}</div>}
  </div>;
}

export function DownloadPage() {
  usePageMeta('Скачать Осколок: Windows, macOS, Android, iPhone и веб', 'Загрузки музыкального плеера Осколок: версии, даты выпуска, контрольные суммы и инструкции по установке для каждой платформы.', '/download');
  const [params, setParams] = useSearchParams();
  const detected = React.useMemo(detectPlatform, []);
  const requested = params.get('platform') as Platform | null;
  const [active, setActive] = React.useState<Platform>(requested && ORDER.includes(requested) ? requested : detected || 'windows');
  const [catalog, setCatalog] = React.useState<ReleaseCatalog | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => { siteApi<ReleaseCatalog>('/releases').then(setCatalog).catch(e => setError(e instanceof Error ? e.message : 'Не удалось загрузить список сборок.')); }, []);
  const choose = (p: Platform) => { setActive(p); setParams(p === detected ? {} : { platform: p }, { replace: true }); };
  const entry = catalog?.platforms.find(p => p.platform === active);
  const guide = GUIDE[active];
  const status = entry?.status;

  return <PageShell>
    <div className="s-wrap s-page">
      <header className="s-page-head">
        <nav className="s-crumbs" aria-label="Навигация"><Link to="/">Осколок</Link><span aria-hidden="true">/</span><span>Загрузки</span></nav>
        <h1>Скачать Осколок</h1>
        <p className="s-lead">Все приложения открывают один и тот же Осколок, поэтому новые функции сайта приходят без переустановки. Слушать можно после одобрения заявки на бету.</p>
      </header>
      <div className="s-tabs" role="tablist" aria-label="Платформа">
        {ORDER.map(p => <button key={p} role="tab" aria-selected={p === active} aria-controls="dl-panel" className="s-tab" onClick={() => choose(p)}><PlatformIcon platform={p} size={17} />{PLATFORM_NAMES[p]}</button>)}
      </div>
      {detected && <p className="s-detected">{detected === active ? 'Похоже, у тебя ' + PLATFORM_NAMES[detected] + '. Можно выбрать другую платформу выше.' : <>Похоже, у тебя {PLATFORM_NAMES[detected]}. <button className="s-link" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', borderBottom: '1px solid #7fb6ff44' }} onClick={() => choose(detected)}>Показать её</button></>}</p>}
      <div className="s-dl" id="dl-panel" role="tabpanel" key={active}>
        <section className="s-glass s-dl-main" aria-labelledby="dl-title">
          <div className="s-dl-title"><span className="s-platform-icon"><PlatformIcon platform={active} size={26} /></span><h2 id="dl-title">{PLATFORM_NAMES[active]}</h2>{status ? <span className="s-chip" data-tone={status}>{STATUS_NAMES[status]}</span> : !error && <span className="s-skel" style={{ width: 80, height: 26 }} />}</div>
          {error && <div className="s-form-alert" role="alert"><AlertCircle size={18} />{error}</div>}
          {!catalog && !error && <><div className="s-skel" style={{ height: 120 }} /><div className="s-skel" style={{ height: 120 }} /></>}
          {active === 'web' && <div className="s-build"><div className="s-build-row"><h3>Веб-плеер</h3><a className="s-btn s-btn-primary" href="/app">Открыть<ArrowRight size={17} aria-hidden="true" /></a></div><p className="s-note">Обновляется сам: открытая вкладка подхватит новую версию, когда ты не слушаешь музыку и ничего не редактируешь.</p></div>}
          {entry?.builds.map(b => <BuildCard key={b.id} build={b} betaAllowed={!!catalog?.betaAllowed} signedIn={!!catalog?.signedIn} />)}
          {catalog && entry && !entry.builds.length && active !== 'web' && <div className="s-notice" data-tone="warn"><Info size={18} /><span>{entry.note}</span></div>}
          {catalog && entry && !entry.builds.length && (active === 'linux' || active === 'ios') && <div className="s-actions"><a className="s-btn s-btn-primary" href="/app">Открыть веб-версию</a>{active === 'ios' && <Link className="s-btn" to="/download/ios">Как поставить на iPhone</Link>}</div>}
        </section>
        <aside className="s-glass s-dl-side" aria-label="Как установить">
          <h3>Системные требования</h3><p className="s-note">{guide.requirements}</p>
          <h3>Установка</h3><ol>{guide.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {guide.note && <div className="s-notice"><ShieldCheck size={18} /><span>{guide.note}</span></div>}
          {guide.more && <Link className="s-btn" to={guide.more.to}>{guide.more.label}<ArrowRight size={16} aria-hidden="true" /></Link>}
        </aside>
      </div>
    </div>
  </PageShell>;
}
