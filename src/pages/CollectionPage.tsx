import React, { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Plus, ChevronRight, Play, Heart, BarChart3, ArrowDownToLine } from 'lucide-react';
import { useLibraryStore } from '../stores/useLibraryStore.js';
import { usePlaylistStore } from '../stores/usePlaylistStore.js';
import { useHistoryStore } from '../stores/useHistoryStore.js';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { ShardArtwork } from '../components/tracks/ShardArtwork.js';
import { TrackRow } from '../components/tracks/TrackRow.js';
import { Modal } from '../components/common/Modal.js';
import {apiClient} from '../api/apiClient.js';
import {useToastStore} from '../stores/useToastStore.js';

import { useTranslation } from '../stores/useLanguageStore.js';
import { FollowedArtistsShelf } from '../components/community/FollowedArtistsShelf.js';
export function CollectionPage() {
  const t = useTranslation();
  const { likedTracks } = useLibraryStore();
  const { playlists, createPlaylist } = usePlaylistStore();
  const { history, fetchHistory } = useHistoryStore();
  const playCollection = usePlayerStore(s=>s.playCollection);
  const [isModalOpen,setIsModalOpen] = useState(false), [title,setTitle] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('');
  useEffect(()=>{void fetchHistory();},[fetchHistory]);
  const artists = useMemo(()=>{
    const counts = new Map<string,{artist: typeof likedTracks[number]['artist']; count:number; cover?:string}>();
    for (const track of likedTracks) {
      const key=track.artist.name.toLowerCase(), prev=counts.get(key);
      counts.set(key,{artist:track.artist,count:(prev?.count||0)+1,cover:track.artist.avatarUrl||track.artworkUrl});
    }
    return [...counts.values()].sort((a,b)=>b.count-a.count).slice(0,6);
  },[likedTracks]);
  const handleCreate=async(e:React.FormEvent)=>{
    e.preventDefault();if(!title.trim()||busy)return;setBusy(true);setError('');
    try{await createPlaylist(title.trim());setTitle('');setIsModalOpen(false);}catch{setError(t('Не удалось создать плейлист. Попробуйте ещё.', 'Could not create the playlist. Try again.'));}finally{setBusy(false);}
  };
  return <div className="collection-page">
    <div className="collection-heading"><span className="eyebrow">{t('Ваша музыка, ваши грани', 'Your music, your facets')}</span><h1>{t('Моя', 'My')} <em>{t('коллекция', 'collection')}</em></h1><NavLink to="/profile?tab=import" className="secondary-button collection-import">{t('Перенести музыку', 'Transfer music')} <Plus size={16}/></NavLink> <NavLink to="/stats" className="secondary-button collection-import collection-stats-link">{t('Мои итоги', 'My stats')} <BarChart3 size={16}/></NavLink> <NavLink to="/offline" className="secondary-button collection-import collection-stats-link">{t('Скачанное', 'Downloads')} <ArrowDownToLine size={16}/></NavLink></div>
    <section><div className="section-heading collection-section"><h2>{t('Плейлисты', 'Playlists')} <i/></h2><NavLink to="/playlists" className="text-button">{t('Все плейлисты', 'All playlists')} <ChevronRight size={14}/></NavLink></div>
      <div className="collection-playlists">
        {playlists.slice(0,5).map((pl,i)=><div className="collection-tile-wrap" key={pl.id}><NavLink to={`/playlist/${encodeURIComponent(pl.id)}`} className="collection-tile">
          <ShardArtwork src={pl.artworkUrl || pl.tracks?.[0]?.track.artworkUrl} alt={pl.title} index={i}/><h3>{pl.title}</h3><p>{t(`${pl.trackCount||pl.tracks?.length||0} треков`, `${pl.trackCount||pl.tracks?.length||0} tracks`)}</p>
        </NavLink><button className="collection-profile-add" aria-label={`Добавить ${pl.title} в профиль`} title={t('В профиль', 'To profile')} onClick={()=>void apiClient.request('/profile/showcase',{method:'POST',body:JSON.stringify({kind:'playlist',playlistId:pl.id})}).then(()=>useToastStore.getState().addToast('Плейлист добавлен в профиль','success')).catch(e=>useToastStore.getState().addToast(e.message,'warning'))}><Plus size={17}/></button></div>)}
        <NavLink to="/liked" className="collection-tile"><div className="liked-shard"><ShardArtwork src={likedTracks[0]?.artworkUrl} alt={t('Любимые треки', 'Liked tracks')} index={4}/><Heart size={30}/></div><h3>{t('Любимые осколки', 'Favorite shards')}</h3><p>{t(`${likedTracks.length} треков`, `${likedTracks.length} tracks`)}</p></NavLink>
        <button className="collection-tile create-shard" onClick={()=>setIsModalOpen(true)}><div><Plus size={30}/></div><h3>{t('Новый плейлист', 'New playlist')}</h3><p>{t('Собрать свою историю', 'Build your story')}</p></button>
      </div>
    </section>
    <div className="collection-lower">
      <section><div className="section-heading collection-section"><h2>{t('Любимые артисты', 'Favorite artists')} <i/></h2></div>
        {artists.length ? <div className="collection-artists">{artists.map((item,i)=><NavLink to={`/artist/${encodeURIComponent(item.artist.id)}`} key={item.artist.name} className="collection-tile"><ShardArtwork src={item.cover} alt={item.artist.name} index={i+1} portrait/><h3>{item.artist.name}</h3><p>{item.count} в избранном</p></NavLink>)}</div> : <div className="collection-empty">{t('Ваши любимые артисты появятся здесь, когда вы начнёте сохранять треки.', 'Your favorite artists will appear here once you start saving tracks.')}<NavLink to="/search">{t('Найти музыку', 'Find music')} <ChevronRight size={14}/></NavLink></div>}
      </section>
      <section><div className="section-heading collection-section"><h2>{t('Любимые треки', 'Liked tracks')} <i/></h2><NavLink to="/liked" className="text-button">{t('Все', 'All')} <ChevronRight size={14}/></NavLink></div>
        {likedTracks.length ? <div className="collection-favorites">{likedTracks.slice(0,5).map((track,i)=><button onClick={()=>playCollection(likedTracks,i)} key={track.id} className="collection-song"><ShardArtwork src={track.artworkUrl} alt={track.title} index={i} small/><span><strong>{track.title}</strong><small>{track.artist.name}</small></span><Play size={14}/></button>)}</div> : <div className="collection-empty">{t('Нажмите сердечко у трека — и он станет частью вашей коллекции.', 'Tap the heart on a track to add it to your collection.')}</div>}
      </section>
    </div>
    <FollowedArtistsShelf/>
    {history.length>0 && <section className="collection-history"><div className="section-heading collection-section"><h2>{t('Недавно звучало', 'Recently played')} <i/></h2><NavLink to="/history" className="text-button">{t('История', 'History')} <ChevronRight size={14}/></NavLink></div><div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8">{history.slice(0,6).map((item,i)=><TrackRow key={item.id} track={item.track} index={i} collection={history.map(h=>h.track)}/>)}</div></section>}
    <Modal isOpen={isModalOpen} onClose={()=>setIsModalOpen(false)} title={t('Новый плейлист', 'New playlist')}><form onSubmit={handleCreate} className="wave-settings"><label htmlFor="playlist-title">{t('Как назовём?', 'What shall we call it?')}</label><input id="playlist-title" className="glass-input" required value={title} onChange={e=>setTitle(e.target.value)} placeholder={t('Название вашей истории', 'Name your story')}/>{error&&<p role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy?'Создаём…':'Создать плейлист'}</button></form></Modal>
  </div>;
}
