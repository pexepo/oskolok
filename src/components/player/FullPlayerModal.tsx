import {TrackInfoDialog} from '../tracks/TrackInfoDialog.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {VolumeControl} from './VolumeControl.js';
import {useShallow} from 'zustand/react/shallow';
import React from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown, Info, Music2, SlidersHorizontal, Moon, MoreHorizontal, UsersRound, Flag } from 'lucide-react';
import { openJamPanel } from '../../connect/jam.js';
import { DevicesButton } from '../connect/ConnectLayer.js';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { JamButton } from '../connect/JamLayer.js';
import { useSleepTimer, sleepTimerActive } from '../../audio/sleepTimer.js';
import { MediaSettingsPanel } from './MediaSettingsPanel.js';
import { PlaybackSourcePicker } from '../tracks/PlaybackSourcePicker.js';
import { TrackArtistsPopup } from '../tracks/TrackCredits.js';
import { getPreferredSource, setPreferredSource } from '../../utils/playbackPreferences.js';
import { useReportStore } from '../common/ReportDialog.js';
import { audioManager } from '../../audio/AudioManager.js';
import { DarkPlayerSurface, PlayerIcon } from './PlayerIcon.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useLibraryStore } from '../../stores/useLibraryStore.js';
import { usePlaylistStore } from '../../stores/usePlaylistStore.js';
import { ArtworkImage } from '../common/ArtworkImage.js';
import { PlayerControls } from './PlayerControls.js';
import { ProgressBar } from './ProgressBar.js';
import { LyricsView } from '../lyrics/LyricsView.js';
import { LyricsBoundary } from '../lyrics/LyricsBoundary.js';
import { formatDisplayTitle } from '../../utils/formatTrack.js';
import { GradientWave } from '../ui/gradient-wave.js';
import { TelegramTrackButton } from '../telegram/TelegramTrackButton.js';
import { SourceBadge } from '../tracks/SourceBadge.js';
import { useThemeStore } from '../../stores/useThemeStore.js';
import { setNativeBars } from '../../utils/nativeShell.js';

