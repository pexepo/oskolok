import React from 'react';
import { useLocation } from 'react-router-dom';
import {Play,Pause,SkipBack,SkipForward,Heart,AudioLines,ListMusic,Shuffle,Repeat,Repeat1,Volume2} from 'lucide-react';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {useLibraryStore} from '../../stores/useLibraryStore.js';
import {ArtworkImage} from '../common/ArtworkImage.js';
import {SourceBadge} from '../tracks/SourceBadge.js';
import {formatTime} from '../../utils/formatters.js';
import LumaSpin from '../ui/luma-spin.js';
export function BottomPlayer(){
 const p=usePlayerStore(),library=useLibraryStore();
 const location=useLocation();
 if(location.pathname==='/'||!p.currentTrack||p.isFullPlayerOpen)return null;
 const track=p.currentTrack;
 return <footer className="glass-player" aria-label="Управление воспроизведением">
  <input className="dock-progress" type="range" min="0" max={p.duration||1} step=".1" value={Math.min(p.currentTime,p.duration||1)} onChange={e=>p.seek(Number(e.target.value))} aria-label="Позиция трека"/>
  <button className="dock-track" onClick={()=>p.setFullPlayerOpen(true)} title="Открыть Интерференцию"><ArtworkImage src={track.artworkUrl} alt={track.title} className="w-11 h-11 rounded-xl object-cover shrink-0"/><span><strong>{track.title}</strong><small>{track.artist.name}</small><SourceBadge track={track}/>{track.playbackDevice&&<small>Звук: {track.playbackDevice}</small>}</span></button>
  <div className="dock-transport"><button className={`dock-secondary ${p.shuffle?'enabled':''}`} onClick={p.toggleShuffle} title="Перемешать" aria-label="Перемешать"><Shuffle size={15}/></button><button onClick={p.previous} title="Предыдущий трек" aria-label="Предыдущий трек"><SkipBack size={18}/></button><button className="dock-play" onClick={p.togglePlay} title={p.isPlaying?'Пауза':'Воспроизвести'} aria-label={p.isPlaying?'Пауза':'Воспроизвести'}>{p.isBuffering?<LumaSpin size="sm" label="Буферизация трека"/>:p.isPlaying?<Pause size={18} fill="currentColor"/>:<Play size={18} fill="currentColor"/>}</button><button onClick={p.next} title="Следующий трек" aria-label="Следующий трек"><SkipForward size={18}/></button><button className={`dock-secondary ${p.repeatMode!=='off'?'enabled':''}`} onClick={()=>p.setRepeatMode(p.repeatMode==='off'?'all':p.repeatMode==='all'?'one':'off')} title={`Повтор: ${p.repeatMode}`} aria-label={`Повтор: ${p.repeatMode}`}>{p.repeatMode==='one'?<Repeat1 size={15}/>:<Repeat size={15}/>}</button></div>
  <div className="dock-tools"><span className="dock-time">{formatTime(p.currentTime)} / {formatTime(p.duration)}</span><button onClick={()=>library.toggleLike(track)} aria-label={library.isLiked(track.id)?'Убрать из любимых':'Добавить в любимые'}><Heart size={17} className={library.isLiked(track.id)?'fill-current text-rose-400':''}/></button><button onClick={()=>p.setFullPlayerOpen(true)} title="Интерференция" aria-label="Интерференция"><AudioLines size={19}/></button><button onClick={()=>p.setQueueOpen(!p.isQueueOpen)} title="Очередь" aria-label="Очередь"><ListMusic size={18}/></button><label className="dock-volume"><Volume2 size={16}/><input type="range" min="0" max="1" step=".01" value={p.isMuted?0:p.volume} onChange={e=>{if(p.isMuted)p.toggleMute();p.setVolume(Number(e.target.value));}} aria-label="Громкость"/></label></div>
 </footer>;
}
