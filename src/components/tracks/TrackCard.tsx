import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Play, Pause, MoreHorizontal } from 'lucide-react';
import { Track } from '../../types/index.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { ArtworkImage } from '../common/ArtworkImage.js';
import { TrackContextMenu, ContextMenuPosition } from '../common/TrackContextMenu.js';
import { formatDisplayTitle } from '../../utils/formatTrack.js';
import { apiClient } from '../../api/apiClient.js';

interface TrackCardProps {
  track: Track;
  collection?: Track[];
  index?: number;
}

export const TrackCard: React.FC<TrackCardProps> = ({ track, collection, index }) => {
  const { currentTrack, isPlaying, playTrack, playCollection, togglePlay } = usePlayerStore();
  const [contextMenuPos, setContextMenuPos] = useState<ContextMenuPosition | null>(null);

  const isCurrent = currentTrack?.id === track.id;

  const handlePlay = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
        className="frost-surface group relative bg-white/70 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-800/80 border border-blue-100/80 dark:border-slate-800 hover:border-blue-300 dark:hover:border-slate-700 p-3.5 rounded-2xl transition-all duration-300 flex flex-col justify-between select-none shadow-xs hover:shadow-md"
      >
        <div className="relative aspect-square w-full rounded-xl overflow-hidden mb-2.5 bg-blue-50/50 dark:bg-slate-800/40">
          <ArtworkImage src={track.artworkUrl} alt={track.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 rounded-xl" />

          {/* Hover Play Button */}
          <button
            onClick={handlePlay}
            className="absolute bottom-3 right-3 w-11 h-11 rounded-full bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-200 cursor-pointer"
          >
            {isCurrent && isPlaying ? (
              <Pause size={18} className="fill-white dark:fill-slate-950" />
            ) : (
              <Play size={18} className="fill-white dark:fill-slate-950 ml-0.5" />
            )}
          </button>
        </div>

        <div>
          <h4 className="font-bold text-xs text-[#162b50] dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-sky-400 transition-colors">
            {formatDisplayTitle(track.title, track.artist.name)}
          </h4>
          <NavLink
            to={`/artist/${encodeURIComponent(track.artist.id)}`}
            className="text-[11px] text-[#5a6e85] dark:text-slate-400 hover:text-blue-600 dark:hover:text-sky-400 truncate block mt-0.5"
          >
            {track.artist.name}
          </NavLink>
        </div>
      </div>

      <TrackContextMenu
        track={track}
        position={contextMenuPos}
        onClose={() => setContextMenuPos(null)}
      />
    </>
  );
};
