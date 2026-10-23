import React from 'react';
import { ArrowDown, ArrowUp, Database, Eraser, History, KeyRound, Plus, RefreshCw, Save, Search, ShieldOff, Trash2, UserMinus, UserPlus, X } from 'lucide-react';
import { useTranslation } from '../stores/useLanguageStore.js';
import LumaSpin from '../components/ui/luma-spin.js';
import { RoleBadge, RoleBadges, ROLE_ICONS, topRoleColor, type PublicRole } from '../components/profile/RoleBadge.js';
import { UserRewardsSection } from './AdminRewards.js';

type Request = (path: string, options?: RequestInit) => Promise<any>;
type Role = PublicRole & { members: number; description: string; hoist: boolean };
type Member = { id: string; name: string; username: string | null; avatarUrl: string | null; assignedAt: string };
type UserRow = { id: string; name: string; username: string | null; avatarUrl: string | null; createdAt: string; lastActiveAt: string | null; roles: PublicRole[]; plays: number; beta: boolean | null };
type UserDetail = UserRow & { counts: { plays: number; likes: number; lyrics: number; sessions: number; reports: number }; recent: Array<{ trackId: string; title: string; artist: string; artworkUrl?: string; playedAt: string }> };

const post = (request: Request, path: string, body: unknown, method = 'POST') => request(path, { method, body: JSON.stringify(body) });
const ago = (iso: string | null, t: (ru: string, en: string) => string) => {
  if (!iso) return t('никогда', 'never');
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? t('только что', 'just now') : m < 60 ? t(`${m} мин назад`, `${m} min ago`) : m < 1440 ? t(`${Math.round(m / 60)} ч назад`, `${Math.round(m / 60)} h ago`) : new Date(iso).toLocaleDateString();
};
const PRESET_COLORS = ['#ff5c7a', '#ff8a3d', '#ffb547', '#3ddc97', '#2bc4c4', '#5aa9ff', '#7c9cff', '#b07cff', '#ff7ce0', '#c9d2e3'];
function useDebounced<T>(value: T, ms = 250) { const [v, setV] = React.useState(value); React.useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]); return v; }

