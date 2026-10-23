import React from 'react';
import type { CSSProperties } from 'react';
import { Library, Headphones, Play, Flame, Users, Repeat, Moon, Compass, Heart, ListMusic, PenLine, Flag, CalendarHeart, HandHeart, Bug, Timer, Medal, Wrench, Megaphone, Gem, Crown, Trophy, Lock, type LucideIcon } from 'lucide-react';
import { apiClient } from '../../api/apiClient.js';
import { useLanguageStore, useTranslation } from '../../stores/useLanguageStore.js';
import { LoadingState } from '../common/LoadingState.js';
import '../../styles/rewards.css';

/* Rewards UI: medals row next to a name, achievement grid for the own profile. Data: GET /api/profile/achievements. */

export type Text = { ru: string; en: string };
export type Tier = 'bronze' | 'silver' | 'gold';
export type MedalView = { id: string; title: Text; description: Text; icon: string; color: string; note?: string; awardedBy?: 'admin' | 'auto'; awardedAt?: string };
export type AchievementBadge = { id: string; title: Text; icon: string; tier: Tier; unlockedAt: string };
export type PublicRewards = { medals: MedalView[]; achievements: AchievementBadge[]; achievementsUnlocked: number };
type Achievement = { id: string; title: Text; description: Text; icon: string; unit: Text; value: number; tier: Tier | null; tiersReached: number; tiers: Array<{ tier: Tier; threshold: number; reached: boolean; unlockedAt: string | null }>; next: number | null; progress: number; maxed: boolean };
type MedalCatalogItem = { id: string; title: Text; description: Text; icon: string; color: string; hint: Text | null };
export type OwnRewards = { achievements: Achievement[]; medals: MedalView[]; medalCatalog: MedalCatalogItem[]; summary: { unlocked: number; total: number; gold: number; listeningMinutes: number; currentStreak: number }; unseen: Array<{ kind: 'achievement' | 'medal'; id: string; title: Text; tier?: Tier | null }> };

export const REWARD_ICONS: Record<string, LucideIcon> = {
  library: Library, headphones: Headphones, play: Play, flame: Flame, users: Users, repeat: Repeat, moon: Moon, compass: Compass, heart: Heart,
  'list-music': ListMusic, 'pen-line': PenLine, flag: Flag, 'calendar-heart': CalendarHeart, 'hand-heart': HandHeart, bug: Bug, timer: Timer,
  medal: Medal, wrench: Wrench, megaphone: Megaphone, gem: Gem, crown: Crown,
};
export const TIER_COLOR: Record<Tier, string> = { bronze: '#c98a55', silver: '#a9b8cc', gold: '#f2c14e' };
export const tierLabel = (tier: Tier, lang: string) => ({ bronze: ['бронза', 'bronze'], silver: ['серебро', 'silver'], gold: ['золото', 'gold'] } as const)[tier][lang === 'en' ? 1 : 0];
const useLang = () => useLanguageStore(s => s.language);
export const pick = (text: Text, lang: string) => lang === 'en' ? text.en : text.ru;
const nf = (n: number) => new Intl.NumberFormat().format(n);

/** Small round medal icons with a native tooltip (title + note). */
export function MedalRow({ medals, max = 6, size = 'md' }: { medals?: MedalView[]; max?: number; size?: 'sm' | 'md' }) {
  const lang = useLang(), t = useTranslation();
  if (!medals?.length) return null;
  const shown = medals.slice(0, max), rest = medals.length - shown.length;
  return <span className={`medal-row medal-row--${size}`} role="list" aria-label={t('Медали', 'Medals')}>
    {shown.map(m => { const Icon = REWARD_ICONS[m.icon] || Medal, label = `${pick(m.title, lang)} — ${pick(m.description, lang)}${m.note ? ` · ${m.note}` : ''}`; return <span key={m.id} role="listitem" className="medal-chip" style={{ '--medal': m.color } as CSSProperties} title={label} aria-label={label} tabIndex={0}><Icon size={size === 'sm' ? 11 : 13} strokeWidth={2.3} aria-hidden="true" /></span>; })}
    {rest > 0 && <span className="medal-chip medal-chip--more" title={t(`Ещё ${rest}`, `${rest} more`)}>+{rest}</span>}
  </span>;
}

/** Compact strip of the best achievements (public profiles and the author card). */
export function AchievementStrip({ items, max = 6 }: { items?: AchievementBadge[]; max?: number }) {
  const lang = useLang(), t = useTranslation();
  if (!items?.length) return null;
  return <ul className="ach-strip" aria-label={t('Достижения', 'Achievements')}>{items.slice(0, max).map(a => { const Icon = REWARD_ICONS[a.icon] || Trophy; return <li key={a.id} style={{ '--tier': TIER_COLOR[a.tier] } as CSSProperties} title={`${pick(a.title, lang)} · ${tierLabel(a.tier, lang)}`}><Icon size={13} aria-hidden="true" /><span>{pick(a.title, lang)}</span></li>; })}</ul>;
}

