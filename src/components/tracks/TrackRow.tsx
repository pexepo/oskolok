import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Play, Pause, Heart, MoreHorizontal, Radio } from 'lucide-react';
import { clsx } from 'clsx';
import { Track } from '../../types/index.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useLibraryStore } from '../../stores/useLibraryStore.js';
import { formatTime } from '../../utils/formatters.js';
import { ArtworkImage } from '../common/ArtworkImage.js';
import { TrackContextMenu, ContextMenuPosition } from '../common/TrackContextMenu.js';
import { formatDisplayTitle } from '../../utils/formatTrack.js';
import { SourceBadge } from './SourceBadge.js';
import { apiClient } from '../../api/apiClient.js';
import {PlaybackSourcePicker} from './PlaybackSourcePicker.js';

interface TrackRowProps {
  track: Track;
  index?: number;
  playlistId?: string;
  collection?: Track[];
}

export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  index,
  playlistId,
  collection,
}) => {
  const { currentTrack, isPlaying, playTrack, playCollection, togglePlay } = usePlayerStore();
  const { isLiked, toggleLike } = useLibraryStore();
  const [contextMenuPos, setContextMenuPos] = useState<ContextMenuPosition | null>(null);

  const isCurrent = currentTrack?.id === track.id;
  const liked = isLiked(track.id);
  const [source,setSource]=useState('auto');
  const isPlayable = track.access !== 'blocked' && track.access !== 'unavailable';

  const handlePlayClick = async () => {
    if (!isPlayable) return;
    if (isCurrent) {
      togglePlay();
    } else if (collection && collection.length > 0 && index !== undefined) {
      await playCollection(collection, index);
    } else {
      await playTrack(track);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        onContextMenu={handleContextMenu}
        onMouseEnter={() => {
          apiClient.prefetchTrack(track.id).catch(() => {});
        }}
        className={clsx(
          'track-row group flex items-center justify-between gap-3 px-3 py-2 rounded-xl transition-all duration-150 select-none',
          isCurrent
            ? 'bg-blue-50/70 dark:bg-sky-500/15 text-blue-600 dark:text-sky-300'
            : 'hover:bg-blue-50/40 dark:hover:bg-slate-800/50'
        )}
      >
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          {/* Index / Play Button */}
          <div className="w-6 text-center text-xs font-semibold text-[#7188a3] dark:text-slate-400 shrink-0">
            {index !== undefined && (
              <span className={clsx(isCurrent ? 'hidden' : 'group-hover:hidden')}>
                {index + 1}
              </span>
            )}
            <button
              aria-label={`${isCurrent && isPlaying ? 'Пауза' : 'Слушать'} ${track.title}`}
              onClick={handlePlayClick}
              disabled={!isPlayable}
              className={clsx(
                'items-center justify-center p-1.5 rounded-full transition-transform cursor-pointer',
                isCurrent
                  ? 'flex bg-blue-600 dark:bg-sky-500 text-white dark:text-slate-950 shadow-xs'
                  : 'hidden group-hover:flex bg-blue-600 dark:bg-sky-500 text-white dark:text-slate-950 hover:scale-105'
              )}
            >
              {isCurrent && isPlaying ? (
                <Pause size={13} className="fill-current" />
              ) : (
                <Play size={13} className="fill-current ml-0.5" />
              )}
            </button>
          </div>

          {/* Artwork & Info */}
          <ArtworkImage src={track.artworkUrl} alt={track.title} className="w-10 h-10 rounded-lg shrink-0 object-cover shadow-xs" />

          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-2 min-w-0">
              <span
                onClick={handlePlayClick}
                className={clsx(
                  'font-medium text-sm truncate block min-w-0 flex-1 cursor-pointer hover:underline',
                  isCurrent ? 'text-blue-600 dark:text-sky-300 font-semibold' : 'text-[#162b50] dark:text-slate-200'
                )}
                title={formatDisplayTitle(track.title, track.artist.name)}
              >
                {formatDisplayTitle(track.title, track.artist.name)}
              </span>
            </div>

            <NavLink
              to={`/artist/${encodeURIComponent(track.artist.id)}`}
              className="text-xs text-[#5a6e85] dark:text-slate-400 hover:text-blue-600 dark:hover:text-sky-400 hover:underline truncate block w-full"
              title={track.artist.name}
            >
              {track.artist.name}
            </NavLink>
            <SourceBadge track={track}/>
            {track.release&&<NavLink className="track-release-link" to={`/release/${encodeURIComponent(track.release.id)}`}>{track.release.title}</NavLink>}
          </div>
        </div>

        {/* Right Details */}
        <div className="flex items-center gap-4 shrink-0">
          <PlaybackSourcePicker compact value={source} deezer={track.source==='deezer'||!!track.trackUrl?.includes('deezer.com')} onChange={v=>{setSource(v);void playTrack(track,v);}}/>
          <button
            onClick={() => toggleLike(track)}
            className={clsx(
              'p-1.5 transition-colors cursor-pointer',
              liked ? 'text-red-500 fill-red-500' : 'text-[#7188a3] dark:text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500'
            )}
            title={liked ? 'Удалить из Избранного' : 'Добавить в Избранное'}
          >
            <Heart size={16} className={liked ? 'fill-red-500' : ''} />
          </button>

          <span className="text-xs font-mono text-[#7188a3] dark:text-slate-400 w-12 text-right">
            {formatTime(track.duration)}
          </span>

          <button
            onClick={(e) => setContextMenuPos({ x: e.clientX, y: e.clientY })}
            className="p-1.5 text-[#7188a3] dark:text-slate-400 opacity-0 group-hover:opacity-100 hover:text-[#162b50] dark:hover:text-white transition-opacity cursor-pointer"
            title="Опции"
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <TrackContextMenu
        track={track}
        position={contextMenuPos}
        onClose={() => setContextMenuPos(null)}
        playlistId={playlistId}
      />
    </>
  );
};
