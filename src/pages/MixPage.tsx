import React from 'react';
import { useParams, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Play, Shuffle, ListPlus, ArrowLeft } from 'lucide-react';
import { apiClient } from '../api/apiClient.js';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { usePlaylistStore } from '../stores/usePlaylistStore.js';
import { TrackRow } from '../components/tracks/TrackRow.js';
import { ShardArtwork } from '../components/tracks/ShardArtwork.js';
import { LoadingSurface, SkeletonRows } from '../components/common/Skeleton.js';
import { useTranslation } from '../stores/useLanguageStore.js';
import { useToastStore } from '../stores/useToastStore.js';
import { dailyMixesQuery, type DailyMix } from '../components/discovery/HomeDailyMixes.js';

/** One daily mix: its tracks, play / shuffle, and «В коллекцию» (a private playlist, created once). */
export function MixPage() {
  const { id = '' } = useParams(), t = useTranslation(), navigate = useNavigate();
  const query = useQuery(dailyMixesQuery());
  const mix: DailyMix | undefined = query.data?.find(m => m.id === id);
  const play = usePlayerStore(s => s.playCollection);
  const [saving, setSaving] = React.useState(false), requestId = React.useRef(crypto.randomUUID());
  const save = async () => {
    if (!mix || saving) return;
    setSaving(true);
    try {
      const created = await apiClient.request<{ playlist: { id: string } }>('/playlist-imports', { method: 'POST', body: JSON.stringify({ requestId: requestId.current, title: `${mix.title} · ${new Date().toLocaleDateString()}`, description: mix.description, isPublic: false, artworkUrl: mix.artworkUrl, tracks: mix.tracks }) });
      await usePlaylistStore.getState().fetchPlaylists();
      useToastStore.getState().addToast(t('Микс сохранён в коллекцию', 'Mix saved to your collection'), 'success');
      navigate(`/playlist/${created.playlist.id}`);
    } catch (e) { useToastStore.getState().addToast((e as Error).message, 'warning'); }
    finally { setSaving(false); }
  };
  if (query.isError) return <div className="search-message crystal-slab" role="alert">{t('Не удалось загрузить миксы.', 'Could not load the mixes.')}<button className="text-button" onClick={() => void query.refetch()}>{t('Повторить', 'Retry')}</button></div>;
  return <div className="page-crystal mix-page">
    <NavLink to="/search" className="text-button playlist-import-back"><ArrowLeft size={16} />{t('Поиск', 'Search')}</NavLink>
    <LoadingSurface loading={query.isPending} label={t('Собираем микс…', 'Building the mix…')} skeleton={<SkeletonRows rows={8} />}>
      {!mix ? <div className="search-message crystal-slab"><strong>{t('Этот микс уже обновился', 'This mix has been refreshed')}</strong><span>{t('Миксы дня собираются заново каждый день.', 'Daily mixes are rebuilt every day.')}</span><NavLink className="text-button" to="/search">{t('К миксам', 'To the mixes')}</NavLink></div>
        : <>
          <header className="mix-head">
            <div className="mix-cover"><ShardArtwork src={mix.artworkUrl || mix.tracks[0]?.artworkUrl} alt="" index={1} /></div>
            <div><span className="eyebrow">{t('Микс дня', 'Daily mix')}</span><h1>{t(mix.title, mix.title.replace('Микс дня', 'Daily mix'))}</h1><p>{mix.description}</p>
              <div className="mix-actions">
                <button className="primary-button" onClick={() => void play(mix.tracks, 0, undefined, `mix:${mix.id}`)}><Play size={16} fill="currentColor" />{t('Слушать', 'Play')}</button>
                <button className="secondary-button" onClick={() => { const list = [...mix.tracks]; for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } void play(list, 0, undefined, `mix:${mix.id}`); }}><Shuffle size={16} />{t('Вперемешку', 'Shuffle')}</button>
                <button className="secondary-button" disabled={saving} aria-busy={saving} onClick={() => void save()}><ListPlus size={16} />{t('В коллекцию', 'Save to collection')}</button>
              </div></div>
          </header>
          <section className="crystal-slab search-list">{mix.tracks.map((track, i) => <TrackRow key={track.id} track={track} index={i} collection={mix.tracks} />)}</section>
        </>}
    </LoadingSurface>
  </div>;
}
