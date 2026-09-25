import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Play,
  ListPlus,
  ListOrdered,
  Heart,
  PlusCircle,
  Plus,
  ListMusic,
  Trash2,
  ExternalLink,
  User,
  Music,
  Download,
  ChevronRight,
} from 'lucide-react';
import { Track } from '../../types/index.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useLibraryStore } from '../../stores/useLibraryStore.js';
import { usePlaylistStore } from '../../stores/usePlaylistStore.js';
import { useToastStore } from '../../stores/useToastStore.js';
import {apiClient} from '../../api/apiClient.js';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

interface TrackContextMenuProps {
  track: Track;
  position: ContextMenuPosition | null;
  onClose: () => void;
  playlistId?: string; // Provided if inside a playlist context
}

export const TrackContextMenu: React.FC<TrackContextMenuProps> = ({
  track,
  position,
  onClose,
  playlistId,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { playNow, playNext, addToQueue } = usePlayerStore();
  const { isLiked, toggleLike } = useLibraryStore();
  const { playlists, fetchPlaylists, createPlaylist, addTrackToPlaylist, removeTrackFromPlaylist } = usePlaylistStore();
  const { addToast } = useToastStore();

  const [showPlaylistSubmenu, setShowPlaylistSubmenu] = useState(false);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const liked = isLiked(track.id);

  const handleSubmenuEnter = () => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current);
      submenuTimeoutRef.current = null;
    }
    setShowPlaylistSubmenu(true);
  };

  const handleSubmenuLeave = () => {
    if (!isCreatingPlaylist) {
      submenuTimeoutRef.current = setTimeout(() => {
        setShowPlaylistSubmenu(false);
      }, 300);
    }
  };

  useEffect(() => {
    return () => {
      if (submenuTimeoutRef.current) {
        clearTimeout(submenuTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (playlists.length === 0) {
      fetchPlaylists();
    }
  }, [fetchPlaylists, playlists.length]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (position) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [position, onClose]);

  if (!position) return null;

  // Viewport bounds calculation
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const menuW = 220;
  const menuH = 340;

  const left = position.x + menuW > screenW ? Math.max(10, position.x - menuW) : position.x;
  const top = position.y + menuH > screenH ? Math.max(10, position.y - menuH) : position.y;
  const openSubmenuLeft = left + menuW + 220 > screenW;

  const handlePlayNow = async () => {
    onClose();
    await playNow(track);
  };

  const handlePlayNext = () => {
    onClose();
    playNext(track);
  };

  const handleAddToQueue = () => {
    onClose();
    addToQueue(track);
  };

  const handleToggleLike = async () => {
    onClose();
    await toggleLike(track);
  };

  const handleRemoveFromPlaylist = async () => {
    if (playlistId) {
      onClose();
      await removeTrackFromPlaylist(playlistId, track.id);
    }
  };

  const handleOpenTrack = () => {
    onClose();
    navigate(`/track/${encodeURIComponent(track.id)}`);
  };

  const handleOpenArtist = () => {
    onClose();
    navigate(`/artist/${encodeURIComponent(track.artist.id)}`);
  };

  const handleOpenSoundCloud = () => {
    onClose();
    if (track.trackUrl) {
      window.open(track.trackUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDownload = () => {
    onClose();
    if (track.downloadable && track.streamUrl) {
      window.open(track.streamUrl, '_blank');
    } else {
      addToast('Скачивание недоступно для этого трека', 'warning');
    }
  };

  return (
    <div
      ref={menuRef}
      style={{ left: `${left}px`, top: `${top}px` }}
      className="fixed z-50 min-w-[220px] bg-white/95 dark:bg-[#0c1320]/95 backdrop-blur-xl border border-blue-100 dark:border-slate-800 rounded-xl shadow-2xl p-1.5 text-sm font-medium text-[#162b50] dark:text-slate-200 animate-in fade-in zoom-in-95 duration-100"
    >
      <button
        onClick={handlePlayNow}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-blue-50/70 dark:hover:bg-slate-800/80 hover:text-blue-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
      >
        <Play size={16} className="text-[#7188a3] dark:text-slate-400" />
        <span>Воспроизвести</span>
      </button>

      <button
        onClick={handlePlayNext}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-blue-50/70 dark:hover:bg-slate-800/80 hover:text-blue-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
      >
        <ListOrdered size={16} className="text-[#7188a3] dark:text-slate-400" />
        <span>Воспроизвести следующим</span>
      </button>

      <button
        onClick={handleAddToQueue}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-blue-50/70 dark:hover:bg-slate-800/80 hover:text-blue-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
      >
        <ListPlus size={16} className="text-[#7188a3] dark:text-slate-400" />
        <span>Добавить в очередь</span>
      </button>

      <div className="my-1 border-t border-blue-100/70 dark:border-slate-800" />

      <button onClick={()=>{onClose();void apiClient.request('/profile/music',{method:'POST',body:JSON.stringify({trackId:track.id})}).then(()=>addToast('Трек добавлен в профиль','success')).catch(e=>addToast(e.message,'warning'));}} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-blue-50/70 dark:hover:bg-slate-800/80 text-left"><User size={16}/><span>В профиль</span></button>

      <button
        onClick={handleToggleLike}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-blue-50/70 dark:hover:bg-slate-800/80 hover:text-blue-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
      >
        <Heart size={16} className={liked ? 'text-red-500 fill-red-500' : 'text-[#7188a3] dark:text-slate-400'} />
        <span>{liked ? 'Удалить из Избранного' : 'Добавить в Избранное'}</span>
      </button>

      <div
        className="relative"
        onMouseEnter={handleSubmenuEnter}
        onMouseLeave={handleSubmenuLeave}
      >
        <button
          type="button"
          onClick={() => setShowPlaylistSubmenu((prev) => !prev)}
          className={clsx(
            'w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg transition-colors text-left cursor-pointer',
            showPlaylistSubmenu
              ? 'bg-blue-50 dark:bg-sky-500/15 text-blue-600 dark:text-sky-300'
              : 'hover:bg-blue-50/70 dark:hover:bg-slate-800/80 hover:text-blue-600 dark:hover:text-sky-400 text-[#162b50] dark:text-slate-200'
          )}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <PlusCircle size={16} className="text-[#7188a3] dark:text-slate-400 shrink-0" />
            <span className="truncate">Добавить в плейлист</span>
          </div>
          <ChevronRight
            size={14}
            className={clsx(
              'text-[#7188a3] dark:text-slate-400 shrink-0 transition-transform',
              openSubmenuLeft ? '-scale-x-100' : ''
            )}
          />
        </button>

        {showPlaylistSubmenu && (
          <div
            onMouseEnter={handleSubmenuEnter}
            onMouseLeave={handleSubmenuLeave}
            className={clsx(
              'absolute top-0 min-w-[210px] max-w-[240px] bg-white/95 dark:bg-[#0c1320]/95 backdrop-blur-xl border border-blue-100 dark:border-slate-800 rounded-xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100',
              openSubmenuLeft ? 'right-[calc(100%+4px)]' : 'left-[calc(100%+4px)]'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Invisible hover bridge to prevent mouse-leave gaps */}
            <div
              className={clsx(
                'absolute top-0 bottom-0 w-3 pointer-events-auto',
                openSubmenuLeft ? '-right-3' : '-left-3'
              )}
            />
            {isCreatingPlaylist ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const trimmed = newPlaylistTitle.trim();
                  if (!trimmed || isSubmitting) return;
                  setIsSubmitting(true);
                  try {
                    const newPl = await createPlaylist(trimmed);
                    if (newPl) {
                      await addTrackToPlaylist(newPl.id, track);
                    }
                    onClose();
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                className="p-1"
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Название..."
                    value={newPlaylistTitle}
                    onChange={(e) => setNewPlaylistTitle(e.target.value)}
                    className="w-full bg-zinc-900 border border-border rounded-lg px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand-500"
                  />
                  <button
                    type="submit"
                    disabled={!newPlaylistTitle.trim() || isSubmitting}
                    className="px-2.5 py-1 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-bold rounded-lg text-xs shrink-0 transition-colors"
                  >
                    +
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCreatingPlaylist(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800 text-sky-400 hover:text-sky-300 transition-colors text-xs font-medium text-left"
              >
                <Plus size={14} className="shrink-0" />
                <span>Новый плейлист</span>
              </button>
            )}

            <div className="my-1 border-t border-blue-100/70 dark:border-slate-800" />

            <div className="max-h-[220px] overflow-y-auto space-y-0.5 custom-scrollbar">
              {playlists.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[#7188a3] dark:text-slate-500 text-center">Нет созданных плейлистов</div>
              ) : (
                playlists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={async () => {
                      onClose();
                      await addTrackToPlaylist(pl.id, track);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-blue-50/70 dark:hover:bg-slate-800/70 transition-colors text-xs text-left group cursor-pointer"
                  >
                    <ListMusic size={14} className="text-[#7188a3] dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-sky-400 shrink-0" />
                    <span className="truncate flex-1 text-[#162b50] dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-sky-400 font-normal">{pl.title}</span>
                    <span className="text-[10px] text-[#7188a3] dark:text-slate-500 shrink-0">
                      {pl.trackCount ?? (pl.tracks ? pl.tracks.length : 0)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {playlistId && !playlistId.startsWith('soundcloud:') && !playlistId.startsWith('spotify:') && (
        <button
          onClick={handleRemoveFromPlaylist}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-500 transition-colors text-left cursor-pointer"
        >
          <Trash2 size={16} />
          <span>Удалить из плейлиста</span>
        </button>
      )}

      <div className="my-1 border-t border-blue-100/70 dark:border-slate-800" />

      <button
        onClick={handleOpenTrack}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-blue-50/70 dark:hover:bg-slate-800/80 hover:text-blue-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
      >
        <Music size={16} className="text-[#7188a3] dark:text-slate-400" />
        <span>Открыть страницу трека</span>
      </button>

      <button
        onClick={handleOpenArtist}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-blue-50/70 dark:hover:bg-slate-800/80 hover:text-blue-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
      >
        <User size={16} className="text-[#7188a3] dark:text-slate-400" />
        <span>Перейти к исполнителю</span>
      </button>

      {track.trackUrl && (
        <button
          onClick={handleOpenSoundCloud}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:text-amber-600 dark:hover:text-amber-400 transition-colors text-left cursor-pointer"
        >
          <ExternalLink size={16} className="text-amber-500" />
          <span>Открыть в SoundCloud</span>
        </button>
      )}

      {track.downloadable && (
        <button
          onClick={handleDownload}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors text-left cursor-pointer"
        >
          <Download size={16} className="text-emerald-500" />
          <span>Скачать</span>
        </button>
      )}
    </div>
  );
};
