import React from 'react';
import { X, Trash2, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useShallow } from 'zustand/react/shallow';
import { ArtworkImage } from '../common/ArtworkImage.js';
import {VirtualTrackRows} from '../playlist/VirtualTrackRows.js';

import { useTranslation } from '../../stores/useLanguageStore.js';
export const QueueDrawer: React.FC = () => {
  const t = useTranslation();
  const { queueState, isQueueOpen, setQueueOpen, playQueueIndex, removeFromQueue, clearQueue } = usePlayerStore(useShallow(s => ({ queueState: s.queueState, isQueueOpen: s.isQueueOpen, setQueueOpen: s.setQueueOpen, playQueueIndex: s.playQueueIndex, removeFromQueue: s.removeFromQueue, clearQueue: s.clearQueue })));

  const playbackQueue = queueState?.playbackQueue || [];
  const currentIndex = queueState?.currentIndex ?? -1;
  const currentTrack =
    currentIndex >= 0 && currentIndex < playbackQueue.length
      ? playbackQueue[currentIndex]
      : null;
  const nextTracks = currentIndex >= 0 ? playbackQueue.slice(currentIndex + 1) : playbackQueue;

  return (
    <AnimatePresence>
      {isQueueOpen && (
        <motion.aside
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 250 }}
          className="queue-drawer frost-surface fixed top-16 right-0 bottom-24 w-80 bg-white/95 dark:bg-[#0c1320]/95 backdrop-blur-2xl border-l border-blue-100 dark:border-slate-800 shadow-2xl z-30 flex flex-col p-4 select-none text-[#162b50] dark:text-slate-100 transition-colors duration-300"
        >
          <div className="flex items-center justify-between pb-3 border-b border-blue-100 dark:border-slate-800">
            <h3 className="font-bold text-base text-[#162b50] dark:text-slate-100">{t('Очередь', 'Queue')}</h3>
            <div className="flex items-center gap-2">
              {playbackQueue.length > 0 && (
                <button
                  onClick={clearQueue}
                  className="text-xs text-[#7188a3] dark:text-slate-400 hover:text-rose-500 transition-colors p-1"
                  title={t('Очистить очередь', 'Clear queue')}
                >
                  {t('Очистить', 'Clear')}
                </button>
              )}
              <button
                onClick={() => setQueueOpen(false)}
                aria-label={t('Закрыть очередь','Close queue')}
                className="p-1 text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-white transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div data-scroll-root className="flex-1 min-h-0 overflow-y-auto pt-4 space-y-6 custom-scrollbar">
            {/* Currently Playing Track */}
            {currentTrack && (
              <div>
                <h4 className="text-xs font-bold text-blue-600 dark:text-sky-400 uppercase tracking-wider mb-2">
                  {t('Сейчас играет', 'Now playing')}
                </h4>
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-blue-50/80 dark:bg-sky-950/30 border border-blue-200/60 dark:border-sky-500/30 shadow-xs">
                  <ArtworkImage src={currentTrack.artworkUrl} alt={currentTrack.title} className="w-10 h-10 rounded-lg shadow-xs" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#162b50] dark:text-slate-100 truncate">{currentTrack.title}</div>
                    <div className="text-xs text-[#5a6e85] dark:text-slate-400 truncate">{currentTrack.artist?.name || t('Неизвестный исполнитель', 'Unknown artist')}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Next Up Tracks */}
            <div>
              <h4 className="text-xs font-bold text-[#7188a3] dark:text-slate-400 uppercase tracking-wider mb-2">
                {t('Далее', 'Up next')} ({nextTracks.length})
              </h4>
              {nextTracks.length === 0 ? (
                <div className="text-xs text-[#8ea2ba] dark:text-slate-500 py-4 text-center">{t('Очередь пуста', 'Queue is empty')}</div>
              ) : (
                <VirtualTrackRows count={nextTracks.length} rowHeight={64}>
                  {idx => {const track=nextTracks[idx];
                    if (!track) return null;
                    const queueIndex = currentIndex + 1 + idx;
                    const artist = track.artist?.name || t('Неизвестный исполнитель', 'Unknown artist');
                    return (
                      <div
                        key={`${track.id || 'track'}-${queueIndex}`}
                        className="group flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-blue-50/60 dark:hover:bg-slate-800/60 transition-colors"
                      >
                        <button
                          onClick={() => void playQueueIndex(queueIndex)}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div className="relative group/img">
                            <ArtworkImage src={track.artworkUrl} alt={track.title} className="w-9 h-9 rounded-lg" />
                            <div className="absolute inset-0 bg-blue-600/30 opacity-0 group-hover/img:opacity-100 flex items-center justify-center rounded-lg transition-opacity">
                              <Play size={14} className="fill-white text-white" />
                            </div>
                          </div>
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="text-sm font-medium text-[#162b50] dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-sky-400 w-full block" title={track.title}>
                              {track.title}
                            </div>
                            <div className="text-xs text-[#7188a3] dark:text-slate-400 truncate w-full block" title={artist}>{artist}</div>
                          </div>
                        </button>

                        <button
                          onClick={() => removeFromQueue(queueIndex)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[#8ea2ba] dark:text-slate-500 hover:text-rose-500 transition-opacity cursor-pointer"
                          title={t('Удалить из очереди', 'Remove from queue')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  }}
                </VirtualTrackRows>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};
