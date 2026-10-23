import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, Pause, RefreshCw, ExternalLink, ChevronUp, ChevronDown, Lock } from 'lucide-react';
import { apiClient } from '../../api/apiClient.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '../../stores/useLanguageStore.js';
import { ShardArtwork } from '../tracks/ShardArtwork.js';
import { formatTime } from '../../utils/formatters.js';
import LumaSpin from '../ui/luma-spin.js';
import type { Track } from '../../types/index.js';

type ChartService = 'vk' | 'yandex' | 'spotify';
interface ChartEntry { position: number; title: string; artist: string; artworkUrl?: string; duration?: number; shift?: number | null; track: Track | null }
interface ChartResult { service: ChartService; title: string; sourceUrl?: string; updatedAt: string; items: ChartEntry[]; unavailable?: string }

const SERVICES: Array<{ id: ChartService; ru: string; en: string }> = [
  { id: 'vk', ru: 'VK Музыка', en: 'VK Music' },
  { id: 'yandex', ru: 'Яндекс Музыка', en: 'Yandex Music' },
  { id: 'spotify', ru: 'Spotify', en: 'Spotify' },
];
const LIMIT = 20;

/** Becomes true once the element nears the viewport, then stays true. */
function useNearViewport<T extends Element>(margin = '320px') {
  const ref = React.useRef<T>(null);
  const [near, setNear] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (!('IntersectionObserver' in window)) { setNear(true); return; }
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin, near]);
  return [ref, near] as const;
}

function Shift({ value }: { value?: number | null }) {
  const t = useTranslation();
  if (value === undefined) return <span className="sg-chart-shift" aria-hidden="true" />;
  if (value === null) return <span className="sg-chart-shift is-new">{t('new', 'new')}</span>;
  if (!value) return <span className="sg-chart-shift" aria-label={t('Без изменений', 'No change')}>–</span>;
  return <span className={`sg-chart-shift ${value > 0 ? 'is-up' : 'is-down'}`} aria-label={value > 0 ? t(`Вверх на ${value}`, `Up ${value}`) : t(`Вниз на ${-value}`, `Down ${-value}`)}>
    {value > 0 ? <ChevronUp size={12} strokeWidth={2.6} /> : <ChevronDown size={12} strokeWidth={2.6} />}{Math.abs(value)}
  </span>;
}

