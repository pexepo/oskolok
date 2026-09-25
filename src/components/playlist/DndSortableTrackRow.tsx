import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Track } from '../../types/index.js';
import { TrackRow } from '../tracks/TrackRow.js';

interface DndSortableTrackRowProps {
  id: string;
  track: Track;
  index: number;
  playlistId: string;
  collection: Track[];
}

export const DndSortableTrackRow: React.FC<DndSortableTrackRowProps> = ({
  id,
  track,
  index,
  playlistId,
  collection,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(
      transform ? { x: 0, y: transform.y, scaleX: 1, scaleY: 1 } : null
    ),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 1,
    position: 'relative',
  };

  const isExternal = playlistId.startsWith('soundcloud:') || playlistId.startsWith('spotify:');

  if (isExternal) {
    return (
      <div className="w-full">
        <TrackRow
          track={track}
          index={index}
          playlistId={playlistId}
          collection={collection}
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 group/dnd">
      <button
        {...attributes}
        {...listeners}
        className="p-2 text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-white cursor-grab active:cursor-grabbing opacity-0 group-hover/dnd:opacity-100 transition-opacity touch-none shrink-0"
        title="Перетащите для изменения порядка"
      >
        <GripVertical size={16} />
      </button>

      <div className="flex-1 min-w-0">
        <TrackRow
          track={track}
          index={index}
          playlistId={playlistId}
          collection={collection}
        />
      </div>
    </div>
  );
};
