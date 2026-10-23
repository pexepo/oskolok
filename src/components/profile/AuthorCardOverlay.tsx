import React, { useEffect, useId, useRef, useState } from 'react';
import {ProfileStatus,SocialLinks,accentStyle,type Customization} from './ProfileCustomization.js';
import {RoleBadges,topRoleColor,type PublicRole} from './RoleBadge.js';
import type {PublicRewards} from './Rewards.js';
import { createPortal } from 'react-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, Check, Copy, ExternalLink, FileText, Headphones, Heart, Music2, Send, UserRound, Users, X } from 'lucide-react';
import { apiClient } from '../../api/apiClient.js';
import { useAuthorCardStore, type AuthorCardPreview } from '../../stores/useAuthorCardStore.js';
import { useLanguageStore, useTranslation } from '../../stores/useLanguageStore.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import type { Track } from '../../types/index.js';
import LumaSpin from '../ui/luma-spin.js';
import { AuthorAvatar } from './AuthorCard.js';
import './author-card.css';

type AuthorLyric = { id: string; trackId: string; trackTitle: string; artistName: string; updatedAt: string; roles?: string[] };
type AuthorSummary = {
  userId: string; username: string | null; displayName: string; avatarUrl: string; bannerUrl?: string; bio: string;
  textsCount: number; musicCount: number; externalSource?: string; externalUrl?: string; joinedAt?: string; telegramUrl?: string;
  currentTrack?: { id: string; title: string; artistName: string; artworkUrl: string } | null; latestLyrics?: AuthorLyric | null;
  stats?: { plays: number; listeners: number; likes: number } | null;
  customization?: Customization; roles?: PublicRole[]; rewards?: PublicRewards;
};
type LyricsPage = { items: AuthorLyric[]; total: number; offset: number; limit: number; hasMore: boolean };
type Tab = 'lyrics' | 'music';

const PAGE = 30, PREVIEW = 6;
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]';
const enc = encodeURIComponent;
const inMiniApp = () => !!(window as any).Telegram?.WebApp?.initData;

/** Mounted once (Layout). Portalled to <body> so no player transform/overflow/containment can clip it. */
export function AuthorCardOverlay() {
  const author = useAuthorCardStore(s => s.author), close = useAuthorCardStore(s => s.close);
  const { pathname } = useLocation(), first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } close(); }, [pathname, close]);
  return createPortal(<AnimatePresence>{author && <AuthorCardDialog key={author.id} preview={author} onClose={close} />}</AnimatePresence>, document.body);
}