export const FullPlayerModal: React.FC = () => {
  const reduceMotion=useReducedMotion();
  const t=useTranslation(),[mediaOpen,setMediaOpen]=React.useState(false),[showInfo,setShowInfo]=React.useState(false),[showArtists,setShowArtists]=React.useState(false);
  const { isDark } = useThemeStore();
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    duration,
    shuffle,
    repeatMode,
    togglePlay,
    previous,
    next,
    seek,
    toggleShuffle,
    setRepeatMode,
    isFullPlayerOpen,
    setFullPlayerOpen,
  } = usePlayerStore(useShallow(s=>({currentTrack:s.currentTrack,isPlaying:s.isPlaying,isBuffering:s.isBuffering,duration:s.duration,shuffle:s.shuffle,repeatMode:s.repeatMode,togglePlay:s.togglePlay,previous:s.previous,next:s.next,seek:s.seek,toggleShuffle:s.toggleShuffle,setRepeatMode:s.setRepeatMode,isFullPlayerOpen:s.isFullPlayerOpen,setFullPlayerOpen:s.setFullPlayerOpen})));

  const { isLiked, toggleLike } = useLibraryStore();
  const { playlists, addTrackToPlaylist } = usePlaylistStore();
  const [showPlaylistMenu, setShowPlaylistMenu] = React.useState(false);
  const [source, setSource] = React.useState(() => getPreferredSource(currentTrack?.id));
  React.useEffect(() => { setSource(getPreferredSource(currentTrack?.id)); }, [currentTrack?.id]);
  const [mobileView, setMobileView] = React.useState<'info'|'lyrics'>('info');
  const [isMobile, setIsMobile] = React.useState(() => window.matchMedia('(max-width: 700px)').matches);
  const trackPanelRef = React.useRef<HTMLDivElement>(null);
  const lyricsPanelRef = React.useRef<HTMLDivElement>(null);

  const liked = currentTrack ? isLiked(currentTrack) : false;
  const artistName = currentTrack?.artist?.name || t('Неизвестный исполнитель', 'Unknown artist');
  const artistId = currentTrack?.artist?.id || '';
  const displayTitle = currentTrack ? formatDisplayTitle(currentTrack.title, artistName) : '';

  const handleNextRepeatMode = () => {
    if (repeatMode === 'off') setRepeatMode('all');
    else if (repeatMode === 'all') setRepeatMode('one');
    else setRepeatMode('off');
  };

  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFullPlayerOpen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [setFullPlayerOpen]);

  React.useEffect(() => {
    try {
      (window as any).electronAPI?.setTitleBarOverlay?.({
        color: '#00000000',
        symbolColor: isDark ? '#e2e8f0' : '#162b50',
        height: 34,
      });
    } catch {}
    // Интерференция is dark in both themes: light status-bar icons while it is open on Android.
    setNativeBars(isFullPlayerOpen || isDark);
  }, [isFullPlayerOpen, isDark]);

  const playlistList = Array.isArray(playlists) ? playlists : [];
  const modalRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (isFullPlayerOpen) {
      setMobileView('info');
      window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
      if (modalRef.current) {
        modalRef.current.scrollTop = 0;
        modalRef.current.scrollLeft = 0;
      }
    }
  }, [isFullPlayerOpen]);

  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const update = () => setIsMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  React.useEffect(() => {
    for (const [panel, hidden] of [[trackPanelRef.current, isMobile && mobileView !== 'info'], [lyricsPanelRef.current, isMobile && mobileView !== 'lyrics']] as const) {
      if (hidden) panel?.setAttribute('inert', '');
      else panel?.removeAttribute('inert');
    }
  }, [isMobile, mobileView, isFullPlayerOpen]);

  return <AnimatePresence>{isFullPlayerOpen && currentTrack ? (
        <motion.div
          ref={modalRef}
          key="full-player-modal"
          // Rises from the player bar like a sheet; collapsing sends it back down.
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 56, scale: .985, borderRadius: 32 }}
          animate={{ opacity: 1, y: 0, scale: 1, borderRadius: 0, transition: { duration: .46, ease: [.2, .8, .2, 1] } }}
          exit={reduceMotion ? { opacity: 0, transition: { duration: .15 } } : { opacity: 0, y: 48, scale: .985, borderRadius: 32, transition: { duration: .3, ease: [.4, 0, .8, .4] } }}
          role="dialog" aria-modal="true" aria-label={t('Полноэкранный плеер', 'Full-screen player')} data-playing={isPlaying ? "true" : "false"}
          className="interference-modal np-v2 fixed inset-0 z-50 bg-[#f0f4f9] dark:bg-[#070c14] flex flex-col justify-between p-6 md:p-8 select-none overflow-hidden text-[#162b50] dark:text-slate-100 transition-colors duration-300"
        >
          <DarkPlayerSurface.Provider value={true}>
          <GradientWave artworkUrl={currentTrack.artworkUrl} isPlaying={isPlaying && !isBuffering} isDark={isDark}/>

          {/* Header Bar */}
          <div
            style={{ WebkitAppRegion: 'drag' } as any}
            className="flex items-center justify-between pb-3 shrink-0 pr-0 md:pr-36 relative z-10"
          >
            <button
              onClick={() => setFullPlayerOpen(false)}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              title={t('Свернуть плеер', 'Minimize player')}
              aria-label={t('Свернуть плеер', 'Minimize player')}
              className="np-collapse flex items-center gap-2 text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-white transition-colors group px-3 py-2 rounded-xl hover:bg-white/60 dark:hover:bg-slate-800/60 cursor-pointer"
            >
              <ChevronDown size={22} className="group-hover:-translate-y-0.5 transition-transform" />
              <span className="text-xs font-bold uppercase tracking-wider">{t('Свернуть', 'Collapse')}</span>
            </button>
            <div className="interference-title" aria-hidden="true" />
          </div>

          <div className="mobile-player-tabs" role="tablist" aria-label={t('Экран трека', 'Track view')} data-view={mobileView}>
            <span className="mobile-player-tabs-indicator" aria-hidden="true"/>
            <button type="button" role="tab" id="mobile-player-info-tab" aria-selected={mobileView==='info'} aria-controls="mobile-player-info" onClick={() => setMobileView('info')}><Info size={17}/> {t('Инфо', 'Info')}</button>
            <button type="button" role="tab" id="mobile-player-lyrics-tab" aria-selected={mobileView==='lyrics'} aria-controls="full-player-lyrics" onClick={() => setMobileView('lyrics')}><Music2 size={17}/> {t('Текст', 'Lyrics')}</button>
          </div>

          {/* The same mounted panels crossfade on phones; lyrics keep their timing state. */}
          <div className={`interference-main np-layout view-${mobileView} relative z-10 flex-1 min-h-0 overflow-hidden`}>
            {/* Cover column: artwork, scrub bar, title — then our controls (Apple-style "now playing"). */}
            <div ref={trackPanelRef} id="mobile-player-info" role={isMobile?'tabpanel':undefined} aria-labelledby={isMobile?'mobile-player-info-tab':undefined} aria-hidden={isMobile&&mobileView!=='info'} className="interference-track np-panel">
              <div className="np-art">
                <ArtworkImage src={currentTrack.artworkUrl} alt={currentTrack.title} className="w-full h-full" iconSize={88} zoomable />
              </div>
              <div className="np-progress"><LiveProgressBar /></div>
              <div className="np-heading">
                <h2 title={displayTitle}><NavLink to={currentTrack.release?.id ? `/release/${encodeURIComponent(currentTrack.release.id)}` : `/track/${encodeURIComponent(currentTrack.id)}`} onClick={() => setFullPlayerOpen(false)} className="np-title-link">{displayTitle}</NavLink></h2>
                <button type="button" className="np-artists" onClick={() => setShowArtists(true)} title={t('Исполнители трека', 'Track artists')} aria-haspopup="dialog">{artistName}</button>
              </div>
              <div className="np-controls">
                <PlayerControls
                  size="lg"
                  isPlaying={isPlaying}
                  isBuffering={isBuffering}
                  shuffle={shuffle}
                  repeatMode={repeatMode}
                  onTogglePlay={togglePlay}
                  onPrevious={previous}
                  onNext={next}
                  onToggleShuffle={toggleShuffle}
                  onChangeRepeatMode={handleNextRepeatMode}
                />
              </div>
              <div className="np-actions">
                <button type="button" className={`np-icon ${liked ? 'is-on' : ''}`} onClick={() => toggleLike(currentTrack)} aria-pressed={liked} title={liked ? t('Убрать из любимых', 'Remove from liked') : t('В любимые', 'Like')}><PlayerIcon name="like" size={22} /></button>
                <div className="np-menu-wrap">
                  <button type="button" className="np-icon" onClick={() => setShowPlaylistMenu(!showPlaylistMenu)} aria-expanded={showPlaylistMenu} title={t('Добавить в плейлист', 'Add to playlist')}><PlayerIcon name="add" size={19} /></button>
                  {showPlaylistMenu && <div className="np-menu" role="menu">
                    <span>{t('Добавить в плейлист', 'Add to playlist')}</span>
                    {playlistList.length === 0 ? <em>{t('Нет плейлистов', 'No playlists')}</em> : playlistList.map(pl => <button type="button" role="menuitem" key={pl.id} onClick={async () => { setShowPlaylistMenu(false); await addTrackToPlaylist(pl.id, currentTrack); }}>{pl.title}</button>)}
                  </div>}
                </div>
                <DevicesButton className="np-icon" />
                <JamButton className="np-icon np-jam-live" />
                <SleepIndicator onOpen={() => setMediaOpen(true)} />
                <NpMore onInfo={() => setShowInfo(true)} onSound={() => setMediaOpen(true)} onReport={() => useReportStore.getState().open({ track: currentTrack, kind: 'playback' })}
                  source={<PlaybackSourcePicker track={currentTrack} value={source} appliesNow onChange={v => { setSource(v); setPreferredSource(v, currentTrack.id); const at = audioManager.getCurrentTime(); void usePlayerStore.getState().playTrack(currentTrack, v).then(() => { if (at > 1&&usePlayerStore.getState().currentTrack?.id===currentTrack.id) usePlayerStore.getState().seek(at); }); }} />}
                  telegram={<TelegramTrackButton key={currentTrack.id} track={currentTrack}/>} />
                <div className="np-volume"><LiveVolume /></div>
              </div>
              <div className="np-meta">
                <SourceBadge track={currentTrack} detailed/>
              </div>
            </div>

            {/* Right Column: Seamless Borderless Synchronized Karaoke Lyrics */}
            <div ref={lyricsPanelRef} id="full-player-lyrics" role={isMobile?'tabpanel':undefined} aria-labelledby={isMobile?'mobile-player-lyrics-tab':undefined} aria-hidden={isMobile&&mobileView!=='lyrics'} className="interference-text np-lyrics">
              <LyricsBoundary resetKey={currentTrack.id}>
                <LyricsView
                  enabled={!isMobile||mobileView==='lyrics'}
                  trackId={currentTrack.id}
                  trackName={currentTrack.title}
                  artistName={artistName}
                  duration={duration || currentTrack.duration}
                  currentTime={0}
                  onSeek={seek}
                />
              </LyricsBoundary>
            </div>
          </div>
          <MediaSettingsPanel open={mediaOpen} onClose={() => setMediaOpen(false)}/>
          <TrackInfoDialog track={currentTrack} isOpen={showInfo} onClose={()=>setShowInfo(false)}/>
          <TrackArtistsPopup track={currentTrack} open={showArtists} onClose={()=>setShowArtists(false)}/>
          </DarkPlayerSurface.Provider>
        </motion.div>
  ) : null}</AnimatePresence>;
};

