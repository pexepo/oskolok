import {TrackInfoDialog} from '../tracks/TrackInfoDialog.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {VolumeControl} from './VolumeControl.js';
import {useShallow} from 'zustand/react/shallow';
import React from 'react';
import { NavLink } from 'react-router-dom';
import { Columns2, TextQuote, Disc3 } from 'lucide-react';
import { coverAccent } from './coverAccent.js';
import { useCoverTilt } from './useCoverTilt.js';
import { paletteFromArtwork } from '../../utils/releasePalette.js';
import { scopedStorageKey } from '../../telegram/runtime.js';
import { ChevronDown, Info, Music2, SlidersHorizontal, Moon, MoreHorizontal, UsersRound, Flag, Sparkles, Play, Pause } from 'lucide-react';
import { openJamPanel } from '../../connect/jam.js';
import { DevicesButton } from '../connect/ConnectLayer.js';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { JamButton } from '../connect/JamLayer.js';
import { useSleepTimer, sleepTimerActive } from '../../audio/sleepTimer.js';
import { MediaSettingsPanel } from './MediaSettingsPanel.js';
import { PlaybackSourcePicker, PORTALED_MENU_CHILDREN } from '../tracks/PlaybackSourcePicker.js';
import { LikeBurst } from '../common/LikeBurst.js';
import { NotesSlotContext } from '../lyrics/notesSlot.js';

/** Type size of the lyric lines right now (0 when there are none). */

