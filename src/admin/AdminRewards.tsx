import React from 'react';
import type { CSSProperties } from 'react';
import { Award, Medal, RefreshCw, Search, Trash2, UserPlus } from 'lucide-react';
import { useLanguageStore, useTranslation } from '../stores/useLanguageStore.js';
import LumaSpin from '../components/ui/luma-spin.js';
import { REWARD_ICONS, TIER_COLOR, pick, tierLabel, type Text, type Tier } from '../components/profile/Rewards.js';

/* Developer panel → «Награды»: medal catalogue, holders, award/revoke with a note; plus a per-user section for the users drawer. */

type Request = (path: string, options?: RequestInit) => Promise<any>;
type MedalDef = { id: string; title: Text; description: Text; icon: string; color: string; auto: { hint: Text } | null; holders: number };
type AchievementDef = { id: string; title: Text; description: Text; icon: string; unit: Text; thresholds: number[] };
type Holder = { id: string; name: string; username: string | null; avatarUrl: string | null; note: string; awardedBy: string; awardedAt: string };
type UserRewards = { medals: Array<{ medalId: string; note: string; awardedBy: string; awardedAt: string; revokedAt: string | null }>; achievements: Array<{ id: string; title: Text; icon: string; tier: Tier; unlockedAt: string }> };
type UserHit = { id: string; name: string; username: string | null; avatarUrl: string | null };

const send = (request: Request, path: string, body: unknown, method = 'POST') => request(path, { method, body: JSON.stringify(body) });
const enc = encodeURIComponent;
function Avatar({ src, name }: { src?: string | null; name: string }) {
  return src ? <img className="adm-avatar" src={src} alt="" /> : <span className="adm-avatar adm-avatar--empty" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}
function MedalIcon({ m, size = 16 }: { m: { icon: string; color: string }; size?: number }) {
  const Icon = REWARD_ICONS[m.icon] || Medal;
  return <span className="medal-chip" style={{ '--medal': m.color, width: size + 12, height: size + 12 } as CSSProperties} aria-hidden="true"><Icon size={size - 2} /></span>;
}

