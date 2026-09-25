import React from 'react';
import { ListOrdered, Trash2 } from 'lucide-react';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { TrackRow } from '../components/tracks/TrackRow.js';

export const QueuePage: React.FC = () => {
  const { queueState, removeFromQueue, clearQueue } = usePlayerStore();
  const { playbackQueue, currentIndex } = queueState;

  const currentTrack = playbackQueue[currentIndex] || null;
  const nextTracks = playbackQueue.slice(currentIndex + 1);

  return (
    <div className="space-y-8 pb-12 select-none">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-blue-50 dark:bg-slate-900/80 text-blue-600 dark:text-sky-400 border border-blue-100/80 dark:border-slate-800">
            <ListOrdered size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-[#162b50] dark:text-slate-100">Очередь воспроизведения</h1>
            <p className="text-sm text-[#5a6e85] dark:text-slate-400 mt-0.5">Управление порядком проигрывания</p>
          </div>
        </div>

        {playbackQueue.length > 0 && (
          <button
            onClick={clearQueue}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 text-[#7188a3] dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 border border-blue-200/80 dark:border-slate-700 shadow-xs transition-colors text-sm font-semibold cursor-pointer"
          >
            <Trash2 size={16} />
            <span>Очистить очередь</span>
          </button>
        )}
      </div>

      {/* Currently Playing */}
      {currentTrack && (
        <div className="space-y-3">
          <h2 className="text-xs font-bold text-blue-600 dark:text-sky-400 uppercase tracking-widest">
            Сейчас играет
          </h2>
          <div className="space-y-0.5">
            <TrackRow track={currentTrack} index={0} />
          </div>
        </div>
      )}

      {/* Next Up */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold text-[#7188a3] dark:text-slate-400 uppercase tracking-widest">
          Далее ({nextTracks.length})
        </h2>
        {nextTracks.length === 0 ? (
          <div className="py-12 text-center text-[#7188a3] dark:text-slate-400 bg-white/40 dark:bg-slate-900/40 border border-blue-100/50 dark:border-slate-800/80 rounded-2xl p-6">
            <p className="text-base font-semibold text-[#162b50] dark:text-slate-100">Очередь пуста</p>
            <p className="text-xs text-[#7188a3] dark:text-slate-400 mt-1">Добавьте треки в очередь из любого плейлиста</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {nextTracks.map((track, idx) => {
              const queueIndex = currentIndex + 1 + idx;
              return (
                <div key={`${track.id}-${queueIndex}`} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <TrackRow
                      track={track}
                      index={idx}
                      collection={nextTracks}
                    />
                  </div>
                  <button
                    onClick={() => removeFromQueue(queueIndex)}
                    className="p-2 text-[#7188a3] dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                    title="Удалить из очереди"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