/** Pieces of the player that move between the full and the notes layout. */
const FLIP_PARTS = '.np-art, .np-heading, .np-progress, .np-controls';
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
  const artRef = React.useRef<HTMLDivElement>(null);
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
  // Controls take the cover's colour instead of the app blue; the variables are registered, so they glide between tracks.
  const [accent, setAccent] = React.useState(() => coverAccent([]));
  React.useEffect(() => { let live = true; void paletteFromArtwork(currentTrack?.artworkUrl).then(p => { if (live) setAccent(coverAccent(p)); }); return () => { live = false; }; }, [currentTrack?.artworkUrl]);
  useCoverTilt(artRef, isFullPlayerOpen && !!currentTrack);
  const [notesSlot, setNotesSlot] = React.useState<HTMLDivElement | null>(null), [notesOpen, setNotesOpen] = React.useState(false);
  // Notes open/close re-lays the player out once; FLIP then carries the track pieces from where they were (transform only):
  // the cover column folds into a header above the notes. The lyrics stay put — the explained line is where it was read.
  // «Только текст» / «Только обложка»: the listener picks how much of Интерференция to see; remembered between visits.
  type Focus = 'split' | 'lyrics' | 'cover';
  const [focus, setFocusState] = React.useState<Focus>(() => { try { const v = localStorage.getItem(scopedStorageKey('np-focus')); return v === 'lyrics' || v === 'cover' ? v : 'split'; } catch { return 'split'; } });
  const captureFlip = () => {
    const root = modalRef.current;
    if (!root || !window.matchMedia('(min-width: 701px)').matches) return;
    const from = new Map<HTMLElement, DOMRect>();
    root.querySelectorAll<HTMLElement>(FLIP_PARTS).forEach(el => from.set(el, el.getBoundingClientRect()));
    flipFrom.current = from;
  };
  const setFocus = (next: Focus) => {
    if (next === focus) return;
    captureFlip(); setFocusState(next);
    try { localStorage.setItem(scopedStorageKey('np-focus'), next); } catch { /* private mode */ }
  };
  const reduceMotionRef = React.useRef(reduceMotion); reduceMotionRef.current = reduceMotion;
  const captureFlipRef = React.useRef(() => {});
  const notesOpenRef = React.useRef(false), flipFrom = React.useRef<Map<HTMLElement, DOMRect> | null>(null);
  const setNotesOpenFlip = React.useCallback((open: boolean) => {
    if (open === notesOpenRef.current) return;
    notesOpenRef.current = open;
    const root = modalRef.current;
    const relayout = () => {
      if (notesOpenRef.current !== open) return;
      captureFlipRef.current();
      setNotesOpen(open);
    };
    // Closing: the notes leave first (exit quieter than enter), then the cover unfolds into the space they free.
    const slot = root?.querySelector<HTMLElement>('.np-layout.notes-open > .np-notes-slot');
    if (!open && slot && !reduceMotionRef.current) {
      const exit = slot.animate([{ opacity: 1 }, { opacity: 0, transform: 'translate3d(0, 8px, 0)' }], { duration: 150, easing: 'ease-in', fill: 'forwards' });
      const after = () => { relayout(); exit.cancel(); };
      // A timer, not `exit.finished`: a background tab may hold the animation clock and the notes would never close.
      window.setTimeout(after, 150);
    }
    else relayout();
  }, []);
  React.useLayoutEffect(() => {
    const from = flipFrom.current; flipFrom.current = null;
    if (!from || reduceMotion) return;
    const timing = { duration: 380, easing: 'cubic-bezier(.32, .72, 0, 1)' };
    from.forEach((first, el) => {
      const last = el.getBoundingClientRect();
      if (!el.isConnected || !first.width || !last.width || !last.height) return;
      const dx = first.left - last.left, dy = first.top - last.top;
      // Only the artwork scales (uniformly); text would smear, the scrub bar stretches along its length only.
      if (el.matches('.np-art')) el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${first.width / last.width})`, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], timing);
      else if (el.matches('.np-progress')) el.animate([{ transform: `translate(${dx}px, ${dy}px) scaleX(${first.width / last.width})`, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], timing);
      else el.animate([{ transform: `translate(${dx}px, ${dy}px)`, opacity: .4 }, { transform: 'none', opacity: 1 }], timing);
    });
    // The column clips its content; while pieces travel nothing may be cut off.
    const layout = modalRef.current?.querySelector<HTMLElement>('.np-layout');
    layout?.classList.add('is-flipping');
    const done = setTimeout(() => layout?.classList.remove('is-flipping'), timing.duration + 40);
    return () => { clearTimeout(done); layout?.classList.remove('is-flipping'); };
  }, [notesOpen, focus, reduceMotion]);
  captureFlipRef.current = captureFlip;
  // The lyrics re-wrap to a new width when the view changes: they fade in place instead of jumping.
  const focusSeen = React.useRef(focus);
  React.useLayoutEffect(() => {
    if (focusSeen.current === focus) return;
    focusSeen.current = focus;
    if (!reduceMotion) modalRef.current?.querySelector<HTMLElement>('.np-lyrics > .interference-lyrics')?.animate([{ opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'none' }], { duration: 280, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }, [focus, reduceMotion]);
  const notesHost = React.useMemo(() => ({ slot: notesSlot, setOpen: setNotesOpenFlip }), [notesSlot, setNotesOpenFlip]);

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
          style={{ '--np-accent': accent.color, '--np-hue': `${accent.hue}deg`, '--np-sat': accent.sat } as React.CSSProperties}
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
            <div className="np-focus" role="group" aria-label={t('Что показывать', 'What to show')} style={{ WebkitAppRegion: 'no-drag' } as any}>
              {([['lyrics', TextQuote, t('Только текст', 'Lyrics only')], ['split', Columns2, t('Текст и обложка', 'Lyrics and cover')], ['cover', Disc3, t('Только обложка', 'Cover only')]] as const).map(([value, Icon, label]) =>
                <button key={value} type="button" aria-pressed={focus === value} title={label} aria-label={label} onClick={() => setFocus(value)}><Icon size={17} /></button>)}
            </div>
          </div>

          <div className="mobile-player-tabs" role="tablist" aria-label={t('Экран трека', 'Track view')} data-view={mobileView}>
            <span className="mobile-player-tabs-indicator" aria-hidden="true"/>
            <button type="button" role="tab" id="mobile-player-info-tab" aria-selected={mobileView==='info'} aria-controls="mobile-player-info" onClick={() => setMobileView('info')}><Info size={17}/> {t('Инфо', 'Info')}</button>
            <button type="button" role="tab" id="mobile-player-lyrics-tab" aria-selected={mobileView==='lyrics'} aria-controls="full-player-lyrics" onClick={() => setMobileView('lyrics')}><Music2 size={17}/> {t('Текст', 'Lyrics')}</button>
          </div>

          {/* The same mounted panels crossfade on phones; lyrics keep their timing state. */}
          <NotesSlotContext.Provider value={notesHost}>
          <div className={`interference-main np-layout view-${mobileView} focus-${focus}${notesOpen ? ' notes-open' : ''} relative z-10 flex-1 min-h-0 overflow-hidden`}>
            {/* Genius notes dock here (left), the track shrinks to the top right and the lyrics sit under it. */}
            <div ref={setNotesSlot} className="np-notes-slot interference-lyrics lyrics-v3" />
            {/* Cover column: artwork, scrub bar, title — then our controls (Apple-style "now playing"). */}
            <div ref={trackPanelRef} id="mobile-player-info" role={isMobile?'tabpanel':undefined} aria-labelledby={isMobile?'mobile-player-info-tab':undefined} aria-hidden={isMobile&&mobileView!=='info'} className="interference-track np-panel">
              <div className="np-art" ref={artRef}>
                <ArtworkImage key={currentTrack.artworkUrl} src={currentTrack.artworkUrl} alt={currentTrack.title} className="w-full h-full np-art-image" iconSize={88} />
                <span className="np-holo" aria-hidden="true" />
              </div>
              <div className="np-progress"><LiveProgressBar /></div>
              <div className="np-heading" key={currentTrack.id}>
                <h2 title={displayTitle}><NavLink to={currentTrack.release?.id ? `/release/${encodeURIComponent(currentTrack.release.id)}` : `/track/${encodeURIComponent(currentTrack.id)}`} onClick={() => setFullPlayerOpen(false)} className="np-title-link">{displayTitle}</NavLink></h2>
                <button type="button" className="np-artists" onClick={() => setShowArtists(true)} title={t('Исполнители трека', 'Track artists')} aria-haspopup="dialog">{artistName}</button>
                {/* Why the wave played this: people asked for it instead of a silent algorithm. */}
                {currentTrack.recommendationReason && <span className="np-reason" title={t('Почему этот трек', 'Why this track')}><Sparkles size={12} aria-hidden="true" />{currentTrack.recommendationReason}</span>}
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
                <button type="button" className={`np-icon ${liked ? 'is-on' : ''}`} onClick={() => toggleLike(currentTrack)} aria-pressed={liked} title={liked ? t('Убрать из любимых', 'Remove from liked') : t('В любимые', 'Like')} style={{ position: 'relative' }}><PlayerIcon name="like" size={22} /><LikeBurst liked={liked} /></button>
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
              {/* Phones, «Текст»: the track stays on screen as one compact row above the lyrics. */}
              {isMobile && <div className="np-mini">
                <button type="button" className="np-mini__art" onClick={() => setMobileView('info')} aria-label={t('Показать трек', 'Show track')}><ArtworkImage src={currentTrack.artworkUrl} alt="" className="w-full h-full" iconSize={20} /></button>
                <button type="button" className="np-mini__text" onClick={() => setMobileView('info')}><b>{displayTitle}</b><span>{artistName}</span></button>
                <button type="button" className={`np-icon np-mini__btn ${liked ? 'is-on' : ''}`} onClick={() => toggleLike(currentTrack)} aria-pressed={liked} aria-label={liked ? t('Убрать из любимых', 'Remove from liked') : t('В любимые', 'Like')}><PlayerIcon name="like" size={19} /></button>
                <button type="button" className="np-icon np-mini__btn" onClick={togglePlay} aria-label={isPlaying ? t('Пауза', 'Pause') : t('Слушать', 'Play')}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
              </div>}
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
          </NotesSlotContext.Provider>
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
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node) && !(e.target as Element).closest?.(PORTALED_MENU_CHILDREN)) setOpen(false); };
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