export function AdminRewardsTab({ request }: { request: Request }) {
  const t = useTranslation(), lang = useLanguageStore(s => s.language);
  const [catalog, setCatalog] = React.useState<{ medals: MedalDef[]; achievements: AchievementDef[] } | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null), [holders, setHolders] = React.useState<Holder[]>([]);
  const [q, setQ] = React.useState(''), [hits, setHits] = React.useState<UserHit[]>([]), [note, setNote] = React.useState('');
  const [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const c = await request('/rewards'); setCatalog(c); return c as { medals: MedalDef[] }; }, [request]);
  React.useEffect(() => { void load().then(c => setSelected(s => s ?? c.medals[0]?.id ?? null)).catch(e => setError((e as Error).message)); }, [load]);
  React.useEffect(() => { if (!selected) return; request(`/rewards/medals/${enc(selected)}/holders`).then(setHolders).catch(() => setHolders([])); }, [selected, request]);
  React.useEffect(() => { let live = true; const id = setTimeout(() => { if (!q.trim()) { setHits([]); return; } request(`/users?q=${enc(q)}`).then(r => { if (live) setHits(r); }).catch(() => {}); }, 250); return () => { live = false; clearTimeout(id); }; }, [q, request]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const refresh = async () => { if (selected) setHolders(await request(`/rewards/medals/${enc(selected)}/holders`)); await load(); };
  const award = (u: UserHit) => run(async () => { if (!selected) return; await send(request, `/users/${enc(u.id)}/medals`, { medalId: selected, note }); setQ(''); setNote(''); await refresh(); });
  const revoke = (h: Holder) => run(async () => { if (!selected || !confirm(t(`Снять медаль с ${h.name}?`, `Revoke this medal from ${h.name}?`))) return; await request(`/users/${enc(h.id)}/medals/${enc(selected)}`, { method: 'DELETE' }); await refresh(); });

  if (!catalog) return error ? <p className="adm-error" role="alert">{error}</p> : <div className="adm-dash-loading"><LumaSpin size="md" /></div>;
  const medal = catalog.medals.find(m => m.id === selected);
  const holderIds = new Set(holders.map(h => h.id));
  return <>
    <section className="adm-roles">
      <aside className="adm-roles-list">
        <header><h3>{t('Медали', 'Medals')}</h3></header>
        <p className="adm-hint">{t('Медали с правилом выдаются автоматически; любую можно выдать или снять вручную. Снятая вручную авто-медаль повторно не выдаётся.', 'Rule-based medals are granted automatically; any medal can be awarded or revoked by hand. A revoked auto medal is not re-granted.')}</p>
        <ol>{catalog.medals.map(m => <li key={m.id} className={m.id === selected ? 'is-active' : ''}><button className="adm-role-row" onClick={() => setSelected(m.id)}><i style={{ background: m.color }} /><span>{pick(m.title, lang)}</span><small>{m.holders}</small></button></li>)}</ol>
      </aside>
      {medal ? <div className="adm-role-edit">
        <div className="adm-role-preview"><MedalIcon m={medal} size={20} /><span className="adm-role-name" style={{ color: medal.color }}>{pick(medal.title, lang)}</span></div>
        <p className="adm-hint">{pick(medal.description, lang)}{medal.auto ? ` · ${t('авто', 'auto')}: ${pick(medal.auto.hint, lang)}` : ` · ${t('только вручную', 'manual only')}`}</p>
        <h3 className="adm-sub">{t('Выдать', 'Award')}</h3>
        <div className="adm-form">
          <label>{t('Комментарий (за что — виден в подсказке)', 'Note (what for — shown in the tooltip)')}<input value={note} maxLength={200} onChange={e => setNote(e.target.value)} placeholder={t('например: за разбор бага с плеером', 'e.g. for triaging the player bug')} /></label>
        </div>
        <div className="adm-picker">
          <label className="adm-search"><Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Найти пользователя: имя, @ник или id', 'Find a user: name, @handle or id')} /></label>
          {hits.length > 0 && <ul>{hits.filter(h => !holderIds.has(h.id)).slice(0, 8).map(h => <li key={h.id}><button disabled={busy} onClick={() => void award(h)}><Avatar src={h.avatarUrl} name={h.name} /><span><b>{h.name}</b><small>{h.username ? `@${h.username}` : h.id}</small></span><UserPlus size={15} /></button></li>)}</ul>}
        </div>
        <h3 className="adm-sub">{t('Владельцы', 'Holders')} · {holders.length}</h3>
        {holders.length ? <ul className="adm-members">{holders.map(h => <li key={h.id}><Avatar src={h.avatarUrl} name={h.name} /><span><b>{h.name}</b><small>{h.username ? `@${h.username}` : h.id} · {h.awardedBy === 'auto' ? t('авто', 'auto') : t('вручную', 'manual')} · {new Date(h.awardedAt).toLocaleDateString()}{h.note ? ` · «${h.note}»` : ''}</small></span><button className="adm-icon" disabled={busy} onClick={() => void revoke(h)} aria-label={t('Снять медаль', 'Revoke medal')}><Trash2 size={15} /></button></li>)}</ul> : <p className="adm-empty">{t('Пока ни у кого нет.', 'Nobody has it yet.')}</p>}
        {error && <p className="adm-error" role="alert">{error}</p>}
      </div> : <p className="adm-empty">{t('Выберите медаль слева.', 'Pick a medal on the left.')}</p>}
    </section>
    <article className="adm-tile"><h3>{t('Достижения (автоматические)', 'Achievements (automatic)')}</h3>
      <table className="adm-table"><thead><tr><th>{t('Достижение', 'Achievement')}</th><th>{t('Условие', 'Condition')}</th>{(['bronze', 'silver', 'gold'] as Tier[]).map(x => <th key={x} style={{ color: TIER_COLOR[x] }}>{tierLabel(x, lang)}</th>)}</tr></thead>
        <tbody>{catalog.achievements.map(a => { const Icon = REWARD_ICONS[a.icon] || Award; return <tr key={a.id}><td><span className="adm-user"><Icon size={15} /><b>{pick(a.title, lang)}</b></span></td><td>{pick(a.description, lang)}</td>{a.thresholds.length === 1 ? <><td>—</td><td>—</td><td>{a.thresholds[0]} {pick(a.unit, lang)}</td></> : [0, 1, 2].map(i => <td key={i}>{a.thresholds[i] != null ? `${a.thresholds[i]} ${pick(a.unit, lang)}` : '—'}</td>)}</tr>; })}</tbody></table>
    </article>
  </>;
}