function LiveProgressBar(){
 const currentTime=usePlayerStore(s=>s.currentTime),duration=usePlayerStore(s=>s.duration),seek=usePlayerStore(s=>s.seek);
 return <ProgressBar currentTime={currentTime} duration={duration} onSeek={seek}/>;
}

function LiveVolume(){const p=usePlayerStore(useShallow(s=>({volume:s.volume,isMuted:s.isMuted,setVolume:s.setVolume,toggleMute:s.toggleMute})));return <VolumeControl volume={p.volume} isMuted={p.isMuted} onVolumeChange={p.setVolume} onToggleMute={p.toggleMute}/>;}

/** Moon in the player row while the sleep timer runs; opens the «Звук» panel where it is set. */
function SleepIndicator({ onOpen }: { onOpen: () => void }) {
  const t = useTranslation();
  const on = useSleepTimer(sleepTimerActive);
  if (!on) return null;
  return <button type="button" className="np-icon is-on-sleep" onClick={onOpen} aria-label={t('Таймер сна включён', 'Sleep timer on')} title={t('Таймер сна включён', 'Sleep timer on')}><Moon size={18}/></button>;
}

/** «⋯» in Интерференция: what is not needed every minute — track info, sound, source, Jam, Telegram, report. */
function NpMore({ onInfo, onSound, onReport, source, telegram }: { onInfo: () => void; onSound: () => void; onReport: () => void; source: React.ReactNode; telegram: React.ReactNode }) {
  const t = useTranslation(), [open, setOpen] = React.useState(false), root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const item = (fn: () => void) => () => { setOpen(false); fn(); };
  return <div className="np-more" ref={root}>
    <button type="button" className="np-icon" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu" title={t('Ещё', 'More')} aria-label={t('Ещё', 'More')}><MoreHorizontal size={20} /></button>
    {open && <div className="np-more__menu" role="menu">
      <button type="button" role="menuitem" onClick={item(onInfo)}><Info size={16} /><span>{t('О треке', 'About the track')}</span></button>
      <button type="button" role="menuitem" onClick={item(onSound)}><SlidersHorizontal size={16} /><span>{t('Звук, эффекты, таймер сна', 'Sound, effects, sleep timer')}</span></button>
      <div className="np-more__row"><span>{t('Источник звука', 'Audio source')}</span>{source}</div>
      <button type="button" role="menuitem" onClick={item(openJamPanel)}><UsersRound size={16} /><span>{t('Jam — слушать с друзьями', 'Jam — listen with friends')}</span></button>
      <div className="np-more__row np-more__telegram">{telegram}</div>
      <button type="button" role="menuitem" onClick={item(onReport)}><Flag size={16} /><span>{t('Сообщить о проблеме', 'Report a problem')}</span></button>
    </div>}
  </div>;
}
