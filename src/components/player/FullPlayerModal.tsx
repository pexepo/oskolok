import React from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown, Heart, PlusCircle, Music2 } from 'lucide-react';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useLibraryStore } from '../../stores/useLibraryStore.js';
import { usePlaylistStore } from '../../stores/usePlaylistStore.js';
import { ArtworkImage } from '../common/ArtworkImage.js';
import { PlayerControls } from './PlayerControls.js';
import { ProgressBar } from './ProgressBar.js';
import { LyricsView } from '../lyrics/LyricsView.js';
import { formatDisplayTitle } from '../../utils/formatTrack.js';
import { GradientWave } from '../ui/gradient-wave.js';
import { TelegramTrackButton } from '../telegram/TelegramTrackButton.js';
import { SourceBadge } from '../tracks/SourceBadge.js';
import { useThemeStore } from '../../stores/useThemeStore.js';

export const FullPlayerModal: React.FC = () => {
  const { isDark } = useThemeStore();
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    currentTime,
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
  } = usePlayerStore();

  const { isLiked, toggleLike } = useLibraryStore();
  const { playlists, addTrackToPlaylist } = usePlaylistStore();
  const [showPlaylistMenu, setShowPlaylistMenu] = React.useState(false);
  const [lyricsExpanded, setLyricsExpanded] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(() => window.matchMedia('(max-width: 700px)').matches);

  const liked = currentTrack ? isLiked(currentTrack.id) : false;
  const artistName = currentTrack?.artist?.name || 'Неизвестный исполнитель';
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
  }, [isFullPlayerOpen, isDark]);

  const playlistList = Array.isArray(playlists) ? playlists : [];
  const modalRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (isFullPlayerOpen) {
      setLyricsExpanded(false);
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

  return isFullPlayerOpen && currentTrack ? (
        <div
          ref={modalRef}
          key="full-player-modal"
          role="dialog" aria-modal="true" aria-label="Полноэкранный плеер"
          className="interference-modal fixed inset-0 z-50 bg-[#f0f4f9] dark:bg-[#070c14] flex flex-col justify-between p-6 md:p-8 select-none overflow-hidden text-[#162b50] dark:text-slate-100 transition-colors duration-300"
        >
          <GradientWave artworkUrl={currentTrack.artworkUrl} isPlaying={isPlaying && !isBuffering} isDark={isDark}/>

          {/* Header Bar */}
          <div
            style={{ WebkitAppRegion: 'drag' } as any}
            className="flex items-center justify-between pb-3 shrink-0 pr-0 md:pr-36 relative z-10"
          >
            <button
              onClick={() => setFullPlayerOpen(false)}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              className="flex items-center gap-2 text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-white transition-colors group px-3 py-2 rounded-xl hover:bg-white/60 dark:hover:bg-slate-800/60 cursor-pointer"
              title="Свернуть плеер"
            >
              <ChevronDown size={22} className="group-hover:-translate-y-0.5 transition-transform" />
              <span className="text-xs font-bold uppercase tracking-wider">Свернуть</span>
            </button>
            <div className="interference-title" aria-hidden="true" />
          </div>

          {/* 2-Column Main Layout matching Yandex Music */}
          <div className="interference-main relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center min-h-0 py-2 overflow-hidden">
            {/* Left Column: Artwork, Info, Scrub Bar, Controls */}
            <div className="interference-track lg:col-span-5 flex flex-col items-center justify-center max-w-sm sm:max-w-md w-full mx-auto space-y-4 shrink-0">
              {/* Album Artwork */}
              <div className="relative w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80 lg:w-[340px] lg:h-[340px] rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(22,43,80,0.16)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.8)] border border-white/60 dark:border-slate-800 group">
                <ArtworkImage
                  src={currentTrack.artworkUrl}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover"
                  iconSize={88}
                />
              </div>

              {/* Track Title, Artist, and Actions */}
              <div className="w-full space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <h2
                    className="text-xl sm:text-2xl md:text-3xl font-black text-[#162b50] dark:text-slate-100 truncate tracking-tight flex-1"
                    title={displayTitle}
                  >
                    {displayTitle}
                  </h2>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => toggleLike(currentTrack)}
                      className="p-2 rounded-xl text-[#5a6e85] dark:text-slate-400 hover:text-red-500 transition-colors"
                      title={liked ? 'Удалить из Избранного' : 'Добавить в Избранное'}
                    >
                      <Heart size={20} className={liked ? 'text-red-500 fill-red-500' : ''} />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setShowPlaylistMenu(!showPlaylistMenu)}
                        className="p-2 rounded-xl text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-white transition-colors"
                        title="Добавить в плейлист"
                      >
                        <PlusCircle size={20} />
                      </button>
                      {showPlaylistMenu && (
                        <div className="absolute right-0 bottom-full mb-2 w-48 bg-white/95 dark:bg-[#0c1320]/95 backdrop-blur-xl border border-blue-100/80 dark:border-slate-800 rounded-2xl shadow-xl p-2 z-50 text-left">
                          <div className="text-xs font-bold text-[#5a6e85] dark:text-slate-400 px-2 py-1 mb-1">
                            Добавить в плейлист:
                          </div>
                          {playlistList.length === 0 ? (
                            <div className="text-xs text-[#8ea2ba] dark:text-slate-500 px-2 py-1">Нет плейлистов</div>
                          ) : (
                            playlistList.map((pl) => (
                              <button
                                key={pl.id}
                                onClick={async () => {
                                  setShowPlaylistMenu(false);
                                  await addTrackToPlaylist(pl.id, currentTrack);
                                }}
                                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-800 text-xs truncate text-[#162b50] dark:text-slate-200 font-medium"
                              >
                                {pl.title}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {artistId ? (
                  <NavLink
                    to={`/artist/${encodeURIComponent(artistId)}`}
                    onClick={() => setFullPlayerOpen(false)}
                    className="text-sm sm:text-base font-semibold text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-sky-400 hover:underline truncate block"
                    title={artistName}
                  >
                    {artistName}
                  </NavLink>
                ) : (
                  <span className="text-sm sm:text-base font-semibold text-[#5a6e85] dark:text-slate-400 truncate block">
                    {artistName}
                  </span>
                )}
              </div>

              <SourceBadge track={currentTrack} detailed/>
              <TelegramTrackButton key={currentTrack.id} track={currentTrack}/>
              {/* Scrub Bar right below artist */}
              <div className="w-full">
                <ProgressBar currentTime={currentTime} duration={duration} onSeek={seek} />
              </div>

              {/* Player Controls Deck */}
              <div className="flex justify-center w-full pt-1">
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
            </div>

            <button
              className="mobile-lyrics-toggle"
              type="button"
              aria-expanded={lyricsExpanded}
              aria-controls="full-player-lyrics"
              onClick={() => setLyricsExpanded(value => !value)}
            >
              <span><Music2 size={18}/> Текст песни</span>
              <ChevronDown size={19} className={lyricsExpanded ? 'rotate-180' : ''}/>
            </button>

            {/* Right Column: Seamless Borderless Synchronized Karaoke Lyrics */}
            <div id="full-player-lyrics" className={`interference-text lg:col-span-7 h-full flex-1 flex flex-col justify-center overflow-hidden min-h-0 px-2 lg:px-8 ${lyricsExpanded ? 'is-expanded' : ''}`}>
              {(!isMobile || lyricsExpanded) && <LyricsView
                trackId={currentTrack.id}
                trackName={currentTrack.title}
                artistName={artistName}
                duration={duration || currentTrack.duration}
                currentTime={currentTime}
                onSeek={seek}
              />}
            </div>
          </div>
        </div>
  ) : null;
};
