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
import {VirtualTrackRows} from './VirtualTrackRows.js';

import { useTranslation } from '../../stores/useLanguageStore.js';
interface PlaylistTrackListProps {
  playlistId: string;
  items: PlaylistTrackItem[];
  filterQuery?: string;
  readOnly?: boolean;
}

export const PlaylistTrackList: React.FC<PlaylistTrackListProps> = ({
  playlistId,
  items,
  filterQuery = '',
  readOnly=false,
}) => {
  const t = useTranslation();
  const reorderPlaylistTracks = usePlaylistStore(s=>s.reorderPlaylistTracks);

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

  const filteredItems = React.useMemo(()=>items.filter((item) => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    const title = item.track?.title || '';
    const artistName =
      typeof item.track?.artist === 'object'
        ? item.track?.artist?.name || ''
        : String(item.track?.artist || '');
    return title.toLowerCase().includes(q) || artistName.toLowerCase().includes(q);
  }),[items,filterQuery]);

  const collection: Track[] = React.useMemo(()=>filteredItems.map((i) => i.track),[filteredItems]);
  const sortableIds=React.useMemo(()=>filteredItems.map(item=>item.trackId),[filteredItems]);

  const handleDragEnd = async (event: DragEndEvent) => {
    if (readOnly)return;
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
        <p className="text-base font-semibold text-[#162b50] dark:text-slate-100">{t('Плейлист пока пуст', 'This playlist is empty')}</p>
        <p className="text-xs text-[#7188a3] dark:text-slate-400 max-w-sm mx-auto">
          {t('Нажмите правой кнопкой мыши (ПКМ) на любом треке и выберите «Добавить в плейлист»', 'Right-click any track and choose “Add to playlist”')}
        </p>
      </div>
    );
  }

  if (filteredItems.length === 0) {
    return (
      <div className="py-12 text-center text-[#7188a3] dark:text-slate-400 space-y-1 bg-white/40 dark:bg-slate-900/40 border border-blue-100/50 dark:border-slate-800/80 rounded-2xl p-6">
        <p className="text-base font-semibold text-[#162b50] dark:text-slate-100">{t('Ничего не найдено', 'Nothing found')}</p>
        <p className="text-xs text-[#7188a3] dark:text-slate-400">{t(`По запросу «${filterQuery}» треки не найдены`, `No tracks match “${filterQuery}”`)}</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={sortableIds}
        strategy={verticalListSortingStrategy}
      >
        <VirtualTrackRows count={filteredItems.length}>
          {idx=>{const item=filteredItems[idx];return (
            <DndSortableTrackRow
              readOnly={readOnly}
              key={item.trackId}
              id={item.trackId}
              track={item.track}
              index={idx}
              playlistId={playlistId}
              collection={collection}
            />
          );}}
        </VirtualTrackRows>
      </SortableContext>
    </DndContext>
  );
};
