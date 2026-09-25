import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { PlaylistTrackItem, Track } from '../../types/index.js';
import { DndSortableTrackRow } from './DndSortableTrackRow.js';
import { usePlaylistStore } from '../../stores/usePlaylistStore.js';

interface PlaylistTrackListProps {
  playlistId: string;
  items: PlaylistTrackItem[];
  filterQuery?: string;
}

export const PlaylistTrackList: React.FC<PlaylistTrackListProps> = ({
  playlistId,
  items,
  filterQuery = '',
}) => {
  const { reorderPlaylistTracks } = usePlaylistStore();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Requires 5px drag to initiate to avoid accidental triggers on click
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const filteredItems = items.filter((item) => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    const title = item.track?.title || '';
    const artistName =
      typeof item.track?.artist === 'object'
        ? item.track?.artist?.name || ''
        : String(item.track?.artist || '');
    return title.toLowerCase().includes(q) || artistName.toLowerCase().includes(q);
  });

  const collection: Track[] = filteredItems.map((i) => i.track);

  const handleDragEnd = async (event: DragEndEvent) => {
    if (playlistId.startsWith('soundcloud:') || playlistId.startsWith('spotify:')) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => item.trackId === active.id);
    const newIndex = items.findIndex((item) => item.trackId === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const newItems = arrayMove(items, oldIndex, newIndex);
      const newTrackIds = newItems.map((i) => i.trackId);
      await reorderPlaylistTracks(playlistId, newTrackIds);
    }
  };

  if (items.length === 0) {
    return (
      <div className="py-16 text-center text-[#7188a3] dark:text-slate-400 space-y-2 bg-white/40 dark:bg-slate-900/40 border border-blue-100/50 dark:border-slate-800/80 rounded-2xl p-8">
        <p className="text-base font-semibold text-[#162b50] dark:text-slate-100">Плейлист пока пуст</p>
        <p className="text-xs text-[#7188a3] dark:text-slate-400 max-w-sm mx-auto">
          Нажмите правой кнопкой мыши (ПКМ) на любом треке и выберите «Добавить в плейлист»
        </p>
      </div>
    );
  }

  if (filteredItems.length === 0) {
    return (
      <div className="py-12 text-center text-[#7188a3] dark:text-slate-400 space-y-1 bg-white/40 dark:bg-slate-900/40 border border-blue-100/50 dark:border-slate-800/80 rounded-2xl p-6">
        <p className="text-base font-semibold text-[#162b50] dark:text-slate-100">Ничего не найдено</p>
        <p className="text-xs text-[#7188a3] dark:text-slate-400">По запросу «{filterQuery}» треки не найдены</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={items.map((i) => i.trackId)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-1">
          {filteredItems.map((item, idx) => (
            <DndSortableTrackRow
              key={item.trackId}
              id={item.trackId}
              track={item.track}
              index={idx}
              playlistId={playlistId}
              collection={collection}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};