function AchievementCard({ a }: { a: Achievement }) {
  const lang = useLang(), t = useTranslation(), Icon = REWARD_ICONS[a.icon] || Trophy, locked = !a.tier;
  const style = { '--tier': a.tier ? TIER_COLOR[a.tier] : 'var(--muted)', '--p': a.progress } as CSSProperties;
  const unlockedAt = [...a.tiers].reverse().find(x => x.unlockedAt)?.unlockedAt;
  return <article className={`ach-card${locked ? ' is-locked' : ''} ${a.tier ? `tier-${a.tier}` : ''}`} style={style} aria-label={`${pick(a.title, lang)}${a.tier ? ` · ${tierLabel(a.tier, lang)}` : ` · ${t('не открыто', 'locked')}`}`}>
    <header>
      <span className="ach-icon">{locked ? <Lock size={16} aria-hidden="true" /> : <Icon size={18} aria-hidden="true" />}</span>
      <span className="ach-titles"><b>{pick(a.title, lang)}</b><small>{pick(a.description, lang)}</small></span>
    </header>
    <div className="ach-pips" aria-hidden="true">{a.tiers.map(x => <i key={x.tier + x.threshold} className={x.reached ? 'is-on' : ''} style={{ '--pip': TIER_COLOR[x.tier] } as CSSProperties} title={`${tierLabel(x.tier, lang)}: ${nf(x.threshold)}`} />)}</div>
    <div className="ach-bar" role="progressbar" aria-valuemin={0} aria-valuemax={a.next ?? a.value} aria-valuenow={a.value}><span /></div>
    <footer>{a.maxed ? <span>{t('Максимум', 'Maxed')} · {nf(a.value)} {pick(a.unit, lang)}</span> : <span>{nf(a.value)} / {nf(a.next!)} {pick(a.unit, lang)}</span>}{a.tier && <em>{tierLabel(a.tier, lang)}</em>}</footer>
    {unlockedAt && <time dateTime={unlockedAt} className="sr-only">{new Date(unlockedAt).toLocaleDateString()}</time>}
  </article>;
}

/** «Награды» section of the own profile: summary, medals (earned and locked), achievement grid. */
export function RewardsPanel() {
  const t = useTranslation(), lang = useLang();
  const [data, setData] = React.useState<OwnRewards | null>(null), [error, setError] = React.useState('');
  const load = React.useCallback(() => apiClient.request<OwnRewards>('/profile/achievements').then(d => { setData(d); setError(''); if (d.unseen.length) void apiClient.request('/profile/achievements/seen', { method: 'POST', body: '{}' }).catch(() => {}); }).catch(e => setError((e as Error).message)), []);
  React.useEffect(() => { void load(); }, [load]);
  if (!data) return error ? <section className="crystal-slab profile-card"><p role="alert" className="profile-empty">{error}</p><button className="profile-btn" onClick={() => void load()}>{t('Повторить', 'Retry')}</button></section> : <LoadingState label={t('Считаем награды…', 'Counting rewards…')} />;
  const owned = new Set(data.medals.map(m => m.id));
  const hours = Math.floor(data.summary.listeningMinutes / 60);
  const sorted = [...data.achievements].sort((a, b) => (b.tiersReached ? 1 : 0) - (a.tiersReached ? 1 : 0) || b.progress - a.progress);
  return <div className="profile-stack rewards">
    <section className="crystal-slab profile-card">
      <dl className="rewards-summary">
        <div><dt>{t('Достижений открыто', 'Achievements unlocked')}</dt><dd>{data.summary.unlocked}<small>/{data.summary.total}</small></dd></div>
        <div><dt>{t('Золотых', 'Gold')}</dt><dd style={{ color: TIER_COLOR.gold }}>{data.summary.gold}</dd></div>
        <div><dt>{t('С музыкой', 'Listening')}</dt><dd>{hours ? t(`${nf(hours)} ч`, `${nf(hours)} h`) : t(`${data.summary.listeningMinutes} мин`, `${data.summary.listeningMinutes} min`)}</dd></div>
        <div><dt>{t('Серия', 'Streak')}</dt><dd>{data.summary.currentStreak}<small> {t('дн.', 'd')}</small></dd></div>
      </dl>
    </section>
    <section className="crystal-slab profile-card">
      <h2>{t('Медали', 'Medals')}</h2>
      <ul className="medal-grid">{data.medalCatalog.map(m => { const Icon = REWARD_ICONS[m.icon] || Medal, mine = data.medals.find(x => x.id === m.id); return <li key={m.id} className={owned.has(m.id) ? '' : 'is-locked'} style={{ '--medal': m.color } as CSSProperties}>
        <span className="medal-big">{owned.has(m.id) ? <Icon size={20} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}</span>
        <span><b>{pick(m.title, lang)}</b><small>{pick(m.description, lang)}</small>{mine ? <small className="medal-meta">{mine.note ? `«${mine.note}» · ` : ''}{mine.awardedAt ? new Date(mine.awardedAt).toLocaleDateString() : ''}</small> : <small className="medal-meta">{m.hint ? t(`Автоматически: ${m.hint.ru}`, `Automatic: ${m.hint.en}`) : t('Выдаёт команда Осколка', 'Awarded by the Oskolok team')}</small>}</span>
      </li>; })}</ul>
    </section>
    <section className="crystal-slab profile-card">
      <h2>{t('Достижения', 'Achievements')}</h2>
      <div className="ach-grid">{sorted.map(a => <AchievementCard key={a.id} a={a} />)}</div>
    </section>
  </div>;
}
