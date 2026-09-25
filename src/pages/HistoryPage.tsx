import React, { useEffect } from 'react';
import { History, Trash2, Clock } from 'lucide-react';
import { useHistoryStore } from '../stores/useHistoryStore.js';
import { TrackRow } from '../components/tracks/TrackRow.js';
import { formatDateGroup } from '../utils/formatters.js';

export const HistoryPage: React.FC = () => {
  const { history, fetchHistory, clearHistory, isLoading } = useHistoryStore();

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Group history items by "Сегодня", "Вчера", "Ранее"
  const groups: Record<string, typeof history> = {};
  for (const item of history) {
    const groupName = formatDateGroup(item.playedAt);
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(item);
  }

  const groupKeys = ['Сегодня', 'Вчера', 'Ранее'].filter((k) => groups[k] && groups[k].length > 0);

  return (
    <div className="space-y-8 pb-12 select-none">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-blue-50 dark:bg-slate-900/80 text-blue-600 dark:text-sky-400 border border-blue-100/80 dark:border-slate-800">
            <History size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-[#162b50] dark:text-slate-100">История прослушиваний</h1>
            <p className="text-sm text-[#5a6e85] dark:text-slate-400 mt-0.5">Треки, прослушанные более 30 секунд</p>
          </div>
        </div>

        {history.length > 0 && (
          <button
            onClick={clearHistory}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 text-[#7188a3] dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 border border-blue-200/80 dark:border-slate-700 shadow-xs transition-colors text-sm font-semibold cursor-pointer"
          >
            <Trash2 size={16} />
            <span>Очистить историю</span>
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-white/50 dark:bg-slate-900/40 border border-blue-100/60 dark:border-slate-800/80 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : history.length === 0 ? (
        <div className="py-20 text-center text-[#7188a3] dark:text-slate-400 space-y-2 bg-white/40 dark:bg-slate-900/40 border border-blue-100/50 dark:border-slate-800/80 rounded-2xl p-8">
          <Clock size={48} className="mx-auto text-blue-300 dark:text-sky-500/50 opacity-60 mb-2" />
          <p className="text-lg font-bold text-[#162b50] dark:text-slate-100">История прослушиваний пуста</p>
          <p className="text-xs text-[#7188a3] dark:text-slate-400">
            Здесь будут появляться треки, после того как вы их послушаете
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupKeys.map((groupName) => (
            <div key={groupName} className="space-y-3">
              <h2 className="text-base font-bold text-blue-600 dark:text-sky-400 uppercase tracking-wider">
                {groupName}
              </h2>
              <div className="space-y-0.5">
                {groups[groupName].map((item, idx) => (
                  <TrackRow
                    key={`${item.id}-${idx}`}
                    track={item.track}
                    index={idx}
                    collection={groups[groupName].map((i) => i.track)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