function Avatar({ src, name }: { src?: string | null; name: string }) {
  return src ? <img className="adm-avatar" src={src} alt="" /> : <span className="adm-avatar adm-avatar--empty" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

/** Finds a user by name, @username or id; used to add role members. */
function UserPicker({ request, onPick, exclude }: { request: Request; onPick: (u: UserRow) => void; exclude: Set<string> }) {
  const t = useTranslation(), [q, setQ] = React.useState(''), dq = useDebounced(q), [rows, setRows] = React.useState<UserRow[]>([]);
  React.useEffect(() => { let live = true; if (!dq.trim()) { setRows([]); return; } request(`/users?q=${encodeURIComponent(dq)}`).then(r => { if (live) setRows(r); }).catch(() => {}); return () => { live = false; }; }, [dq, request]);
  return <div className="adm-picker">
    <label className="adm-search"><Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Найти пользователя: имя, @ник или id', 'Find a user: name, @handle or id')} /></label>
    {rows.length > 0 && <ul>{rows.filter(r => !exclude.has(r.id)).slice(0, 8).map(r => <li key={r.id}><button onClick={() => { onPick(r); setQ(''); }}><Avatar src={r.avatarUrl} name={r.name} /><span><b>{r.name}</b><small>{r.username ? `@${r.username}` : r.id}</small></span><UserPlus size={15} /></button></li>)}</ul>}
  </div>;
}

/* ───────────────────────── Roles ───────────────────────── */
export function AdminRolesTab({ request }: { request: Request }) {
  const t = useTranslation();
  const [roles, setRoles] = React.useState<Role[] | null>(null), [selected, setSelected] = React.useState<string | null>(null), [members, setMembers] = React.useState<Member[]>([]);
  const [draft, setDraft] = React.useState<Partial<Role> | null>(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const list: Role[] = await request('/roles'); setRoles(list); return list; }, [request]);
  React.useEffect(() => { void load().then(list => setSelected(s => s ?? list[0]?.id ?? null)).catch(e => setError((e as Error).message)); }, [load]);
  React.useEffect(() => { if (!selected) { setMembers([]); return; } request(`/roles/${selected}/members`).then(setMembers).catch(() => setMembers([])); }, [selected, request]);
  const role = roles?.find(r => r.id === selected);
  React.useEffect(() => { setDraft(role ? { name: role.name, color: role.color, icon: role.icon, description: role.description, hoist: role.hoist } : null); }, [role?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const move = (id: string, dir: -1 | 1) => run(async () => {
    const order = roles!.map(r => r.id), i = order.indexOf(id), j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setRoles(await post(request, '/roles/reorder', { order }));
  });
  const create = () => run(async () => { const r = await post(request, '/roles', { name: t('Новая роль', 'New role'), color: PRESET_COLORS[(roles?.length || 0) % PRESET_COLORS.length], icon: 'star', description: '', hoist: true }); await load(); setSelected(r.id); });
  const save = () => run(async () => { if (!role || !draft) return; await post(request, `/roles/${role.id}`, draft, 'PATCH'); await load(); });
  const remove = () => run(async () => { if (!role || !confirm(t(`Удалить роль «${role.name}»? Её снимут со всех участников.`, `Delete role “${role.name}”? It will be removed from all members.`))) return; await post(request, `/roles/${role.id}`, {}, 'DELETE'); const list = await load(); setSelected(list[0]?.id ?? null); });
  const add = (u: UserRow) => run(async () => { if (!role) return; setMembers(await post(request, `/roles/${role.id}/members`, { userId: u.id })); await load(); });
  const kick = (userId: string) => run(async () => { if (!role) return; setMembers(await request(`/roles/${role.id}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' })); await load(); });

  if (!roles) return <div className="adm-dash-loading"><LumaSpin size="md" /></div>;
  const preview = role && draft ? { ...role, ...draft } as Role : null;
  return <section className="adm-roles">
    <aside className="adm-roles-list">
      <header><h3>{t('Роли', 'Roles')}</h3><button className="adm-icon" onClick={() => void create()} disabled={busy} aria-label={t('Создать роль', 'Create role')}><Plus size={16} /></button></header>
      <p className="adm-hint">{t('Выше — главнее: верхняя роль окрашивает имя.', 'Higher wins: the top role tints the name.')}</p>
      <ol>{roles.map((r, i) => <li key={r.id} className={r.id === selected ? 'is-active' : ''}>
        <button className="adm-role-row" onClick={() => setSelected(r.id)}><i style={{ background: r.color }} /><span>{r.name}</span><small>{r.members}</small></button>
        <span className="adm-role-move"><button onClick={() => void move(r.id, -1)} disabled={busy || i === 0} aria-label={t('Выше', 'Up')}><ArrowUp size={13} /></button><button onClick={() => void move(r.id, 1)} disabled={busy || i === roles.length - 1} aria-label={t('Ниже', 'Down')}><ArrowDown size={13} /></button></span>
      </li>)}</ol>
    </aside>
    {role && draft && preview ? <div className="adm-role-edit">
      <div className="adm-role-preview"><span style={{ color: preview.color }} className="adm-role-name">{t('Имя пользователя', 'User name')}</span><RoleBadge role={preview} /></div>
      <div className="adm-form">
        <label>{t('Название', 'Name')}<input value={draft.name || ''} maxLength={32} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>{t('Описание (подсказка при наведении)', 'Description (hover hint)')}<input value={draft.description || ''} maxLength={120} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <fieldset><legend>{t('Цвет', 'Colour')}</legend><div className="adm-swatches">{PRESET_COLORS.map(c => <button key={c} style={{ background: c }} aria-label={c} aria-pressed={draft.color === c} onClick={() => setDraft({ ...draft, color: c })} />)}<input type="color" value={draft.color || '#9cbeff'} onChange={e => setDraft({ ...draft, color: e.target.value })} aria-label={t('Свой цвет', 'Custom colour')} /></div></fieldset>
        <fieldset><legend>{t('Значок', 'Icon')}</legend><div className="adm-icons">{Object.entries(ROLE_ICONS).map(([id, Icon]) => <button key={id} aria-pressed={draft.icon === id} aria-label={id} onClick={() => setDraft({ ...draft, icon: id })}><Icon size={16} /></button>)}</div></fieldset>
        <label className="adm-check"><input type="checkbox" checked={draft.hoist !== false} onChange={e => setDraft({ ...draft, hoist: e.target.checked })} />{t('Показывать значок в профиле', 'Show badge on profiles')}</label>
        <div className="adm-row-actions"><button className="sg-btn sg-btn--primary" disabled={busy} onClick={() => void save()}><Save size={15} />{t('Сохранить', 'Save')}</button><button className="sg-btn" disabled={busy} onClick={() => void remove()}><Trash2 size={15} />{t('Удалить роль', 'Delete role')}</button></div>
      </div>
      <h3 className="adm-sub">{t('Участники', 'Members')} · {members.length}</h3>
      <UserPicker request={request} onPick={u => void add(u)} exclude={new Set(members.map(m => m.id))} />
      {members.length ? <ul className="adm-members">{members.map(m => <li key={m.id}><Avatar src={m.avatarUrl} name={m.name} /><span><b style={{ color: role.color }}>{m.name}</b><small>{m.username ? `@${m.username}` : m.id} · {t('с', 'since')} {new Date(m.assignedAt).toLocaleDateString()}</small></span><button className="adm-icon" onClick={() => void kick(m.id)} disabled={busy} aria-label={t('Снять роль', 'Remove role')}><UserMinus size={15} /></button></li>)}</ul> : <p className="adm-empty">{t('Пока никому не выдана.', 'Not assigned yet.')}</p>}
    </div> : <p className="adm-empty">{t('Выберите роль слева.', 'Pick a role on the left.')}</p>}
    {error && <p className="adm-error" role="alert">{error}</p>}
  </section>;
}

/* ───────────────────────── Users ───────────────────────── */
export function AdminUsersTab({ request }: { request: Request }) {
  const t = useTranslation();
  const [q, setQ] = React.useState(''), dq = useDebounced(q), [rows, setRows] = React.useState<UserRow[] | null>(null), [open, setOpen] = React.useState<UserDetail | null>(null), [roles, setRoles] = React.useState<Role[]>([]), [notice, setNotice] = React.useState('');
  const load = React.useCallback(() => request(`/users?q=${encodeURIComponent(dq)}`).then(setRows).catch(e => setNotice((e as Error).message)), [dq, request]);
  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { request('/roles').then(setRoles).catch(() => {}); }, [request]);
  const show = (id: string) => request(`/users/${encodeURIComponent(id)}`).then(setOpen).catch(e => setNotice((e as Error).message));
  const toggleRole = async (roleId: string, has: boolean) => {
    if (!open) return;
    await (has ? request(`/roles/${roleId}/members/${encodeURIComponent(open.id)}`, { method: 'DELETE' }) : post(request, `/roles/${roleId}/members`, { userId: open.id }));
    await show(open.id); void load();
  };
  const revoke = async () => { if (!open || !confirm(t('Завершить все сессии пользователя? Ему придётся войти заново.', 'End all of this user’s sessions? They will have to sign in again.'))) return; const r = await post(request, `/users/${encodeURIComponent(open.id)}/sessions/revoke`, {}); setNotice(t(`Завершено сессий: ${r.revoked}`, `Sessions ended: ${r.revoked}`)); await show(open.id); };
  return <section className="adm-users">
    <label className="adm-search adm-search--wide"><Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Имя, @ник или id', 'Name, @handle or id')} />{q && <button onClick={() => setQ('')} aria-label={t('Очистить', 'Clear')}><X size={13} /></button>}</label>
    {notice && <p className="adm-notice" role="status">{notice}</p>}
    {!rows ? <div className="adm-dash-loading"><LumaSpin size="md" /></div> : <table className="adm-table adm-table--users"><thead><tr><th>{t('Пользователь', 'User')}</th><th>{t('Роли', 'Roles')}</th><th>{t('Прослушиваний', 'Plays')}</th><th>{t('Бета', 'Beta')}</th><th>{t('Был в сети', 'Last seen')}</th><th>{t('С нами с', 'Joined')}</th></tr></thead>
      <tbody>{rows.map(u => <tr key={u.id} onClick={() => void show(u.id)} className="is-clickable"><td><span className="adm-user"><Avatar src={u.avatarUrl} name={u.name} /><span><b style={{ color: topRoleColor(u.roles) }}>{u.name}</b><small>{u.username ? `@${u.username}` : u.id}</small></span></span></td><td><RoleBadges roles={u.roles} compact /></td><td>{u.plays}</td><td>{u.beta === null ? '—' : u.beta ? '✓' : '✕'}</td><td>{ago(u.lastActiveAt, t)}</td><td>{new Date(u.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table>}
    {open && <div className="adm-drawer-backdrop" onClick={() => setOpen(null)}>
      <aside className="adm-drawer" role="dialog" aria-modal="true" aria-label={open.name} onClick={e => e.stopPropagation()}>
        <header><Avatar src={open.avatarUrl} name={open.name} /><span><b style={{ color: topRoleColor(open.roles) }}>{open.name}</b><small>{open.username ? `@${open.username}` : ''} {open.id}</small></span><button className="adm-icon" onClick={() => setOpen(null)} aria-label={t('Закрыть', 'Close')}><X size={16} /></button></header>
        <div className="adm-mini-kpis">{([['plays', t('прослушиваний', 'plays')], ['likes', t('лайков', 'likes')], ['lyrics', t('текстов', 'lyrics')], ['sessions', t('сессий', 'sessions')], ['reports', t('обращений', 'reports')]] as const).map(([k, l]) => <span key={k}><b>{open.counts[k]}</b><small>{l}</small></span>)}</div>
        <h4>{t('Роли', 'Roles')}</h4>
        <div className="adm-role-toggles">{roles.map(r => { const has = open.roles.some(x => x.id === r.id); return <button key={r.id} aria-pressed={has} className={has ? 'is-on' : ''} onClick={() => void toggleRole(r.id, has)}><RoleBadge role={r} /></button>; })}</div>
        <UserRewardsSection request={request} userId={open.id} />
        <h4>{t('Недавно слушал', 'Recently played')}</h4>
        <ul className="adm-now">{open.recent.map((r, i) => <li key={`${r.trackId}:${i}`}>{r.artworkUrl ? <img src={r.artworkUrl} alt="" /> : <i />}<span><b>{r.title}</b><small>{r.artist} · {ago(r.playedAt, t)}</small></span></li>)}</ul>
        <div className="adm-row-actions"><button className="sg-btn" onClick={() => void revoke()} disabled={!open.counts.sessions}><ShieldOff size={15} />{t('Завершить все сессии', 'End all sessions')}</button></div>
      </aside>
    </div>}
  </section>;
}

/* ───────────────────────── System ───────────────────────── */
type Health = { uptimeSec: number; node: string; platform: string; database: string; dbBytes: number | null; rssMb: number; heapMb: number; caches: Array<{ kind: string; rows: number }>; spotify?: { configured: boolean; blockedUntil: number; reason: string; usage?: { lastHour: number; byEndpoint: Array<{ endpoint: string; count: number }>; windowLimit: number; windowSeconds: number; cacheHitsLastHour: number } } };
type AuditRow = { id: string; action: string; target: string; details: string; createdAt: string };
export function AdminSystemTab({ request }: { request: Request }) {
  const t = useTranslation(), [health, setHealth] = React.useState<Health | null>(null), [log, setLog] = React.useState<AuditRow[]>([]), [notice, setNotice] = React.useState(''), [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const [h, a] = await Promise.all([request('/health'), request('/audit')]); setHealth(h); setLog(a); }, [request]);
  React.useEffect(() => { void load().catch(e => setNotice((e as Error).message)); }, [load]);
  const clear = async (kind: string) => { setBusy(true); try { const r = await post(request, '/cache/clear', { kind }); setNotice(t(`Очищено записей: ${r.removed}`, `Entries cleared: ${r.removed}`)); await load(); } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); } };
  const up = health ? `${Math.floor(health.uptimeSec / 86400)}д ${Math.floor(health.uptimeSec % 86400 / 3600)}ч ${Math.floor(health.uptimeSec % 3600 / 60)}м` : '';
  const CACHE_LABEL: Record<string, string> = { genius: t('Genius: биографии и аннотации', 'Genius bios and annotations'), popularity: t('Популярность треков', 'Track popularity'), translations: t('Переводы текстов', 'Lyrics translations'), soundcloud: t('Ссылки SoundCloud', 'SoundCloud links') };
  return <section className="adm-system">
    {notice && <p className="adm-notice" role="status">{notice}</p>}
    {!health ? <div className="adm-dash-loading"><LumaSpin size="md" /></div> : <>
      <div className="adm-kpis adm-kpis--4">
        <div className="adm-kpi"><span className="adm-kpi-label"><RefreshCw size={14} />{t('Аптайм сервера', 'Server uptime')}</span><strong>{up}</strong><span className="adm-kpi-foot"><em className="is-flat">Node {health.node}</em></span></div>
        <div className="adm-kpi"><span className="adm-kpi-label"><Database size={14} />{t('База данных', 'Database')}</span><strong>{health.dbBytes != null ? `${Math.round(health.dbBytes / 1048576)} МБ` : '—'}</strong><span className="adm-kpi-foot"><em className="is-flat">{health.database}</em></span></div>
        <div className="adm-kpi"><span className="adm-kpi-label"><KeyRound size={14} />{t('Память процесса', 'Process memory')}</span><strong>{health.rssMb} МБ</strong><span className="adm-kpi-foot"><em className="is-flat">heap {health.heapMb} МБ</em></span></div>
        <div className="adm-kpi"><span className="adm-kpi-label"><History size={14} />{t('Платформа', 'Platform')}</span><strong>{health.platform}</strong></div>
      </div>
      {health.spotify && <article className="adm-tile"><h3>Spotify</h3><p className={health.spotify.reason ? 'adm-error' : 'adm-hint'}>{!health.spotify.configured ? t('Ключи Spotify не заданы — каталог идёт через Deezer.', 'Spotify keys are not set — the catalogue uses Deezer.') : health.spotify.reason === 'premium_required' ? t('Spotify отклоняет запросы: у владельца приложения на developer.spotify.com нет Premium. Оформите Premium на этом аккаунте или пересоздайте приложение под аккаунтом с Premium — доступ появится через несколько часов. Пока каталог идёт через Deezer.', 'Spotify refuses requests: the app owner on developer.spotify.com has no Premium. Until then the catalogue uses Deezer.') : health.spotify.reason ? t(`На паузе (лимит запросов) до ${new Date(health.spotify.blockedUntil).toLocaleString()}. Каталог идёт через Deezer и сохранённые ответы Spotify.`, `Paused (rate limit) until ${new Date(health.spotify.blockedUntil).toLocaleString()}. Catalogue runs on Deezer and saved Spotify answers.`) : t('Доступен.', 'Available.')}</p>{health.spotify.usage && <><p className="adm-hint">{t(`За час: ${health.spotify.usage.lastHour} запросов к API, ${health.spotify.usage.cacheHitsLastHour} ответов из кэша · лимит ${health.spotify.usage.windowLimit} за ${health.spotify.usage.windowSeconds} с`, `Last hour: ${health.spotify.usage.lastHour} API calls, ${health.spotify.usage.cacheHitsLastHour} cache hits · limit ${health.spotify.usage.windowLimit} per ${health.spotify.usage.windowSeconds}s`)}</p>{health.spotify.usage.byEndpoint.length > 0 && <ul className="adm-hint">{health.spotify.usage.byEndpoint.map(e => <li key={e.endpoint}><code>{e.endpoint}</code> — {e.count}</li>)}</ul>}</>}</article>}
      <article className="adm-tile"><h3>{t('Кэши', 'Caches')}</h3><ul className="adm-caches">{health.caches.map(c => <li key={c.kind}><span><b>{CACHE_LABEL[c.kind] || c.kind}</b><small>{c.rows} {t('записей', 'entries')}</small></span><button className="sg-btn" disabled={busy || !c.rows} onClick={() => void clear(c.kind)}><Eraser size={14} />{t('Очистить', 'Clear')}</button></li>)}
        <li><span><b>{t('Кэш дашборда', 'Dashboard cache')}</b><small>{t('пересчитать статистику сейчас', 'recompute statistics now')}</small></span><button className="sg-btn" disabled={busy} onClick={() => void clear('dashboard')}><RefreshCw size={14} />{t('Сбросить', 'Reset')}</button></li></ul></article>
    </>}
    <article className="adm-tile"><h3>{t('Журнал действий', 'Audit log')}</h3>{log.length ? <table className="adm-table"><thead><tr><th>{t('Когда', 'When')}</th><th>{t('Действие', 'Action')}</th><th>{t('Объект', 'Target')}</th><th>{t('Детали', 'Details')}</th></tr></thead><tbody>{log.map(r => <tr key={r.id}><td>{new Date(r.createdAt).toLocaleString()}</td><td><code>{r.action}</code></td><td><code>{r.target || '—'}</code></td><td className="adm-ellipsis">{r.details}</td></tr>)}</tbody></table> : <p className="adm-empty">{t('Пока пусто.', 'Nothing yet.')}</p>}</article>
  </section>;
}
