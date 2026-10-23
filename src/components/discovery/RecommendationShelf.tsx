import React from 'react';
import {LoadingSurface,SkeletonCards} from '../common/Skeleton.js';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Play, ArrowUpRight } from 'lucide-react';
import { apiClient } from '../../api/apiClient.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useLibraryStore } from '../../stores/useLibraryStore.js';
import { ShardArtwork } from '../tracks/ShardArtwork.js';
import { SourceBadge } from '../tracks/SourceBadge.js';
import {LoadingState} from '../common/LoadingState.js';
import LumaSpin from '../ui/luma-spin.js';

import { useTranslation } from '../../stores/useLanguageStore.js';
export function RecommendationShelf({ character = 'discovery', title }: { character?: string; title?: string }) {
  const t = useTranslation();
  // The server phrases reasons in Russian; keep the artist names, swap the frame.
  const reason = (text?: string) => text && t(text, text.replace(/^Потому что вы слушаете /, 'Because you listen to ').replace(/^Новые грани · /, 'New facets · '));
  const likedSignature = useLibraryStore(s => s.likedTracks.map(t => t.id).sort().join('|'));
  const waveOptions = usePlayerStore(s => s.waveOptions);
  const playCollection = usePlayerStore(s => s.playCollection);
  const [excluded, setExcluded] = React.useState<string[]>([]);
  const { data = [], isFetching, isError, refetch } = useQuery({
    queryKey: ['discovery', character, likedSignature, waveOptions?.mood, waveOptions?.language, excluded],
    queryFn: () => apiClient.getRecommendations({ limit: 6, character, mood: waveOptions?.mood, language: waveOptions?.language, excludeTrackIds: excluded }),
    staleTime: 90000,
    placeholderData: previous => previous,
  });
  return <section className="discovery-shelf">
    <div className="section-heading"><h2>{title ?? t('Собрано для вас', 'Picked for you')}</h2>
      <button className="text-button" disabled={isFetching} onClick={() => data.length ? setExcluded(prev => [...new Set([...prev, ...data.map(t=>t.id)])].slice(-120)) : refetch()}>{isFetching?<LumaSpin size="sm" label={t('Обновляем подборку', 'Refreshing picks')}/>:<RefreshCw size={14}/>} {t('Другие грани', 'Other facets')}</button>
    </div>
    {!data.length && isFetching ? <LoadingSurface loading label={t('Настраиваемся на вашу частоту…', 'Tuning in to your frequency…')} skeleton={<SkeletonCards count={6}/>}/> : !data.length ? <div className="empty-glass">{isError ? t('Источники временно не отвечают.', 'Sources are not responding right now.') : t('Пока не удалось собрать подборку.', 'Could not build a selection yet.')} <button onClick={() => refetch()}>{t('Попробовать ещё', 'Try again')}</button></div> :
      <div className="recommendation-grid">{data.slice(0,6).map((track,i) => <button className="recommendation-card" key={track.id} onClick={() => playCollection(data,i)}>
        <div className="recommendation-art"><ShardArtwork src={track.artworkUrl} alt={track.title} index={i}/><span className="shard-play"><Play size={20} fill="currentColor"/></span></div>
        <SourceBadge track={track}/><h3>{track.title}</h3><p>{track.artist.name}</p><small>{reason(track.recommendationReason) || t('Новые грани вашей музыки', 'New facets of your music')} <ArrowUpRight size={11}/></small>
      </button>)}</div>}
  </section>;
}
