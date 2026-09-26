import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Play, ArrowUpRight } from 'lucide-react';
import { apiClient } from '../../api/apiClient.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useLibraryStore } from '../../stores/useLibraryStore.js';
import { ShardArtwork } from '../tracks/ShardArtwork.js';
import { SourceBadge } from '../tracks/SourceBadge.js';

export function RecommendationShelf({ character = 'discovery', title = 'Собрано для вас' }: { character?: string; title?: string }) {
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
    <div className="section-heading"><h2>{title}</h2>
      <button className="text-button" disabled={isFetching} onClick={() => data.length ? setExcluded(prev => [...new Set([...prev, ...data.map(t=>t.id)])].slice(-120)) : refetch()}><RefreshCw size={14} className={isFetching ? 'animate-spin' : ''}/> Другие грани</button>
    </div>
    {!data.length && isFetching ? <div className="shelf-skeleton">Настраиваемся на вашу частоту…</div> : !data.length ? <div className="empty-glass">{isError ? 'Источники временно не отвечают.' : 'Пока не удалось собрать подборку.'} <button onClick={() => refetch()}>Попробовать ещё</button></div> :
      <div className="recommendation-grid">{data.slice(0,6).map((t,i) => <button className="recommendation-card" key={t.id} onClick={() => playCollection(data,i)}>
        <div className="recommendation-art"><ShardArtwork src={t.artworkUrl} alt={t.title} index={i}/><span className="shard-play"><Play size={20} fill="currentColor"/></span></div>
        <SourceBadge track={t}/><h3>{t.title}</h3><p>{t.artist.name}</p><small>{t.recommendationReason || 'Новые грани вашей музыки'} <ArrowUpRight size={11}/></small>
      </button>)}</div>}
  </section>;
}
