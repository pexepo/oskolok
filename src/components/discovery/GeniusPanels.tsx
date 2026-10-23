import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ChevronDown, Eye, Disc3, ListMusic, type LucideIcon } from 'lucide-react';
import { apiClient } from '../../api/apiClient.js';
import type { GeniusArtist } from '../../types/index.js';
import { useLanguageStore, useTranslation } from '../../stores/useLanguageStore.js';
import { PlayerIcon } from '../player/PlayerIcon.js';

type T = (ru: string, en: string) => string;

function useFormat() {
  const language = useLanguageStore(s => s.language), locale = language === 'en' ? 'en-US' : 'ru-RU';
  return React.useMemo(() => {
    const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    const full = new Intl.NumberFormat(locale);
    return {
      num: (n?: number) => n === undefined ? '—' : n >= 10000 ? compact.format(n) : full.format(n),
      /** "2025-11-28" → "28 ноября 2025"; partial dates stay partial. */
      date: (date?: string) => {
        if (!date) return undefined;
        const [y, m, d] = date.split('-').map(Number);
        if (!m) return String(y);
        return new Date(y, m - 1, d || 1).toLocaleDateString(locale, d ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' });
      },
    };
  }, [locale]);
}

function Stat({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return <div className="genius-stat"><Icon size={15} /><strong>{value}</strong><small>{label}</small></div>;
}

/** Always starts collapsed (one slim row with the key numbers); the choice is
 * deliberately not remembered between pages. */
function GeniusShell({ title, subtitle, link, linkLabel = 'Genius', summary = [], className = '', children }: {
  title: string; subtitle?: React.ReactNode; link?: string; linkLabel?: string;
  summary?: Array<{ icon: LucideIcon; value: string; label: string }>; className?: string; children: React.ReactNode;
}) {
  const t = useTranslation(), [open, setOpen] = React.useState(false), bodyId = React.useId();
  return <section className={`genius-panel sg-glass ${className}`} data-open={open} aria-label={title}>
    <div className="genius-head">
      <button type="button" className="genius-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(v => !v)}>
        <PlayerIcon name="info" size={38} className="genius-info-icon" />
        <span className="genius-title"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
        {summary.length > 0 && <span className="genius-summary" aria-hidden={open}>
          {summary.map(item => <span key={item.label} title={item.label}><item.icon size={13} />{item.value}</span>)}
        </span>}
        <span className="genius-chevron"><span>{open ? t('Свернуть', 'Collapse') : t('Подробнее', 'Details')}</span><ChevronDown size={16} /></span>
      </button>
      {link && <a className="genius-link" href={link} target="_blank" rel="noreferrer">{linkLabel} <ArrowUpRight size={14} /></a>}
    </div>
    <div className="genius-body" id={bodyId} {...(open ? {} : { inert: "" } as Record<string, string>)}>
      <div className="genius-body-inner">{children}</div>
    </div>
  </section>;
}

/** Song or track list with a relative pageview bar. */
function ViewsList({ items, num }: { items: Array<{ key: string | number; title: string; url: string; views?: number; meta?: string }>; num: (n?: number) => string }) {
  const max = Math.max(1, ...items.map(i => i.views || 0));
  return <ol className="genius-views">
    {items.map((item, i) => <li key={item.key}>
      <a href={item.url} target="_blank" rel="noreferrer">
        <span className="genius-views-num">{i + 1}</span>
        <span className="genius-views-copy"><strong>{item.title}</strong>{item.meta && <small>{item.meta}</small>}</span>
        <span className="genius-views-count">{num(item.views)}</span>
        <i className="genius-views-bar" style={{ '--share': `${((item.views || 0) / max) * 100}%` } as React.CSSProperties} />
      </a>
    </li>)}
  </ol>;
}

/** «Об исполнителе»: the Genius biography (or the profile's own description), socials and attribution. Collapsed like «О релизе». */
export function GeniusArtistSection({ genius, fallback }: { genius?: GeniusArtist; fallback?: string }) {
  const t: T = useTranslation();
  const text = genius?.description || fallback;
  const socials = genius ? [
    genius.socials.instagram && { label: 'Instagram', url: `https://instagram.com/${genius.socials.instagram}` },
    genius.socials.twitter && { label: 'X', url: `https://x.com/${genius.socials.twitter}` },
    genius.socials.facebook && { label: 'Facebook', url: `https://facebook.com/${genius.socials.facebook}` },
  ].filter(Boolean) as Array<{ label: string; url: string }> : [];
  if (!text && !socials.length) return null;
  return <GeniusShell className="genius-panel--about" title={t('Об исполнителе', 'About the artist')} subtitle={genius?.name} link={genius?.url}>
    <div className="genius-about">
      {text && <p>{text}</p>}
      {socials.length > 0 && <div className="genius-socials">{socials.map(s => <a key={s.label} href={s.url} target="_blank" rel="noreferrer">{s.label} <ArrowUpRight size={12} /></a>)}</div>}
      {genius?.description && <p className="genius-credit">{t('Информация предоставлена сервисом Genius', 'Information provided by Genius')}</p>}
    </div>
  </GeniusShell>;
}

/** Genius notes for one release: blurb, pageviews, the most-read tracks, credits. */
export function GeniusReleaseSection({ artist, title }: { artist?: string; title: string }) {
  const t: T = useTranslation(), { num, date } = useFormat();
  const query = useQuery({
    queryKey: ['genius-release', artist, title],
    queryFn: () => apiClient.getGeniusRelease(artist!, title),
    enabled: Boolean(artist && title),
    staleTime: 6 * 60 * 60 * 1000,
  });
  const r = query.data;
  if (!r) return null;
  const tracks = [...r.tracks].filter(x => x.views !== undefined).sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5);
  const stats = [
    { icon: Eye, value: num(r.views), label: t('просмотров текстов', 'lyric views') },
    { icon: ListMusic, value: num(r.trackCount), label: t('треков на Genius', 'tracks on Genius') },
    { icon: Disc3, value: date(r.date) || '—', label: t('дата выхода', 'release date') },
  ];
  return <GeniusShell className="genius-panel--release" title={t('О релизе', 'About the release')} subtitle={r.name} link={r.url} linkLabel="Genius" summary={stats.slice(0, 2)}>
    <div className="genius-stats">{stats.map(s => <Stat key={s.label} {...s} />)}</div>
    <div className="genius-grid genius-grid--two">
      <div className="genius-about">
        <h3>{t('Описание', 'Description')}</h3>
        <p>{r.description || t('Описания на Genius пока нет.', 'No description on Genius yet.')}</p>
        {r.description && <p className="genius-credit">{t('Информация предоставлена сервисом Genius', 'Information provided by Genius')}</p>}
        {r.credits.length > 0 && <dl className="genius-credits">{r.credits.map(c => <React.Fragment key={c.role}><dt>{c.role}</dt><dd>{c.names.join(', ')}</dd></React.Fragment>)}</dl>}
      </div>
      <div>
        <h3>{t('Самые читаемые тексты', 'Most-read lyrics')}</h3>
        {tracks.length ? <ViewsList num={num} items={tracks.map(x => ({ key: `${x.number}:${x.title}`, title: x.title, url: x.url, views: x.views, meta: x.number ? t(`трек ${x.number}`, `track ${x.number}`) : undefined }))} /> : <p className="genius-empty">{t('Нет данных.', 'No data.')}</p>}
      </div>
    </div>
  </GeniusShell>;
}
