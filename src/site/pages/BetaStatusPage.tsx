import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock3, Download, RefreshCw, Send, XCircle } from 'lucide-react';
import { forgetApplication, savedApplications, siteApi, SiteApiError, type ApplicationView } from '../api.js';
import { PageShell, usePageMeta } from '../components/chrome.js';
import { formatDate } from '../platform.js';

const PLATFORM_LABEL: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', web: 'Web' };
const TITLES = { pending: 'На рассмотрении', approved: 'Одобрено', rejected: 'Отклонено', duplicate: 'Повторная заявка' };

/** The token comes from the URL fragment (never sent to the server in a URL) or this browser's storage. */
function initialToken() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('t');
  if (fromHash) { history.replaceState(history.state, '', location.pathname); return fromHash; }
  return sessionStorage.getItem('oskolok_beta_last') || savedApplications()[0]?.token || '';
}
const extractToken = (value: string) => { const v = value.trim(); const m = v.match(/[#&?]t=([A-Za-z0-9_-]{20,64})/); return m ? m[1] : /^[A-Za-z0-9_-]{20,64}$/.test(v) ? v : ''; };

function StatusCard({ app, token, onRefresh }: { app: ApplicationView; token?: string; onRefresh: () => void }) {
  const [link, setLink] = React.useState<{ url: string; busy: boolean; error: string }>({ url: '', busy: false, error: '' });
  const Icon = app.status === 'approved' ? CheckCircle2 : app.status === 'rejected' ? XCircle : Clock3;
  const reissue = async () => {
    if (!token) return;
    setLink({ url: '', busy: true, error: '' });
    try { const r = await siteApi<{ verifyUrl: string }>('/beta/status/verify-link', { method: 'POST', body: { statusToken: token } }); setLink({ url: r.verifyUrl, busy: false, error: '' }); window.open(r.verifyUrl, '_blank', 'noopener,noreferrer'); }
    catch (e) { setLink({ url: '', busy: false, error: e instanceof Error ? e.message : 'Не получилось.' }); if (e instanceof SiteApiError && e.code === 'ALREADY_VERIFIED') onRefresh(); }
  };
  return <section className="s-glass s-status" aria-live="polite">
    <p className="s-muted">Заявка {app.number}</p>
    <p className="s-status-badge" data-s={app.status}><Icon size={30} aria-hidden="true" />{app.status === 'pending' && app.verifyPending ? 'Ждёт подтверждения Telegram' : TITLES[app.status]}</p>
    {app.status === 'pending' && app.verifyPending && <div className="s-verify">
      <b>Подтверди Telegram, чтобы заявку рассмотрели</b>
      <p className="s-note">{app.verifyExpired ? 'Прошлая ссылка устарела. Получи новую: она откроет нашего бота, там нажми «Запустить».' : 'Открой бота по кнопке и нажми «Запустить». Если ссылка потерялась, получи новую.'}</p>
      {token && <button className="s-btn s-btn-primary" type="button" onClick={reissue} disabled={link.busy}>{link.busy ? <span className="s-spinner" aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}Получить новую ссылку</button>}
      {link.url && <a className="s-link" href={link.url} target="_blank" rel="noopener noreferrer">Если бот не открылся, нажми сюда</a>}
      {link.error && <div className="s-form-alert" role="alert"><AlertCircle size={18} />{link.error}</div>}
    </div>}
    {app.status === 'pending' && !app.verifyPending && <p className="s-lead">Telegram подтверждён, заявка в очереди. Мы читаем каждую заявку вручную; когда решим, бот напишет тебе в личные сообщения.</p>}
    {app.status === 'approved' && <>
      <p className="s-lead">Добро пожаловать в бету! Войди в Осколок через тот же Telegram-аккаунт, которым подтверждал заявку.</p>
      <div className="s-actions"><a className="s-btn s-btn-primary" href="/app">Открыть веб-плеер</a><Link className="s-btn" to="/download"><Download size={16} aria-hidden="true" />Приложения и бета-сборки</Link></div>
    </>}
    {app.status === 'rejected' && <>
      <p className="s-lead">Спасибо за интерес к Осколку! Сейчас мы не можем предоставить доступ к закрытому бета-тестированию. Следи за каналом: наборы ещё будут.</p>
      {app.rejectionReason && <div className="s-notice"><AlertCircle size={18} /><span><b>Комментарий:</b> {app.rejectionReason}</span></div>}
    </>}
    {app.status === 'duplicate' && <p className="s-lead">У этого Telegram-аккаунта уже есть активная заявка, рассматривается она. Её статус можно узнать в боте командой /beta_status.</p>}
    <dl className="s-meta">
      <div><dt>Username в заявке</dt><dd>@{app.telegramUsername}</dd></div>
      <div><dt>Отправлена</dt><dd>{formatDate(app.createdAt)}</dd></div>
      {app.reviewedAt && <div><dt>Решение</dt><dd>{formatDate(app.reviewedAt)}</dd></div>}
      <div><dt>Платформы</dt><dd>{app.platforms.map(p => PLATFORM_LABEL[p] || p).join(', ') || 'не выбраны'}</dd></div>
    </dl>
    <div className="s-actions"><button className="s-btn s-btn-sm" type="button" onClick={onRefresh}><RefreshCw size={15} aria-hidden="true" />Обновить</button></div>
  </section>;
}

export function BetaStatusPage() {
  usePageMeta('Статус заявки на бета-тест Осколка', 'Статус заявки на бета-тест Осколка.', '/beta/status', true);
  const [token, setToken] = React.useState(initialToken);
  const [app, setApp] = React.useState<ApplicationView | null>(null);
  const [mine, setMine] = React.useState<{ signedIn: boolean; betaAllowed: boolean; applications: ApplicationView[] } | null>(null);
  const [state, setState] = React.useState<'idle' | 'loading' | 'error'>(token ? 'loading' : 'idle');
  const [error, setError] = React.useState('');
  const [input, setInput] = React.useState('');

  const load = React.useCallback(async (value = token) => {
    if (!value) { setApp(null); setState('idle'); return; }
    setState('loading'); setError('');
    try { const r = await siteApi<{ application: ApplicationView }>('/beta/status', { method: 'POST', body: { statusToken: value } }); setApp(r.application); setState('idle'); }
    catch (e) { setApp(null); setState('error'); setError(e instanceof Error ? e.message : 'Не удалось загрузить статус.'); if (e instanceof SiteApiError && e.status === 404) forgetApplication(value); }
  }, [token]);
  React.useEffect(() => { void load(); siteApi<typeof mine>('/beta/mine').then(setMine).catch(() => setMine(null)); }, [load]);
  // Re-check when the applicant comes back from the bot.
  React.useEffect(() => { const back = () => { if (!document.hidden && token) void load(); }; document.addEventListener('visibilitychange', back); return () => document.removeEventListener('visibilitychange', back); }, [load, token]);

  const lookup = (e: React.FormEvent) => { e.preventDefault(); const t = extractToken(input); if (!t) { setState('error'); setError('Вставь ссылку на статус целиком: она начинается с oskolok.lol/beta/status#t='); return; } setToken(t); void load(t); };
  const fromSession = mine?.signedIn ? mine.applications : [];

  return <PageShell>
    <div className="s-wrap s-page" style={{ maxWidth: 860 }}>
      <header className="s-page-head">
        <nav className="s-crumbs" aria-label="Навигация"><Link to="/">Осколок</Link><span aria-hidden="true">/</span><Link to="/beta">Бета-тест</Link><span aria-hidden="true">/</span><span>Статус</span></nav>
        <h1>Статус заявки</h1>
      </header>
      <div style={{ display: 'grid', gap: 16 }}>
        {state === 'loading' && <div className="s-glass s-status" aria-busy="true"><div className="s-skel" style={{ height: 16, width: 120 }} /><div className="s-skel" style={{ height: 34, width: '60%' }} /><div className="s-skel" style={{ height: 70 }} /></div>}
        {state !== 'loading' && app && <StatusCard app={app} token={token} onRefresh={() => void load()} />}
        {state !== 'loading' && !app && fromSession.map(a => <StatusCard key={a.number} app={a} onRefresh={() => location.reload()} />)}
        {mine?.signedIn && mine.betaAllowed && !app && !fromSession.length && <div className="s-glass s-status"><p className="s-status-badge" data-s="approved"><CheckCircle2 size={30} />Доступ к бете уже есть</p><div className="s-actions"><a className="s-btn s-btn-primary" href="/app">Открыть веб-плеер</a><Link className="s-btn" to="/download">Загрузки</Link></div></div>}
        {state === 'error' && <div className="s-form-alert" role="alert"><AlertCircle size={18} />{error}</div>}
        {!app && state !== 'loading' && <form className="s-glass s-form" onSubmit={lookup}>
          <div className="s-field">
            <label htmlFor="status-link">Ссылка на статус</label>
            <input id="status-link" className="s-input" value={input} onChange={e => setInput(e.target.value)} placeholder="https://oskolok.lol/beta/status#t=…" autoComplete="off" spellCheck={false} />
            <span className="s-hint">Ссылку показали после отправки заявки. Ещё можно спросить бота: команда /beta_status в <a className="s-link" href="https://t.me/oskolokplayerbot" target="_blank" rel="noopener noreferrer">@oskolokplayerbot</a> покажет заявку, подтверждённую твоим аккаунтом.</span>
          </div>
          <div className="s-actions"><button className="s-btn s-btn-primary" type="submit">Показать статус</button><Link className="s-btn" to="/beta">Подать новую заявку</Link></div>
        </form>}
      </div>
    </div>
  </PageShell>;
}