/** Medals and top achievements of one user, for the users drawer. */
export function UserRewardsSection({ request, userId }: { request: Request; userId: string }) {
  const t = useTranslation(), lang = useLanguageStore(s => s.language);
  const [data, setData] = React.useState<UserRewards | null>(null), [catalog, setCatalog] = React.useState<MedalDef[]>([]), [note, setNote] = React.useState(''), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  React.useEffect(() => { setData(null); request(`/users/${enc(userId)}/rewards`).then(setData).catch(e => setError((e as Error).message)); request('/rewards').then(c => setCatalog(c.medals)).catch(() => {}); }, [userId, request]);
  const run = async (fn: () => Promise<UserRewards>) => { setBusy(true); setError(''); try { setData(await fn()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const active = new Map((data?.medals || []).filter(m => !m.revokedAt).map(m => [m.medalId, m]));
  const toggle = (m: MedalDef) => run(() => active.has(m.id) ? request(`/users/${enc(userId)}/medals/${enc(m.id)}`, { method: 'DELETE' }) : send(request, `/users/${enc(userId)}/medals`, { medalId: m.id, note }));
  return <>
    <h4>{t('Медали', 'Medals')}</h4>
    <label className="adm-search adm-search--wide"><Award size={15} /><input value={note} maxLength={200} onChange={e => setNote(e.target.value)} placeholder={t('Комментарий к выдаче (необязательно)', 'Award note (optional)')} /></label>
    <div className="adm-role-toggles">{catalog.map(m => { const has = active.get(m.id); return <button key={m.id} aria-pressed={!!has} className={has ? 'is-on' : ''} disabled={busy || !data} title={has?.note || pick(m.description, lang)} onClick={() => void toggle(m)}><span className="role-badge" style={{ '--role': m.color } as CSSProperties}><MedalIcon m={m} size={10} />{pick(m.title, lang)}{has?.awardedBy === 'auto' ? ' · auto' : ''}</span></button>; })}</div>
    <h4>{t('Достижения', 'Achievements')} <button className="adm-icon" disabled={busy} onClick={() => void run(() => send(request, `/users/${enc(userId)}/rewards/recompute`, {}))} aria-label={t('Пересчитать', 'Recompute')} title={t('Пересчитать сейчас', 'Recompute now')}><RefreshCw size={13} /></button></h4>
    {!data ? <LumaSpin size="sm" /> : data.achievements.length ? <ul className="ach-strip">{data.achievements.map(a => { const Icon = REWARD_ICONS[a.icon] || Award; return <li key={a.id} style={{ '--tier': TIER_COLOR[a.tier] } as CSSProperties} title={tierLabel(a.tier, lang)}><Icon size={13} />{pick(a.title, lang)}</li>; })}</ul> : <p className="adm-empty">{t('Пока нет открытых достижений.', 'No achievements yet.')}</p>}
    {error && <p className="adm-error" role="alert">{error}</p>}
  </>;
}
