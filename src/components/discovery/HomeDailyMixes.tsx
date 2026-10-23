import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { Play, Pause, RefreshCw } from 'lucide-react';
import { apiClient } from '../../api/apiClient.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '../../stores/useLanguageStore.js';
import { ShardArtwork } from '../tracks/ShardArtwork.js';
import { SkeletonCards, useDelayedFlag } from '../common/Skeleton.js';
import { libraryActions } from '../../telemetry/bus.js';
import type { Track } from '../../types/index.js';

export interface DailyMix { id: string; title: string; description: string; artists: string[]; artworkUrl?: string; tracks: Track[] }
/** One query for the shelf and the mix page: one edition per day, kept for the day. */
export const dailyMixesQuery = () => ({
  queryKey: ['daily-mixes', new Date().toISOString().slice(0, 10)],
  queryFn: () => apiClient.request<DailyMix[]>('/recommendations/daily-mixes'),
  staleTime: 60 * 60 * 1000,
  gcTime: 6 * 60 * 60 * 1000,
  retry: 1,
});

/** «Миксы дня» on the Search start screen: personal mixes grouped by the listener's artists. */
export function HomeDailyMixes() {
  const t = useTranslation();
  const { currentTrack, isPlaying, togglePlay, playCollection } = usePlayerStore(useShallow(s => ({ currentTrack: s.currentTrack, isPlaying: s.isPlaying, togglePlay: s.togglePlay, playCollection: s.playCollection })));
  const query = useQuery(dailyMixesQuery());
  const loadingShown = useDelayedFlag(query.isPending);
  const mixes = query.data || [];
  const head = <div className="sg-section-head"><span className="sg-eyebrow">{t('Собрано для вас', 'Made for you')}</span><h2 id="daily-mixes-title">{t('Миксы дня', 'Daily mixes')}</h2></div>;
  if (query.isPending) return <section className="sg-daily" aria-labelledby="daily-mixes-title" aria-busy="true">{head}<div style={{ visibility: loadingShown ? 'visible' : 'hidden' }}><SkeletonCards count={4} /></div></section>;
  if (query.isError && !mixes.length) return <section className="sg-daily" aria-labelledby="daily-mixes-title">{head}<p className="sg-daily-note" role="status">{t('Миксы не загрузились.', 'The mixes did not load.')} <button type="button" className="text-button" onClick={() => void query.refetch()}><RefreshCw size={14} />{t('Повторить', 'Retry')}</button></p></section>;
  if (!mixes.length) return <section className="sg-daily" aria-labelledby="daily-mixes-title">{head}<p className="sg-daily-note">{t('Миксы появятся, когда в лайках и истории наберётся музыка нескольких артистов.', 'Mixes appear once your likes and history hold music from a few artists.')}</p></section>;
  return <section className="sg-daily" aria-labelledby="daily-mixes-title">
    {head}
    <div className="sg-daily-grid">
      {mixes.map((mix, i) => {
        const playing = !!currentTrack && mix.tracks.some(track => track.id === currentTrack.id);
        const title = t(mix.title, mix.title.replace('Микс дня', 'Daily mix'));
        return <div key={mix.id} className={`sg-daily-card${playing ? ' is-current' : ''}`}>
          <span className="sg-daily-cover">
            <NavLink to={`/mix/${encodeURIComponent(mix.id)}`} tabIndex={-1} aria-hidden="true"><ShardArtwork src={mix.artworkUrl || mix.tracks[0]?.artworkUrl} alt="" index={i} /></NavLink>
            <button type="button" className="sg-daily-play" onClick={() => { if (playing) { togglePlay(); return; } libraryActions.emit('select', mix.tracks[0], { rank: i }, `mix:${mix.id}`); void playCollection(mix.tracks, 0, undefined, `mix:${mix.id}`); }}
              aria-label={`${playing && isPlaying ? t('Пауза', 'Pause') : t('Слушать', 'Play')}: ${title}`}>
              {playing && isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
          </span>
          <NavLink to={`/mix/${encodeURIComponent(mix.id)}`} className="sg-daily-open">
            <strong>{title}</strong>
            <small>{mix.description}</small>
          </NavLink>
        </div>;
      })}
    </div>
  </section>;
}
