import React, { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Plus, ChevronRight, Play, Heart } from 'lucide-react';
import { useLibraryStore } from '../stores/useLibraryStore.js';
import { usePlaylistStore } from '../stores/usePlaylistStore.js';
import { useHistoryStore } from '../stores/useHistoryStore.js';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { ShardArtwork } from '../components/tracks/ShardArtwork.js';
import { TrackRow } from '../components/tracks/TrackRow.js';
import { Modal } from '../components/common/Modal.js';
import {apiClient} from '../api/apiClient.js';
import {useToastStore} from '../stores/useToastStore.js';

export function CollectionPage() {
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
    try{await createPlaylist(title.trim());setTitle('');setIsModalOpen(false);}catch{setError('Не удалось создать плейлист. Попробуйте ещё.');}finally{setBusy(false);}
  };
  return <div className="collection-page">
    <div className="collection-heading"><span className="eyebrow">ВАША МУЗЫКА, ВАШИ ГРАНИ</span><h1>Моя <em>коллекция</em></h1><NavLink to="/import" className="secondary-button collection-import">Перенести музыку <Plus size={16}/></NavLink></div>
    <section><div className="section-heading collection-section"><h2>Плейлисты <i/></h2><NavLink to="/playlists" className="text-button">Все плейлисты <ChevronRight size={14}/></NavLink></div>
      <div className="collection-playlists">
        {playlists.slice(0,5).map((pl,i)=><div className="collection-tile-wrap" key={pl.id}><NavLink to={`/playlist/${encodeURIComponent(pl.id)}`} className="collection-tile">
          <ShardArtwork src={pl.artworkUrl || pl.tracks?.[0]?.track.artworkUrl} alt={pl.title} index={i}/><h3>{pl.title}</h3><p>{pl.trackCount||pl.tracks?.length||0} треков</p>
        </NavLink><button className="collection-profile-add" aria-label={`Добавить ${pl.title} в профиль`} title="В профиль" onClick={()=>void apiClient.request('/profile/playlists',{method:'POST',body:JSON.stringify({playlistId:pl.id})}).then(()=>useToastStore.getState().addToast('Плейлист добавлен в профиль','success')).catch(e=>useToastStore.getState().addToast(e.message,'warning'))}><Plus size={17}/></button></div>)}
        <NavLink to="/liked" className="collection-tile"><div className="liked-shard"><ShardArtwork src={likedTracks[0]?.artworkUrl} alt="Любимые треки" index={4}/><Heart size={30}/></div><h3>Любимые осколки</h3><p>{likedTracks.length} треков</p></NavLink>
        <button className="collection-tile create-shard" onClick={()=>setIsModalOpen(true)}><div><Plus size={30}/></div><h3>Новый плейлист</h3><p>Собрать свою историю</p></button>
      </div>
    </section>
    <div className="collection-lower">
      <section><div className="section-heading collection-section"><h2>Любимые артисты <i/></h2></div>
        {artists.length ? <div className="collection-artists">{artists.map((item,i)=><NavLink to={`/artist/${encodeURIComponent(item.artist.id)}`} key={item.artist.name} className="collection-tile"><ShardArtwork src={item.cover} alt={item.artist.name} index={i+1}/><h3>{item.artist.name}</h3><p>{item.count} в избранном</p></NavLink>)}</div> : <div className="collection-empty">Ваши любимые артисты появятся здесь, когда вы начнёте сохранять треки.<NavLink to="/search">Найти музыку <ChevronRight size={14}/></NavLink></div>}
      </section>
      <section><div className="section-heading collection-section"><h2>Любимые треки <i/></h2><NavLink to="/liked" className="text-button">Все <ChevronRight size={14}/></NavLink></div>
        {likedTracks.length ? <div className="collection-favorites">{likedTracks.slice(0,5).map((track,i)=><button onClick={()=>playCollection(likedTracks,i)} key={track.id} className="collection-song"><ShardArtwork src={track.artworkUrl} alt={track.title} index={i} small/><span><strong>{track.title}</strong><small>{track.artist.name}</small></span><Play size={14}/></button>)}</div> : <div className="collection-empty">Нажмите сердечко у трека — и он станет частью вашей коллекции.</div>}
      </section>
    </div>
    {history.length>0 && <section className="collection-history"><div className="section-heading collection-section"><h2>Недавно звучало <i/></h2><NavLink to="/history" className="text-button">История <ChevronRight size={14}/></NavLink></div><div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8">{history.slice(0,6).map((item,i)=><TrackRow key={item.id} track={item.track} index={i} collection={history.map(h=>h.track)}/>)}</div></section>}
    <Modal isOpen={isModalOpen} onClose={()=>setIsModalOpen(false)} title="Новый плейлист"><form onSubmit={handleCreate} className="wave-settings"><label htmlFor="playlist-title">Как назовём?</label><input id="playlist-title" className="glass-input" required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название вашей истории"/>{error&&<p role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy?'Создаём…':'Создать плейлист'}</button></form></Modal>
  </div>;
}
