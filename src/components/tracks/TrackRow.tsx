import {getPreferredSource,setPreferredSource} from '../../utils/playbackPreferences.js';
import {TrackArtistLink} from './TrackCredits.js';
import {TrackInfoDialog} from './TrackInfoDialog.js';
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Play, Pause, Heart, MoreHorizontal, Radio, Info } from 'lucide-react';
import { clsx } from 'clsx';
import { Track } from '../../types/index.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryStore } from '../../stores/useLibraryStore.js';
import { formatTime } from '../../utils/formatters.js';
import { ArtworkImage } from '../common/ArtworkImage.js';
import { TrackContextMenu, ContextMenuPosition } from '../common/TrackContextMenu.js';
import { formatDisplayTitle } from '../../utils/formatTrack.js';
import { SourceBadge } from './SourceBadge.js';
import { apiClient } from '../../api/apiClient.js';
import {PlaybackSourcePicker} from './PlaybackSourcePicker.js';

import { useTranslation } from '../../stores/useLanguageStore.js';
const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

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
  const t = useTranslation();
  const { isCurrent, isPlaying, playTrack, playCollection, togglePlay } = usePlayerStore(useShallow(s => ({ isCurrent: s.currentTrack?.id===track.id, isPlaying: s.currentTrack?.id===track.id&&s.isPlaying, playTrack: s.playTrack, playCollection: s.playCollection, togglePlay: s.togglePlay })));
  const liked = useLibraryStore(s=>s.isLiked(track));
  const toggleLike = useLibraryStore(s=>s.toggleLike);
  const [contextMenuPos, setContextMenuPos] = useState<ContextMenuPosition | null>(null);

  const [source,setSource]=useState(()=>getPreferredSource(track.id)),[showInfo,setShowInfo]=useState(false);
  // Availability in a catalogue does not decide availability on our audio sources.
  const isPlayable = Boolean(track.id);

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

  const hoverTimer = React.useRef<ReturnType<typeof setTimeout>>();
  React.useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        onContextMenu={handleContextMenu}
        // Phones have no hover to reveal the play button: a tap on the row itself plays.
        onClick={e => { if (coarsePointer() && !(e.target as HTMLElement).closest('button,a,input,select,label,[role=button],[data-play]')) void handlePlayClick(); }}
        // Warm the audio only when the pointer rests on a row, not for every row a scroll slides under it.
        onMouseEnter={() => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => { apiClient.prefetchTrack(track.id).catch(() => {}); }, 450); }}
        onMouseLeave={() => clearTimeout(hoverTimer.current)}
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
              aria-label={`${isCurrent && isPlaying ? t('Пауза', 'Pause') : t('Слушать', 'Play')} ${track.title}`}
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
          <span data-play role="button" tabIndex={-1} aria-hidden="true" className="shrink-0 cursor-pointer" onClick={handlePlayClick}><ArtworkImage src={track.artworkUrl} alt={track.title} className="w-10 h-10 rounded-lg shrink-0 object-cover shadow-xs" /></span>

          <div className="track-row-copy min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-2 min-w-0">
              {/* The title opens its release (or the track page for a loose upload); the row and the cover play. */}
              <NavLink
                to={track.release?.id ? `/release/${encodeURIComponent(track.release.id)}` : `/track/${encodeURIComponent(track.id)}`}
                onClick={e => e.stopPropagation()}
                className={clsx(
                  'track-row-title font-medium text-sm truncate block min-w-0 flex-1 cursor-pointer hover:underline',
                  isCurrent ? 'text-blue-600 dark:text-sky-300 font-semibold' : 'text-[#162b50] dark:text-slate-200'
                )}
                title={formatDisplayTitle(track.title, track.artist.name)}
              >
                {formatDisplayTitle(track.title, track.artist.name)}
              </NavLink>
            </div>

            <TrackArtistLink track={track} className="text-xs text-left text-[#5a6e85] dark:text-slate-400 hover:text-blue-600 dark:hover:text-sky-400 hover:underline truncate block w-full"/>
            <SourceBadge track={track}/>
            {track.release&&<NavLink className="track-release-link" to={`/release/${encodeURIComponent(track.release.id)}`}>{track.release.title}</NavLink>}
          </div>
        </div>

        {/* Right Details */}
        <div className="track-row-actions flex items-center gap-4 shrink-0">
          <button className="text-button track-row-info" onClick={()=>setShowInfo(true)} aria-label={t('Информация о треке', 'Track info')}><Info size={16}/></button>
          <PlaybackSourcePicker compact track={track} value={source} deezer={track.source==='deezer'||!!track.trackUrl?.includes('deezer.com')} onChange={v=>{setSource(v);setPreferredSource(v,track.id);}}/>
          <button
            onClick={() => toggleLike(track)}
            className={clsx(
              'track-row-like p-1.5 transition-colors cursor-pointer',
              liked ? 'is-liked ' + 'text-red-500 fill-red-500' : 'text-[#7188a3] dark:text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500'
            )}
            title={liked ? t('Удалить из Избранного', 'Remove from Favorites') : t('Добавить в Избранное', 'Add to Favorites')}
          >
            <Heart size={16} className={liked ? 'fill-red-500' : ''} />
          </button>

          <span className="track-row-duration text-xs font-mono text-[#7188a3] dark:text-slate-400 w-12 text-right">
            {formatTime(track.duration)}
          </span>

          <button
            onClick={(e) => setContextMenuPos({ x: e.clientX, y: e.clientY })}
            className="track-row-more p-1.5 text-[#7188a3] dark:text-slate-400 opacity-0 group-hover:opacity-100 hover:text-[#162b50] dark:hover:text-white transition-opacity cursor-pointer"
            title={t('Опции', 'Options')}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {showInfo&&<TrackInfoDialog track={track} isOpen onClose={()=>setShowInfo(false)}/>}
      {contextMenuPos&&<TrackContextMenu
        track={track}
        position={contextMenuPos}
        onClose={() => setContextMenuPos(null)}
        playlistId={playlistId}
      />}
    </>
  );
};