function ChartList({ service, enabled }: { service: ChartService; enabled: boolean }) {
  const t = useTranslation();
  const { currentTrack, isPlaying, togglePlay, playCollection, playTrack } = usePlayerStore(useShallow(s => ({ currentTrack: s.currentTrack, isPlaying: s.isPlaying, togglePlay: s.togglePlay, playCollection: s.playCollection, playTrack: s.playTrack })));
  const [pending, setPending] = React.useState<number | null>(null);
  const [missing, setMissing] = React.useState<number | null>(null);
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['chart', service],
    queryFn: () => apiClient.request<ChartResult>(`/charts?service=${service}&limit=${LIMIT}`),
    enabled,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  const items = data?.items || [];
  const playable = React.useMemo(() => items.flatMap(e => e.track ? [e.track] : []), [items]);

  const play = async (i: number) => {
    const entry = items[i];
    setMissing(null);
    if (entry.track && currentTrack?.id === entry.track.id) { togglePlay(); return; }
    if (entry.track) { await playCollection(playable, playable.indexOf(entry.track)); return; }
    // Unmatched row: fall back to the regular catalogue search.
    setPending(i);
    try {
      const result = await apiClient.search(`${entry.artist} ${entry.title}`, 1, 5);
      if (result.tracks[0]) await playTrack(result.tracks[0]); else setMissing(i);
    } catch { setMissing(i); } finally { setPending(null); }
  };

  if (isLoading || (!data && !isError)) return <ol className="sg-chart-list" aria-busy="true">
    {Array.from({ length: 10 }, (_, i) => <li key={i} className="sg-row sg-row--ghost" aria-hidden="true"><span /><span /><span /></li>)}
  </ol>;

  if (isError || !items.length) {
    const locked = !!data?.unavailable && service === 'vk';
    return <div className="sg-chart-empty" role="status">
      {locked ? <Lock size={22} /> : <RefreshCw size={22} />}
      <strong>{locked ? t('Чарт VK Музыки закрыт', 'VK Music chart is private') : t('Чарт сейчас недоступен', 'Chart is unavailable right now')}</strong>
      <p>{locked ? t('ВКонтакте показывает чарт только авторизованным пользователям, а публичного API для музыки нет.', 'VK only shows its chart to signed-in users and has no public music API.') : data?.unavailable || t('Источник не ответил. Попробуйте ещё раз чуть позже.', 'The source did not respond. Try again a bit later.')}</p>
      <div className="sg-chart-empty-actions">
        {!locked && <button className="sg-btn" onClick={() => refetch()} disabled={isFetching}><RefreshCw size={15} />{t('Ещё раз', 'Retry')}</button>}
        {data?.sourceUrl && <a className="sg-btn" href={data.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />{locked ? t('Открыть во ВКонтакте', 'Open in VK') : t('Открыть источник', 'Open source')}</a>}
      </div>
    </div>;
  }

  return <>
    <div className="sg-chart-head">
      <div className="sg-chart-meta">
        <strong>{data!.title}</strong>
        <small>{t('Обновлено', 'Updated')} {new Date(data!.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{data!.sourceUrl && <> · <a href={data!.sourceUrl} target="_blank" rel="noopener noreferrer">{t('источник', 'source')}</a></>}</small>
      </div>
      <button className="sg-btn sg-btn--primary" disabled={!playable.length} onClick={() => playCollection(playable, 0)}><Play size={16} fill="currentColor" />{t('Слушать чарт', 'Play chart')}</button>
    </div>
    <ol className="sg-chart-list">
      {items.map((entry, i) => {
        const current = !!entry.track && currentTrack?.id === entry.track.id;
        return <li key={`${entry.position}-${entry.title}`}>
          <button className={`sg-row sg-chart-row ${current ? 'is-current' : ''} ${current && isPlaying ? 'is-playing' : ''}`} onClick={() => void play(i)} disabled={pending !== null && pending !== i}
            aria-label={`${current && isPlaying ? t('Пауза', 'Pause') : t('Слушать', 'Play')}: ${entry.artist} — ${entry.title}`}>
            <span className="sg-row-num">
              {pending === i ? <LumaSpin size="sm" label={t('Ищем трек', 'Finding track')} /> : current ? <span className="sg-chart-bars" aria-hidden="true"><i /><i /><i /></span> : <b>{entry.position}</b>}
              <span className="sg-chart-hover" aria-hidden="true">{current && isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</span>
            </span>
            <ShardArtwork src={entry.artworkUrl || entry.track?.artworkUrl} alt="" index={i} small />
            <span className="sg-row-copy"><strong>{entry.title}</strong><small>{missing === i ? t('Не нашли этот трек в каталоге', 'Not found in the catalogue') : entry.artist}</small></span>
            <Shift value={entry.shift} />
            <span className="sg-row-dur">{entry.duration ? formatTime(entry.duration) : ''}</span>
          </button>
        </li>;
      })}
    </ol>
  </>;
}

/** Home, below the hero: global charts of VK Music, Yandex Music and Spotify. */
export function HomeCharts() {
  const t = useTranslation();
  const [ref, near] = useNearViewport<HTMLElement>();
  const [service, setService] = React.useState<ChartService>('yandex');
  const rootRef = React.useRef<HTMLDivElement>(null);
  const tabsRef = React.useRef<HTMLDivElement>(null);

  // Dim the hero shards once the charts take over the screen.
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const html = document.documentElement;
    const io = new IntersectionObserver(([entry]) => html.classList.toggle('home-deep', entry.isIntersecting), { rootMargin: '0px 0px -45% 0px' });
    io.observe(el);
    return () => { io.disconnect(); html.classList.remove('home-deep'); };
  }, []);

  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = SERVICES.findIndex(s => s.id === service), next = SERVICES[(i + (e.key === 'ArrowRight' ? 1 : SERVICES.length - 1)) % SERVICES.length];
    setService(next.id);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-service="${next.id}"]`)?.focus();
  };

  return <div className="sg-collections" ref={rootRef} id="home-charts">
    <section className="sg-section sg-charts" ref={ref}>
      <div className="sg-section-head sg-charts-head">
        <div>
          <span className="sg-eyebrow"><i className="sg-star" />{t('Обновляется каждый час', 'Updated hourly')}</span>
          <h2>{t('Чарты', 'Charts')}</h2>
        </div>
        <div className="sg-chart-tabs" role="tablist" aria-label={t('Сервис', 'Service')} ref={tabsRef} onKeyDown={onTabKey}>
          {SERVICES.map(s => <button key={s.id} role="tab" data-service={s.id} id={`chart-tab-${s.id}`} aria-controls="chart-panel" aria-selected={service === s.id} tabIndex={service === s.id ? 0 : -1}
            className={service === s.id ? 'is-active' : ''} onClick={() => setService(s.id)}>
            <i className={`sg-chart-dot sg-chart-dot--${s.id}`} aria-hidden="true" />{t(s.ru, s.en)}
          </button>)}
        </div>
      </div>
      <div className="sg-chart sg-glass" role="tabpanel" id="chart-panel" aria-labelledby={`chart-tab-${service}`}>
        <ChartList key={service} service={service} enabled={near} />
      </div>
    </section>
  </div>;
}
