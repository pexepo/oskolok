import React from 'react';
import {createPortal} from 'react-dom';
import {useLongPress} from '../../hooks/useLongPress.js';
import {TrackContextMenu,ContextMenuPosition} from '../common/TrackContextMenu.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import { useLocation } from 'react-router-dom';
import {ListMusic,Shuffle,Repeat,Repeat1,X,SlidersHorizontal,MoreHorizontal,UsersRound} from 'lucide-react';
import {MediaSettingsPanel,formatSpeed} from './MediaSettingsPanel.js';
import {audioManager} from '../../audio/AudioManager.js';
/** Current playback speed, for the badge on the bar. */
function usePlaybackSpeed(){const [speed,setSpeed]=React.useState(()=>audioManager.getEffects().speed);React.useEffect(()=>{const sync=()=>setSpeed(audioManager.getEffects().speed);window.addEventListener('oskolok-effects',sync);return()=>window.removeEventListener('oskolok-effects',sync);},[]);return speed;}
import {PlayerIcon} from './PlayerIcon.js';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {useShallow} from 'zustand/react/shallow';
import {useLibraryStore} from '../../stores/useLibraryStore.js';
import {ArtworkImage} from '../common/ArtworkImage.js';
import {SourceBadge} from '../tracks/SourceBadge.js';
import {formatTime} from '../../utils/formatters.js';
import {PlaybackSourcePicker} from '../tracks/PlaybackSourcePicker.js';
import {getPreferredSource,setPreferredSource} from '../../utils/playbackPreferences.js';
import LumaSpin from '../ui/luma-spin.js';
import {DevicesButton} from '../connect/ConnectLayer.js';
import {JamButton} from '../connect/JamLayer.js';
import {openJamPanel} from '../../connect/jam.js';
import {useSleepTimer,sleepTimerActive} from '../../audio/sleepTimer.js';
import {Moon,PictureInPicture2} from 'lucide-react';
import {desktopExtrasAvailable,toggleMiniPlayer} from '../../desktop/desktopBridge.js';
export function BottomPlayer(){
 // Everything except the clock: the clock ticks ten times a second and only the bar and the time read it.
 const p=usePlayerStore(useShallow(s=>({isWaveActive:s.isWaveActive,waveStatus:s.waveStatus,waveMessage:s.waveMessage,currentTrack:s.currentTrack,isFullPlayerOpen:s.isFullPlayerOpen,isPlaying:s.isPlaying,isBuffering:s.isBuffering,shuffle:s.shuffle,repeatMode:s.repeatMode,isQueueOpen:s.isQueueOpen,volume:s.volume,isMuted:s.isMuted,setFullPlayerOpen:s.setFullPlayerOpen,toggleShuffle:s.toggleShuffle,previous:s.previous,next:s.next,togglePlay:s.togglePlay,setRepeatMode:s.setRepeatMode,playTrack:s.playTrack,seek:s.seek,setQueueOpen:s.setQueueOpen,toggleMute:s.toggleMute,setVolume:s.setVolume,closeTrack:s.closeTrack}))),library=useLibraryStore();
 const location=useLocation(),t=useTranslation(),[mediaOpen,setMediaOpen]=React.useState(false),speed=usePlaybackSpeed(),[menu,setMenu]=React.useState<ContextMenuPosition|null>(null),closeMenu=React.useCallback(()=>setMenu(null),[]);
 const sleepOn=useSleepTimer(sleepTimerActive);
 const press=useLongPress(setMenu,{exclude:'input,select,textarea,label'}),trackId=p.currentTrack?.id;
 React.useEffect(()=>setMenu(null),[trackId,p.isFullPlayerOpen,location.pathname]);
 if(location.pathname==='/'||!p.currentTrack||p.isFullPlayerOpen)return null;
 const track=p.currentTrack;
 return <><footer {...press.handlers} className={`glass-player${press.press?' is-pressing':''}${menu?' has-menu':''}`} aria-label={t('Управление воспроизведением', 'Playback controls')}>
  {press.press&&<span className="player-hold-layer" aria-hidden="true"><i style={{left:press.press.rx,top:press.press.ry}}/></span>}
  <DockProgress label={t('Позиция трека', 'Track position')}/>
  {p.isWaveActive&&(p.waveStatus==='empty'||p.waveStatus==='waiting')&&p.waveMessage&&<p className="dock-wave-note" role="status">{p.waveMessage}</p>}
  <button className="dock-track" onClick={()=>p.setFullPlayerOpen(true)} title={t('Открыть Интерференцию', 'Open Interference')} aria-haspopup="menu"><ArtworkImage src={track.artworkUrl} alt={track.title} className="w-11 h-11 rounded-xl object-cover shrink-0"/><span><strong>{track.title}</strong><small>{track.artist.name}</small><SourceBadge track={track}/>{track.playbackDevice&&<small>Звук: {track.playbackDevice}</small>}</span></button>
  <div className="dock-transport"><button className={`dock-secondary ${p.shuffle?'enabled':''}`} onClick={p.toggleShuffle} title={t('Перемешать', 'Shuffle')} aria-label={t('Перемешать', 'Shuffle')}><Shuffle size={15}/></button><button onClick={p.previous} title={t('Предыдущий трек', 'Previous track')} aria-label={t('Предыдущий трек', 'Previous track')}><PlayerIcon name="prev" size={20}/></button><button className="dock-play" onClick={p.togglePlay} title={p.isPlaying?'Пауза':'Воспроизвести'} aria-label={p.isPlaying?'Пауза':'Воспроизвести'}>{p.isBuffering?<LumaSpin size="sm" label={t('Буферизация трека', 'Buffering track')}/>:<PlayerIcon name={p.isPlaying?'pause':'play'} size={42}/>}</button><button onClick={p.next} title={t('Следующий трек', 'Next track')} aria-label={t('Следующий трек', 'Next track')}><PlayerIcon name="next" size={20}/></button><button className={`dock-secondary ${p.repeatMode!=='off'?'enabled':''}`} onClick={()=>p.setRepeatMode(p.repeatMode==='off'?'all':p.repeatMode==='all'?'one':'off')} title={`Повтор: ${p.repeatMode}`} aria-label={`Повтор: ${p.repeatMode}`}>{p.repeatMode==='one'?<Repeat1 size={15}/>:<Repeat size={15}/>}</button></div>
  <div className="dock-tools"><DockTime/><button className={library.isLiked(track)?'is-liked':''} aria-pressed={library.isLiked(track)} onClick={()=>library.toggleLike(track)} title={library.isLiked(track)?t('Убрать из любимых','Remove from liked'):t('Добавить в любимые','Add to liked')} aria-label={library.isLiked(track)?t('Убрать из любимых','Remove from liked'):t('Добавить в любимые','Add to liked')}><PlayerIcon name="like" size={20}/></button><DevicesButton/><JamButton className="dock-jam-live"/><button onClick={()=>p.setQueueOpen(!p.isQueueOpen)} title={t('Очередь', 'Queue')} aria-label={t('Очередь', 'Queue')}><ListMusic size={18}/></button><label className={`dock-volume${p.isMuted||p.volume===0?' is-muted':''}`}><PlayerIcon name="volume" size={18}/><input type="range" min="0" max="1" step=".01" value={p.isMuted?0:p.volume} onChange={e=>{if(p.isMuted)p.toggleMute();p.setVolume(Number(e.target.value));}} aria-label={t('Громкость', 'Volume')}/></label>
   <DockMore badge={speed!==1?formatSpeed(speed):sleepOn?'sleep':''} onSound={()=>setMediaOpen(true)} source={<PlaybackSourcePicker track={track} appliesNow value={getPreferredSource(track.id)} onChange={source=>{setPreferredSource(source,track.id);const time=usePlayerStore.getState().currentTime;void p.playTrack(track,source).then(()=>{if(usePlayerStore.getState().currentTrack?.id===track.id)p.seek(time);});}}/>}/></div>
 </footer><MediaSettingsPanel open={mediaOpen} onClose={()=>setMediaOpen(false)}/>{menu&&createPortal(<TrackContextMenu track={track} position={menu} onClose={closeMenu} popClassName="player-menu-pop" leadingItems={<button onClick={()=>{closeMenu();p.closeTrack();}} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-500 transition-colors text-left cursor-pointer"><X size={16}/><span>{t('Закрыть плеер', 'Close player')}</span></button>}/>,document.body)}</>;
}

function DockProgress({label}:{label:string}){
 const currentTime=usePlayerStore(s=>s.currentTime),duration=usePlayerStore(s=>s.duration),seek=usePlayerStore(s=>s.seek);
 return <input className="dock-progress" type="range" min="0" max={duration||1} step=".1" value={Math.min(currentTime,duration||1)} style={{'--p':`${Math.min(100,(currentTime/(duration||1))*100)}%`} as React.CSSProperties} onChange={e=>seek(Number(e.target.value))} aria-label={label}/>;
}
function DockTime(){
 const currentTime=usePlayerStore(s=>Math.floor(s.currentTime)),duration=usePlayerStore(s=>s.duration);
 return <span className="dock-time">{formatTime(currentTime)} / {formatTime(duration)}</span>;
}

/** «⋯» on the dock: the tools that are not needed every minute (sound, source, Jam, desktop mini-player). */
function DockMore({badge,onSound,source}:{badge:string;onSound:()=>void;source:React.ReactNode}){
 const t=useTranslation(),[open,setOpen]=React.useState(false),root=React.useRef<HTMLDivElement>(null);
 React.useEffect(()=>{if(!open)return;const away=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};document.addEventListener('pointerdown',away);document.addEventListener('keydown',esc);return()=>{document.removeEventListener('pointerdown',away);document.removeEventListener('keydown',esc);};},[open]);
 const item=(fn:()=>void)=>()=>{setOpen(false);fn();};
 return <div className="dock-more" ref={root}>
  <button className={`dock-more__toggle${badge?' has-badge':''}`} onClick={()=>setOpen(o=>!o)} aria-expanded={open} aria-haspopup="menu" title={t('Ещё','More')} aria-label={t('Ещё: звук, источник, Jam','More: sound, source, Jam')}><MoreHorizontal size={19}/>{badge&&<i aria-hidden="true"/>}</button>
  {open&&<div className="dock-more__menu" role="menu">
   <button role="menuitem" onClick={item(onSound)}><SlidersHorizontal size={16}/><span>{t('Звук и эффекты','Sound & effects')}</span>{badge&&badge!=='sleep'&&<em>{badge}</em>}{badge==='sleep'&&<em>{t('таймер','timer')}</em>}</button>
   <div className="dock-more__source"><span>{t('Источник звука','Audio source')}</span>{source}</div>
   <button role="menuitem" onClick={item(openJamPanel)}><UsersRound size={16}/><span>{t('Jam — слушать с друзьями','Jam — listen with friends')}</span></button>
   {desktopExtrasAvailable()&&<button role="menuitem" onClick={item(toggleMiniPlayer)}><PictureInPicture2 size={16}/><span>{t('Мини-плеер поверх окон','Mini player on top')}</span><kbd>⌘⌥M</kbd></button>}
  </div>}
 </div>;
}
