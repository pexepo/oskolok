import React, { useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Track } from '../../types/index.js';
import { apiClient } from '../../api/apiClient.js';
import { usePlaylistStore } from '../../stores/usePlaylistStore.js';
import { ArtworkImage } from '../common/ArtworkImage.js';
import { formatTime } from '../../utils/formatters.js';
import {LoadingState} from '../common/LoadingState.js';

interface PlaylistSearchDrawerProps {
  playlistId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const PlaylistSearchDrawer: React.FC<PlaylistSearchDrawerProps> = ({
  playlistId,
  isOpen,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const { addTrackToPlaylist } = usePlaylistStore();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const res = await apiClient.search(query.trim(), 1, 15);
      setResults(res.tracks);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (track: Track) => {
    await addTrackToPlaylist(playlistId, track);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, x: '100%' }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 250 }}
          className="fixed top-16 right-0 bottom-24 w-96 bg-white/95 dark:bg-[#0c1320]/95 backdrop-blur-2xl border-l border-blue-100/90 dark:border-slate-800 shadow-2xl z-30 flex flex-col p-6 select-none"
        >
          <div className="flex items-center justify-between pb-4 border-b border-blue-100 dark:border-slate-800">
            <h3 className="font-bold text-base text-[#162b50] dark:text-slate-100">Найти и добавить трек</h3>
            <button onClick={onClose} className="p-1 text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 transition-colors cursor-pointer">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSearch} className="mt-4 relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7188a3] dark:text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти треки..."
              className="w-full bg-white dark:bg-slate-900/80 border border-blue-200/80 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm text-[#162b50] dark:text-slate-100 placeholder-[#7188a3] dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 dark:focus:border-sky-400 shadow-xs"
            />
          </form>

          <div className="flex-1 overflow-y-auto mt-4 space-y-2 custom-scrollbar">
            {loading ? (
              <LoadingState size="md" label="Ищем треки…"/>
            ) : results.length === 0 ? (
              <div className="text-center py-12 text-[#7188a3] dark:text-slate-400 text-xs">
                Введите поисковый запрос выше
              </div>
            ) : (
              results.map((track) => (
                <div
                  key={track.id}
                  className="flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-blue-50/70 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <ArtworkImage src={track.artworkUrl} alt={track.title} className="w-10 h-10 rounded-lg shrink-0 shadow-xs" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#162b50] dark:text-slate-200 truncate">{track.title}</div>
                    <div className="text-xs text-[#5a6e85] dark:text-slate-400 truncate">{track.artist.name}</div>
                  </div>
                  <button
                    onClick={() => handleAdd(track)}
                    className="p-2 rounded-xl bg-blue-50 dark:bg-slate-800 text-blue-600 dark:text-sky-400 hover:bg-blue-600 dark:hover:bg-sky-500 hover:text-white transition-colors shrink-0 cursor-pointer"
                    title="Добавить в плейлист"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
