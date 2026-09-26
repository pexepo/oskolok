import React, { useEffect, useState } from 'react';
import { Heart, Play, Music, Search, X } from 'lucide-react';
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
import { useLibraryStore } from '../stores/useLibraryStore.js';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { DndSortableTrackRow } from '../components/playlist/DndSortableTrackRow.js';
import { formatTime } from '../utils/formatters.js';
import { apiClient } from '../api/apiClient.js';
import { LoadingState } from '../components/common/LoadingState.js';

export const LikedPage: React.FC = () => {
  const { likedTracks, isLoading, reorderLikedTracks } = useLibraryStore();
  const { playCollection } = usePlayerStore();
  const [filterQuery, setFilterQuery] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (likedTracks.length > 0) {
      apiClient.prefetchTrack(likedTracks[0].id).catch(() => {});
      if (likedTracks.length > 1) {
        apiClient.prefetchTrack(likedTracks[1].id).catch(() => {});
      }
    }
  }, [likedTracks]);

  const totalDuration = likedTracks.reduce((acc, t) => acc + (t.duration || 0), 0);

  const handlePlayAll = async () => {
    const listToPlay = filteredTracks.length > 0 ? filteredTracks : likedTracks;
    if (listToPlay.length > 0) {
      await playCollection(listToPlay, 0);
    }
  };

  const filteredTracks = filterQuery.trim()
    ? likedTracks.filter((t) => {
        const q = filterQuery.toLowerCase();
        const title = t.title || '';
        const artistName =
          typeof t.artist === 'object' ? t.artist?.name || '' : String(t.artist || '');
        return title.toLowerCase().includes(q) || artistName.toLowerCase().includes(q);
      })
    : likedTracks;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = likedTracks.findIndex((t) => t.id === active.id);
    const newIndex = likedTracks.findIndex((t) => t.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const newItems = arrayMove(likedTracks, oldIndex, newIndex);
      reorderLikedTracks(newItems);
    }
  };

  return (
    <div className="space-y-8 pb-12 select-none">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row items-start md:items-end gap-6 pb-6 border-b border-blue-100/70 dark:border-slate-800">
        <div
          onClick={handlePlayAll}
          className="group relative w-36 h-36 md:w-44 md:h-44 rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-xl shadow-blue-500/20 shrink-0 cursor-pointer overflow-hidden"
          title={likedTracks.length > 0 ? 'Воспроизвести всё' : undefined}
        >
          <Heart size={72} className="fill-white transition-transform group-hover:scale-95" />
          {likedTracks.length > 0 && (
            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <div className="w-14 h-14 rounded-full bg-white/30 backdrop-blur-md flex items-center justify-center shadow-xl hover:scale-110 transition-transform">
                <Play size={24} className="fill-white text-white ml-0.5" />
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-end gap-2">
          <div className="text-xs font-bold text-blue-600 dark:text-sky-400 uppercase tracking-wider select-none">
            Плейлист
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-[#162b50] dark:text-slate-100 tracking-tight leading-[1.2] py-1 break-words">
            Мне нравится
          </h1>
          <div className="flex items-center gap-3 text-xs text-[#5a6e85] dark:text-slate-400 pt-1 font-medium">
            <span>Слушатель Осколок</span>
            <span>•</span>
            <span>{likedTracks.length} треков</span>
            <span>•</span>
            <span>{formatTime(totalDuration)}</span>
          </div>
        </div>
      </div>

      {/* Search inside Liked Songs */}
      {likedTracks.length > 0 && (
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7188a3] dark:text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Найти в понравившихся..."
            className="w-full bg-white/80 dark:bg-slate-900/60 border border-blue-200/80 dark:border-slate-700 rounded-xl pl-10 pr-9 py-2 text-sm text-[#162b50] dark:text-slate-100 placeholder-[#7188a3] dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 dark:focus:border-sky-400 shadow-xs transition-all"
          />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-white cursor-pointer"
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}

      {/* Tracks List with Drag and Drop */}
      {isLoading ? (
        <LoadingState label="Загружаем понравившиеся треки…"/>
      ) : likedTracks.length === 0 ? (
        <div className="py-20 text-center text-[#7188a3] dark:text-slate-400 space-y-2 bg-white/40 dark:bg-slate-900/40 border border-blue-100/50 dark:border-slate-800 rounded-2xl p-8">
          <Music size={48} className="mx-auto text-blue-300 dark:text-sky-500 mb-2 opacity-60" />
          <p className="text-lg font-bold text-[#162b50] dark:text-slate-200">Здесь появятся понравившиеся треки</p>
          <p className="text-xs text-[#7188a3] dark:text-slate-400">Нажмите на сердечко у любого трека, чтобы добавить его сюда</p>
        </div>
      ) : filteredTracks.length === 0 ? (
        <div className="py-12 text-center text-[#7188a3] dark:text-slate-400 space-y-1 bg-white/40 dark:bg-slate-900/40 border border-blue-100/50 dark:border-slate-800 rounded-2xl p-6">
          <p className="text-base font-semibold text-[#162b50] dark:text-slate-200">Ничего не найдено</p>
          <p className="text-xs text-[#7188a3] dark:text-slate-400">По запросу «{filterQuery}» треки не найдены</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={filteredTracks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1">
              {filteredTracks.map((track, idx) => (
                <DndSortableTrackRow
                  key={track.id}
                  id={track.id}
                  track={track}
                  index={idx}
                  playlistId="liked"
                  collection={filteredTracks}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
};
