import React from 'react';
import { Award, BarChart3, Check, Download, FileText, Flag, KeyRound, LogOut, MessageSquareWarning, RefreshCw, Search, ShieldCheck, Trash2, UserPlus, Users, X, Crown, Server, Disc3 } from 'lucide-react';
import { AdminDashboard } from '../admin/AdminDashboard.js';
import { AdminRolesTab, AdminUsersTab, AdminSystemTab } from '../admin/AdminTabs.js';
import { AdminUnreleasedTab } from '../admin/AdminUnreleasedTab.js';
import { AdminRewardsTab } from '../admin/AdminRewards.js';
import { apiBase } from '../telegram/runtime.js';
import { useTranslation } from '../stores/useLanguageStore.js';
import LumaSpin from '../components/ui/luma-spin.js';
import '../styles/admin.css';

type Author = { name?: string; username?: string | null } | undefined;
type Report = { id: string; reason: string; description: string; status: string; kind?: string; trackId?: string | null; page?: string | null; createdAt: string; reviewNote?: string | null; payload: any; attachments: Array<{ id: string; fileName: string; size: number }>; author: Author };
type Submission = { id: string; trackTitle: string; artistName: string; credit: string; status: string; createdAt: string; trackId: string; fileName?: string; lyricsData: string; reviewNote?: string | null; author: Author };
type Published = { id: string; trackTitle: string; artistName: string; credit: string; updatedAt: string };
type Beta = { id: string; username: string; telegramUserId: string | null; enabled: boolean; createdAt: string };
type Tab = 'overview' | 'reports' | 'lyrics' | 'unreleased' | 'users' | 'roles' | 'rewards' | 'beta' | 'system';

const KEY_STORAGE = 'oskolok_admin_key';
const who = (a: Author) => a?.username ? `@${a.username}` : a?.name || '—';
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function Status({ value }: { value: string }) {
  const t = useTranslation();
  const label: Record<string, string> = { pending: t('На проверке', 'Pending'), approved: t('Одобрено', 'Approved'), rejected: t('Отклонено', 'Rejected'), resolved: t('Решено', 'Resolved') };
  return <span className={`adm-status adm-status--${value}`}>{label[value] || value}</span>;
}