function AuthorCardDialog({ preview, onClose }: { preview: AuthorCardPreview; onClose: () => void }) {
  const t = useTranslation(), lang = useLanguageStore(s => s.language), navigate = useNavigate(), reduced = useReducedMotion();
  const titleId = useId(), rootRef = useRef<HTMLDivElement>(null), panelRef = useRef<HTMLDivElement>(null), closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [sheet] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  const [tab, setTab] = useState<Tab>('lyrics'), [expanded, setExpanded] = useState(false), [copied, setCopied] = useState(false);
  const id = preview.id;

  const summary = useQuery({ queryKey: ['author-summary', id], queryFn: () => apiClient.request<AuthorSummary>(`/users/${enc(id)}/summary`), staleTime: 30000 });
  const lyrics = useInfiniteQuery({
    queryKey: ['author-lyrics', id], initialPageParam: 0, staleTime: 30000,
    queryFn: ({ pageParam }) => apiClient.request<LyricsPage>(`/users/${enc(id)}/lyrics?offset=${pageParam}&limit=${PAGE}`),
    getNextPageParam: last => last.hasMore ? last.offset + last.items.length : undefined,
  });
  const music = useQuery({ queryKey: ['public-profile', id], queryFn: () => apiClient.request<{ music: Track[] }>(`/users/${enc(id)}`), enabled: tab === 'music' });

  // Escape/Tab are taken in the capture phase so the fullscreen player's own Escape handler never sees them;
  // every other key is stopped at the overlay root so global player hotkeys (Space, L, arrows) stay quiet.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, root = rootRef.current;
    const frame = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.getClientRects().length > 0);
      const firstEl = items[0], lastEl = items.at(-1), active = document.activeElement;
      if (!firstEl) { e.preventDefault(); panelRef.current.focus(); }
      else if (e.shiftKey && (active === firstEl || active === panelRef.current)) { e.preventDefault(); lastEl?.focus(); }
      else if (!e.shiftKey && (active === lastEl || !panelRef.current.contains(active))) { e.preventDefault(); firstEl.focus(); }
    };
    const swallow = (e: KeyboardEvent) => e.stopPropagation();
    document.addEventListener('keydown', onKey, true); root?.addEventListener('keydown', swallow);
    const html = document.documentElement, body = document.body, prev = [html.style.overflow, body.style.overflow];
    html.style.overflow = 'hidden'; body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame); document.removeEventListener('keydown', onKey, true); root?.removeEventListener('keydown', swallow);
      html.style.overflow = prev[0]; body.style.overflow = prev[1];
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const go = (path: string) => { onClose(); usePlayerStore.getState().setFullPlayerOpen(false); navigate(path); };
  const p = summary.data;
  const name = p?.displayName || preview.displayName || preview.credit || t('Автор текста', 'Lyrics author');
  const username = p ? p.username : preview.username;
  const avatar = p?.avatarUrl || preview.avatarUrl;
  const isSpicy = p?.externalSource === 'Spicy Lyrics' || id.startsWith('spicy:');
  const spicyUrl = p?.externalUrl || (/^spicy:\d{5,30}$/.test(id) ? `https://spicylyrics.org/uid/${id.slice(6)}` : undefined);
  const total = lyrics.data?.pages[0]?.total ?? p?.textsCount;
  const rows = lyrics.data?.pages.flatMap(pg => pg.items) ?? [];
  const shown = expanded ? rows : rows.slice(0, PREVIEW);
  const num = (n: number) => n.toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU');
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  const ago = (iso: string) => {
    const s = (new Date(iso).getTime() - Date.now()) / 1000, rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]] as const) if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
    return t('только что', 'just now');
  };
  const role = (r: string) => r === 'maker' ? t('разметил', 'timed') : r === 'uploader' ? t('загрузил', 'uploaded') : r;
  const openTelegram = (e: React.MouseEvent) => { if (p?.telegramUrl && inMiniApp()) { e.preventDefault(); (window as any).Telegram.WebApp.openTelegramLink(p.telegramUrl); } };
  const copyTelegram = async () => { if (!p?.telegramUrl) return; try { await navigator.clipboard.writeText(p.telegramUrl); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard denied: nothing to report */ } };

  const stats: Array<[React.ReactNode, string, string]> = p ? [
    [<FileText size={20} />, num(p.textsCount), t('Текстов в Осколке', 'Lyrics on Oskolok')],
    ...(p.stats ? [
      [<Headphones size={20} />, num(p.stats.plays), t('Прослушиваний треков с текстами автора', 'Plays of tracks with these lyrics')],
      [<Users size={20} />, num(p.stats.listeners), t('Слушателей этих текстов', 'Listeners of these lyrics')],
      [<Heart size={20} />, num(p.stats.likes), t('Добавлений этих треков в любимое', 'Likes on these tracks')],
    ] as Array<[React.ReactNode, string, string]> : []),
    ...(p.musicCount > 0 ? [[<Music2 size={20} />, num(p.musicCount), t('Треков на витрине', 'Showcase tracks')]] as Array<[React.ReactNode, string, string]> : []),
    ...(p.joinedAt ? [[<CalendarDays size={20} />, date(p.joinedAt), t('В Осколке с', 'On Oskolok since')]] as Array<[React.ReactNode, string, string]> : []),
  ] : [];
  const activity = p && (p.currentTrack || p.latestLyrics);
  const tabs: Array<[Tab, React.ReactNode, string]> = [['lyrics', <FileText size={18} />, `${t('Тексты автора', 'Lyrics by author')}${total !== undefined ? ` · ${num(total)}` : ''}`]];
  if (p && p.musicCount > 0) tabs.push(['music', <Music2 size={18} />, `${t('Витрина', 'Showcase')} · ${num(p.musicCount)}`]);

  const fade = { opacity: 0 }, shown1 = { opacity: 1 };
  const enter = reduced ? fade : sheet ? { y: '100%' } : { opacity: 0, scale: .94, y: 12 };
  const settle = reduced ? shown1 : sheet ? { y: 0 } : { opacity: 1, scale: 1, y: 0 };

  return <div ref={rootRef} className={`ac-root${sheet ? ' ac-sheet' : ''}`}>
    <motion.div className="ac-backdrop" initial={fade} animate={shown1} exit={fade} transition={{ duration: .2 }} onClick={onClose} aria-hidden="true" />
    <motion.div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="ac-card" style={accentStyle(p?.customization)}
      initial={enter} animate={settle} exit={enter} transition={reduced ? { duration: .15 } : { type: 'spring', stiffness: 420, damping: 36, mass: .9 }}>
      <div className="ac-banner">
        {p?.bannerUrl ? <img src={p.bannerUrl} alt="" /> : avatar ? <img className="ac-banner-blur" src={avatar} alt="" /> : null}
        <button type="button" className="ac-close" onClick={onClose} aria-label={t('Закрыть', 'Close')}><X size={20} /></button>
      </div>
      <div className="ac-body">
        <div className="ac-head">
          <div className="ac-avatar-wrap">
            <AuthorAvatar src={avatar} name={name} className="ac-avatar" />
            <span className="ac-badges">
              {p?.currentTrack && <span className="ac-badge ac-badge-live" title={t('Сейчас слушает', 'Listening now')}><Headphones size={13} /></span>}
              {isSpicy ? <span className="ac-badge ac-badge-spicy" title="Spicy Lyrics">S</span> : (p?.textsCount ?? 0) > 0 && <span className="ac-badge ac-badge-author" title={t('Автор текстов', 'Lyrics author')}><FileText size={12} /></span>}
            </span>
          </div>
          <div className="ac-actions">
            {!isSpicy && <button type="button" className="ac-primary" onClick={() => go(`/users/${enc(id)}`)}><UserRound size={17} />{t('Открыть профиль', 'Open profile')}</button>}
            {isSpicy && <><button type="button" className="ac-secondary" onClick={() => go(`/users/${enc(id)}`)}>{t('Открыть профиль', 'Open profile')}</button>{spicyUrl && <a className="ac-primary" href={spicyUrl} target="_blank" rel="noopener noreferrer">Spicy Lyrics<ExternalLink size={15} /></a>}</>}
          </div>
        </div>
        <h2 id={titleId} className="ac-name" style={{ color: topRoleColor(p?.roles) }}>{name} <RoleBadges roles={p?.roles} /></h2>
        <ProfileStatus c={p?.customization} />
        <div className="ac-status">
          <span>{username ? `@${username}` : isSpicy ? t('автор Spicy Lyrics', 'Spicy Lyrics author') : preview.label || t('автор текста', 'lyrics author')}</span>
          {p?.bio && <><span aria-hidden="true">→</span><span className="ac-status-chip">{p.bio}</span></>}
        </div>

        <div className="ac-tabs" role="tablist" aria-label={t('Разделы автора', 'Author sections')} data-count={tabs.length}>
          {tabs.map(([key, icon, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className="ac-tab" onClick={() => setTab(key)}>{icon}<span>{label}</span></button>)}
        </div>

        <div className="ac-panel" role="tabpanel">
          {tab === 'lyrics' ? lyrics.isPending ? <p className="ac-muted" role="status"><LumaSpin size="sm" label={t('Загружаем тексты', 'Loading lyrics')} />{t('Загружаем тексты…', 'Loading lyrics…')}</p>
            : lyrics.isError ? <p className="ac-muted" role="alert">{t('Не удалось загрузить тексты.', 'Could not load lyrics.')} <button type="button" className="ac-link" onClick={() => void lyrics.refetch()}>{t('Повторить', 'Retry')}</button></p>
            : !rows.length ? <p className="ac-muted">{t('Пока нет опубликованных текстов.', 'No published lyrics yet.')}</p>
            : <>
              <ul className={`ac-list${expanded ? ' ac-list-all' : ''}`}>{shown.map(row => <li key={row.trackId}><button type="button" onClick={() => go(`/track/${enc(row.trackId)}`)}>
                <FileText size={15} /><span className="ac-list-title"><strong>{row.trackTitle}</strong><small>{row.artistName}</small></span>
                {row.roles?.length ? <em>{row.roles.map(role).join(' · ')}</em> : <time dateTime={row.updatedAt}>{date(row.updatedAt)}</time>}
              </button></li>)}</ul>
              {!expanded && rows.length > PREVIEW || !expanded && lyrics.hasNextPage ? <button type="button" className="ac-more" onClick={() => setExpanded(true)}>{t('Показать все', 'Show all')}{total !== undefined ? ` (${num(total)})` : ''}</button>
                : expanded && lyrics.hasNextPage ? <button type="button" className="ac-more" disabled={lyrics.isFetchingNextPage} onClick={() => void lyrics.fetchNextPage()}>{lyrics.isFetchingNextPage ? t('Загружаем…', 'Loading…') : t(`Загрузить ещё · ${num(rows.length)} из ${num(total ?? rows.length)}`, `Load more · ${num(rows.length)} of ${num(total ?? rows.length)}`)}</button> : null}
            </>
          : music.isPending ? <p className="ac-muted" role="status"><LumaSpin size="sm" label={t('Загружаем витрину', 'Loading showcase')} />{t('Загружаем витрину…', 'Loading showcase…')}</p>
            : music.isError ? <p className="ac-muted" role="alert">{t('Не удалось загрузить витрину.', 'Could not load the showcase.')} <button type="button" className="ac-link" onClick={() => void music.refetch()}>{t('Повторить', 'Retry')}</button></p>
            : <ul className="ac-list ac-list-all">{(music.data?.music ?? []).map(track => <li key={track.id}><button type="button" onClick={() => go(`/track/${enc(track.id)}`)}>
              {track.artworkUrl ? <img src={track.artworkUrl} alt="" className="ac-art" loading="lazy" /> : <Music2 size={15} />}<span className="ac-list-title"><strong>{track.title}</strong><small>{track.artist?.name}</small></span>
            </button></li>)}</ul>}
        </div>

        {summary.isPending && <p className="ac-muted" role="status"><LumaSpin size="sm" label={t('Открываем профиль', 'Opening profile')} />{t('Открываем профиль…', 'Opening profile…')}</p>}
        {summary.isError && <p className="ac-muted" role="alert">{summary.error instanceof Error ? summary.error.message : t('Не удалось загрузить профиль.', 'Could not load the profile.')} <button type="button" className="ac-link" onClick={() => void summary.refetch()}>{t('Повторить', 'Retry')}</button></p>}

        {activity && <section className="ac-section"><h3>{t('Активность', 'Activity')}</h3>
          {p!.currentTrack && <p className="ac-activity"><span className="ac-live-dot" aria-hidden="true" />{t('Слушает', 'Listening to')} <button type="button" className="ac-link" onClick={() => go(`/track/${enc(p!.currentTrack!.id)}`)}>{p!.currentTrack.artistName} — {p!.currentTrack.title}</button></p>}
          {p!.latestLyrics && <p className="ac-activity">{isSpicy ? t('Последний текст в каталоге:', 'Latest lyrics in catalogue:') : t('Опубликовал(а) текст', 'Published lyrics for')} <button type="button" className="ac-link" onClick={() => go(`/track/${enc(p!.latestLyrics!.trackId)}`)}>{p!.latestLyrics.artistName} — {p!.latestLyrics.trackTitle}</button>, {ago(p!.latestLyrics.updatedAt)}</p>}
        </section>}

        {stats.length > 0 && <section className="ac-section"><h3>{t('Статистика', 'Statistics')}</h3>
          <ul className="ac-stats">{stats.map(([icon, value, label]) => <li key={label} title={label}>{icon}<strong>{value}</strong><span className="sr-only">{label}</span></li>)}</ul>
        </section>}
      </div>
      {!!p?.customization?.socialLinks.length && <SocialLinks links={p.customization.socialLinks} className="ac-socials" />}
      {(p?.telegramUrl || (isSpicy && spicyUrl)) && <div className="ac-contacts">
        {p?.telegramUrl && <div className="ac-contact ac-contact-tg"><a href={p.telegramUrl} target="_blank" rel="noopener noreferrer" onClick={openTelegram}><Send size={20} /><span>{t('Открыть чат в Telegram', 'Open Telegram chat')}</span></a>
          <button type="button" onClick={() => void copyTelegram()} aria-label={copied ? t('Ссылка скопирована', 'Link copied') : t('Скопировать ссылку', 'Copy link')}>{copied ? <Check size={18} /> : <Copy size={18} />}</button></div>}
        {isSpicy && spicyUrl && <div className="ac-contact ac-contact-spicy"><a href={spicyUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={19} /><span>{t('Профиль в Spicy Lyrics', 'Spicy Lyrics profile')}</span></a></div>}
      </div>}
    </motion.div>
  </div>;
}