export function AdminPage() {
  const t = useTranslation();
  const [key, setKey] = React.useState(() => sessionStorage.getItem(KEY_STORAGE) || '');
  const [authorized, setAuthorized] = React.useState(false);
  const [checking, setChecking] = React.useState(Boolean(sessionStorage.getItem(KEY_STORAGE)));
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [tab, setTab] = React.useState<Tab>('overview');
  const [query, setQuery] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [reports, setReports] = React.useState<Report[]>([]);
  const [submissions, setSubmissions] = React.useState<Submission[]>([]);
  const [published, setPublished] = React.useState<Published[]>([]);
  const [beta, setBeta] = React.useState<Beta[]>([]);

  const request = React.useCallback(async (path: string, options: RequestInit = {}, token = key) => {
    const response = await fetch(`${apiBase}/admin${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
    if (response.ok && (options.headers as Record<string, string> | undefined)?.Accept === 'application/octet-stream') return response.blob();
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || t('Ошибка панели', 'Panel error'));
    return data.data;
  }, [key, t]);

  const load = React.useCallback(async (token = key) => {
    const [r, s, p, b] = await Promise.all([
      request('/reports?status=all', {}, token), request('/submissions?status=all', {}, token), request('/lyrics', {}, token), request('/beta', {}, token),
    ]);
    setReports(r); setSubmissions(s); setPublished(p); setBeta(b);
  }, [key, request]);

  const signIn = React.useCallback(async (token: string) => {
    setError(''); setChecking(true);
    try { await load(token); sessionStorage.setItem(KEY_STORAGE, token); setAuthorized(true); }
    catch (e) { sessionStorage.removeItem(KEY_STORAGE); setError((e as Error).message); }
    finally { setChecking(false); }
  }, [load]);

  React.useEffect(() => { const saved = sessionStorage.getItem(KEY_STORAGE); if (saved) void signIn(saved); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true); setNotice('');
    try { await fn(); await load(); if (done) setNotice(done); }
    catch (e) { setNotice((e as Error).message); }
    finally { setBusy(false); }
  };
  const post = (path: string, body: unknown, method = 'POST') => request(path, { method, body: JSON.stringify(body) });
  const logout = () => { sessionStorage.removeItem(KEY_STORAGE); setAuthorized(false); setKey(''); };

  if (!authorized) return <div className="adm-page">
    <form className="adm-login sg-glass" onSubmit={e => { e.preventDefault(); void signIn(key); }}>
      <span className="adm-login-icon"><KeyRound size={22} /></span>
      <h1>{t('Панель разработчика', 'Developer panel')}</h1>
      <p>{t('Обращения, тексты сообщества, бета-доступ и статистика.', 'Reports, community lyrics, beta access and statistics.')}</p>
      <label>{t('Ключ администратора', 'Admin key')}<input type="password" autoComplete="current-password" value={key} onChange={e => setKey(e.target.value)} required autoFocus /></label>
      {error && <p className="adm-error" role="alert">{error}</p>}
      <button className="sg-btn sg-btn--primary" disabled={checking}>{checking ? <LumaSpin size="sm" /> : <ShieldCheck size={16} />}{t('Войти', 'Sign in')}</button>
    </form>
  </div>;

  const q = query.trim().toLocaleLowerCase();
  const match = (...values: Array<string | null | undefined>) => !q || values.some(v => v?.toLocaleLowerCase().includes(q));
  const pendingReports = reports.filter(r => r.status === 'pending').length;
  const pendingLyrics = submissions.filter(s => s.status === 'pending').length;
  const tabs: Array<[Tab, string, typeof Flag, number?]> = [
    ['overview', t('Обзор', 'Overview'), BarChart3],
    ['reports', t('Обращения', 'Reports'), MessageSquareWarning, pendingReports],
    ['lyrics', t('Тексты', 'Lyrics'), FileText, pendingLyrics],
    ['unreleased', t('Анрелизы', 'Unreleased'), Disc3],
    ['users', t('Пользователи', 'Users'), Users],
    ['roles', t('Роли', 'Roles'), Crown],
    ['rewards', t('Награды', 'Rewards'), Award],
    ['beta', t('Бета-доступ', 'Beta access'), UserPlus],
    ['system', t('Система', 'System'), Server],
  ];

  return <div className="adm-page">
    <header className="adm-head">
      <div><span className="sg-eyebrow"><i className="sg-star" />{t('Осколок · разработчик', 'Oskolok · developer')}</span><h1>{t('Панель управления', 'Control panel')}</h1></div>
      <div className="adm-head-actions">
        <button className="adm-icon" onClick={() => void act(load, t('Обновлено', 'Refreshed'))} disabled={busy} aria-label={t('Обновить', 'Refresh')}><RefreshCw size={16} className={busy ? 'adm-spin' : ''} /></button>
        <button className="adm-icon" onClick={logout} aria-label={t('Выйти', 'Sign out')}><LogOut size={16} /></button>
      </div>
    </header>


    <div className="adm-toolbar">
      <nav className="adm-tabs" role="tablist">{tabs.map(([id, label, Icon, count]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={15} />{label}{count ? <b>{count}</b> : null}</button>)}</nav>
      {['reports', 'lyrics', 'beta'].includes(tab) && <label className="adm-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Поиск', 'Search')} />{query && <button onClick={() => setQuery('')} aria-label={t('Очистить', 'Clear')}><X size={13} /></button>}</label>}
    </div>
    {notice && <p className="adm-notice" role="status">{notice}</p>}

    {tab === 'reports' && <ReportsTab rows={reports.filter(r => match(r.reason, r.description, r.trackId, who(r.author), r.id))} busy={busy} request={request}
      review={(id, decision, note) => void act(() => post(`/reports/${encodeURIComponent(id)}/review`, { decision, reviewNote: note }), t('Решение сохранено', 'Decision saved'))} />}
    {tab === 'lyrics' && <LyricsTab rows={submissions.filter(s => match(s.trackTitle, s.artistName, s.credit, who(s.author)))} published={published.filter(p => match(p.trackTitle, p.artistName, p.credit))} busy={busy}
      review={(id, decision, note) => void act(() => post(`/submissions/${encodeURIComponent(id)}/review`, { decision, reviewNote: note }), t('Решение сохранено', 'Decision saved'))}
      unpublish={id => void act(() => post(`/lyrics/${encodeURIComponent(id)}`, {}, 'DELETE'), t('Текст снят с публикации', 'Lyrics unpublished'))} />}
    {tab === 'beta' && <BetaTab rows={beta.filter(b => match(b.username, b.telegramUserId))} busy={busy}
      grant={username => void act(() => post('/beta', { username }), t('Доступ выдан', 'Access granted'))}
      revoke={username => void act(() => post(`/beta/${encodeURIComponent(username)}`, { username }, 'DELETE'), t('Доступ отозван', 'Access revoked'))} />}
    {tab === 'overview' && <AdminDashboard request={request} />}
    {tab === 'users' && <AdminUsersTab request={request} />}
    {tab === 'roles' && <AdminRolesTab request={request} />}
    {tab === 'rewards' && <AdminRewardsTab request={request} />}
    {tab === 'system' && <AdminSystemTab request={request} />}
    {tab === 'unreleased' && <AdminUnreleasedTab request={request} />}
  </div>;
}

function Note({ id }: { id: string }) {
  const t = useTranslation();
  return <textarea className="adm-note" data-note={id} maxLength={1000} rows={2} placeholder={t('Комментарий для автора (необязательно)', 'Note for the author (optional)')} />;
}
const noteOf = (id: string) => document.querySelector<HTMLTextAreaElement>(`[data-note="${CSS.escape(id)}"]`)?.value || '';

function ReportsTab({ rows, busy, review, request }: { rows: Report[]; busy: boolean; review: (id: string, decision: string, note: string) => void; request: (path: string, options?: RequestInit) => Promise<any> }) {
  const t = useTranslation();
  const [filter, setFilter] = React.useState('pending');
  const filters = ['pending', 'approved', 'resolved', 'rejected', 'all'];
  const shown = rows.filter(r => filter === 'all' || r.status === filter);
  const download = async (file: { id: string; fileName: string }) => {
    const blob = await request(`/files/${file.id}`, { headers: { Accept: 'application/octet-stream' } });
    const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob])), a = document.createElement('a');
    a.href = url; a.download = file.fileName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="adm-panel">
    <div className="adm-chips">{filters.map(f => <button key={f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>{f === 'all' ? t('Все', 'All') : <Status value={f} />}<small>{f === 'all' ? rows.length : rows.filter(r => r.status === f).length}</small></button>)}</div>
    {!shown.length && <p className="adm-empty">{t('Здесь пусто.', 'Nothing here.')}</p>}
    {shown.map(r => <details key={r.id} className="adm-item" open={r.status === 'pending' && shown.length <= 3}>
      <summary><Status value={r.status} /><strong>{r.reason}</strong><span>{who(r.author)} · {when(r.createdAt)}</span><code>#{r.id.slice(0, 8)}</code></summary>
      <div className="adm-item-body">
        <p className="adm-desc">{r.description}</p>
        <dl className="adm-meta">
          {r.kind && <><dt>{t('Тип', 'Kind')}</dt><dd>{r.kind}</dd></>}
          {r.trackId && <><dt>{t('Трек', 'Track')}</dt><dd><a href={`/track/${encodeURIComponent(r.trackId)}`} target="_blank" rel="noopener">{r.payload?.trackTitle || r.trackId} ↗</a></dd></>}
          {r.page && <><dt>{t('Страница', 'Page')}</dt><dd>{r.page}</dd></>}
          {typeof r.payload?.offset === 'number' && <><dt>{t('Смещение', 'Offset')}</dt><dd>{r.payload.offset > 0 ? '+' : ''}{r.payload.offset.toFixed(1)} {t('с', 's')}</dd></>}
          {Array.isArray(r.payload?.lines) && <><dt>{t('Строк', 'Lines')}</dt><dd>{r.payload.lines.length}</dd></>}
          {r.reviewNote && <><dt>{t('Ответ', 'Reply')}</dt><dd>{r.reviewNote}</dd></>}
        </dl>
        {r.attachments.length > 0 && <div className="adm-files">{r.attachments.map(f => <button key={f.id} onClick={() => void download(f)}><Download size={14} />{f.fileName}<small>{Math.ceil(f.size / 1024)} KB</small></button>)}</div>}
        {r.status === 'pending' && <><Note id={r.id} /><div className="adm-actions">
          <button className="sg-btn sg-btn--primary" disabled={busy} onClick={() => review(r.id, 'approved', noteOf(r.id))}><Check size={15} />{r.kind === 'lyrics' || r.kind === 'timing' ? t('Одобрить и применить', 'Approve and apply') : t('Одобрить', 'Approve')}</button>
          <button className="sg-btn" disabled={busy} onClick={() => review(r.id, 'resolved', noteOf(r.id))}><ShieldCheck size={15} />{t('Решено', 'Resolved')}</button>
          <button className="sg-btn adm-danger" disabled={busy} onClick={() => review(r.id, 'rejected', noteOf(r.id))}><X size={15} />{t('Отклонить', 'Reject')}</button>
        </div></>}
      </div>
    </details>)}
  </section>;
}

function LyricsPreview({ data }: { data: string }) {
  const t = useTranslation();
  let lines: Array<{ time: number; text: string; words?: unknown[] }> = [];
  try { lines = JSON.parse(data); } catch { /* malformed submissions show nothing */ }
  const timed = lines.some(l => Array.isArray(l.words) && l.words.length);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return <div className="adm-lyrics">
    <small>{lines.length} {t('строк', 'lines')} · {timed ? t('по словам', 'word-timed') : t('по строкам', 'line-timed')}</small>
    <ol>{lines.slice(0, 10).map((l, i) => <li key={i}><time>{fmt(l.time || 0)}</time>{l.text}</li>)}</ol>
    {lines.length > 10 && <small>… {t(`ещё ${lines.length - 10}`, `${lines.length - 10} more`)}</small>}
  </div>;
}

function LyricsTab({ rows, published, busy, review, unpublish }: { rows: Submission[]; published: Published[]; busy: boolean; review: (id: string, decision: string, note: string) => void; unpublish: (id: string) => void }) {
  const t = useTranslation();
  const [view, setView] = React.useState<'queue' | 'published'>('queue');
  const queue = rows.filter(s => s.status === 'pending'), history = rows.filter(s => s.status !== 'pending');
  return <section className="adm-panel">
    <div className="adm-chips">
      <button className={view === 'queue' ? 'is-active' : ''} onClick={() => setView('queue')}>{t('Очередь', 'Queue')}<small>{queue.length}</small></button>
      <button className={view === 'published' ? 'is-active' : ''} onClick={() => setView('published')}>{t('Опубликованные', 'Published')}<small>{published.length}</small></button>
    </div>
    {view === 'queue' ? <>
      {!queue.length && <p className="adm-empty">{t('Очередь пуста — всё проверено.', 'The queue is empty — all reviewed.')}</p>}
      {queue.map(s => <details key={s.id} className="adm-item" open={queue.length <= 2}>
        <summary><Status value={s.status} /><strong>{s.artistName} — {s.trackTitle}</strong><span>{who(s.author)} · {when(s.createdAt)}</span></summary>
        <div className="adm-item-body">
          <dl className="adm-meta"><dt>{t('Авторство', 'Credit')}</dt><dd>{s.credit}</dd><dt>ID</dt><dd><a href={`/track/${encodeURIComponent(s.trackId)}`} target="_blank" rel="noopener">{s.trackId} ↗</a></dd>{s.fileName && <><dt>{t('Файл', 'File')}</dt><dd>{s.fileName}</dd></>}</dl>
          <LyricsPreview data={s.lyricsData} />
          <Note id={s.id} />
          <div className="adm-actions">
            <button className="sg-btn sg-btn--primary" disabled={busy} onClick={() => review(s.id, 'approved', noteOf(s.id))}><Check size={15} />{t('Опубликовать', 'Publish')}</button>
            <button className="sg-btn adm-danger" disabled={busy} onClick={() => review(s.id, 'rejected', noteOf(s.id))}><X size={15} />{t('Отклонить', 'Reject')}</button>
          </div>
        </div>
      </details>)}
      {history.length > 0 && <h3 className="adm-sub">{t('Рассмотренные', 'Reviewed')}</h3>}
      {history.slice(0, 30).map(s => <div key={s.id} className="adm-row"><Status value={s.status} /><strong>{s.artistName} — {s.trackTitle}</strong><span>{who(s.author)} · {when(s.createdAt)}</span></div>)}
    </> : <>
      {!published.length && <p className="adm-empty">{t('Пока ничего не опубликовано.', 'Nothing published yet.')}</p>}
      {published.map(p => <div key={p.id} className="adm-row"><strong>{p.artistName} — {p.trackTitle}</strong><span>{p.credit} · {when(p.updatedAt)}</span>
        <button className="adm-icon adm-danger" disabled={busy} aria-label={t('Снять с публикации', 'Unpublish')} onClick={() => { if (confirm(t('Снять текст с публикации?', 'Unpublish these lyrics?'))) unpublish(p.id); }}><Trash2 size={15} /></button></div>)}
    </>}
  </section>;
}

function BetaTab({ rows, busy, grant, revoke }: { rows: Beta[]; busy: boolean; grant: (u: string) => void; revoke: (u: string) => void }) {
  const t = useTranslation();
  const [username, setUsername] = React.useState('');
  return <section className="adm-panel">
    <form className="adm-inline" onSubmit={e => { e.preventDefault(); grant(username); setUsername(''); }}>
      <label><span>Telegram username</span><input value={username} onChange={e => setUsername(e.target.value)} placeholder="@username" required pattern="@?[A-Za-z0-9_]{5,32}" /></label>
      <button className="sg-btn sg-btn--primary" disabled={busy}><UserPlus size={15} />{t('Выдать доступ', 'Grant access')}</button>
    </form>
    <p className="adm-hint">{t('Первый подтверждённый вход закрепляет доступ за Telegram ID. Отзыв завершает его веб-сессии.', 'The first verified sign-in binds access to the Telegram ID. Revoking ends their web sessions.')}</p>
    {rows.map(b => <div key={b.id} className="adm-row">
      <span className={`adm-dot ${b.enabled ? 'is-on' : ''}`} aria-hidden="true" /><strong>@{b.username}</strong>
      <span>{b.telegramUserId ? t('вошёл', 'signed in') + ' · ' + b.telegramUserId.replace('telegram:', 'ID ') : t('ещё не входил', 'not signed in yet')} · {when(b.createdAt)}</span>
      {b.enabled ? <button className="sg-btn adm-danger" disabled={busy} onClick={() => revoke(b.username)}>{t('Отозвать', 'Revoke')}</button> : <button className="sg-btn" disabled={busy} onClick={() => grant(b.username)}>{t('Вернуть', 'Restore')}</button>}
    </div>)}
  </section>;
}

