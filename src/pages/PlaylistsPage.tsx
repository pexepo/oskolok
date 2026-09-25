import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ListMusic, Plus, Music } from 'lucide-react';
import { usePlaylistStore } from '../stores/usePlaylistStore.js';
import { Modal } from '../components/common/Modal.js';
import { ArtworkImage } from '../components/common/ArtworkImage.js';

export const PlaylistsPage: React.FC = () => {
  const { playlists, createPlaylist } = usePlaylistStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await createPlaylist(title, desc);
    setTitle('');
    setDesc('');
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-8 pb-12 select-none">
      <div>
        <h1 className="text-3xl font-extrabold text-[#162b50] dark:text-slate-100 tracking-tight">Мои Плейлисты</h1>
        <p className="text-sm text-[#5a6e85] dark:text-slate-400 mt-1">Персональные подборки треков</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {/* Create New Playlist Tile */}
        <button
          onClick={() => setIsModalOpen(true)}
          className="group text-left focus:outline-none cursor-pointer flex flex-col h-full"
        >
          <div className="w-full aspect-square rounded-xl bg-white/60 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-800/80 border-2 border-dashed border-blue-200/90 dark:border-slate-700 hover:border-blue-400 dark:hover:border-sky-400 transition-all flex items-center justify-center text-blue-600 dark:text-sky-400 shadow-xs group-hover:shadow-md group-hover:scale-[1.02]">
            <Plus size={32} strokeWidth={1.8} />
          </div>
          <div className="mt-2.5 flex flex-col justify-start">
            <h4 className="font-bold text-xs text-[#162b50] dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-sky-400 transition-colors">
              Новый плейлист
            </h4>
            <p className="text-[11px] text-[#7188a3] dark:text-slate-400 mt-0.5">Создать</p>
          </div>
        </button>

        {/* Existing Playlists */}
        {playlists.map((pl) => (
          <NavLink
            key={pl.id}
            to={`/playlist/${pl.id}`}
            className="group text-left flex flex-col h-full"
          >
            <div className="w-full aspect-square rounded-xl overflow-hidden bg-white/70 dark:bg-slate-900/70 border border-blue-100 dark:border-slate-800 hover:border-blue-300 dark:hover:border-sky-500/50 transition-all shadow-xs group-hover:shadow-md group-hover:scale-[1.02]">
              <ArtworkImage
                src={pl.artworkUrl}
                alt={pl.title}
                className="w-full h-full object-cover rounded-xl"
                iconSize={40}
              />
            </div>
            <div className="mt-2.5 flex flex-col justify-start">
              <h4 className="font-bold text-xs text-[#162b50] dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-sky-400 transition-colors">
                {pl.title}
              </h4>
              <p className="text-[11px] text-[#7188a3] dark:text-slate-400 mt-0.5">{pl.trackCount || 0} треков</p>
            </div>
          </NavLink>
        ))}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Создать новый плейлист">
        <form onSubmit={handleCreate} className="space-y-4 pt-1">
          <div>
            <label className="block text-xs font-semibold text-[#7188a3] dark:text-slate-300 mb-1">Название *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Мой плейлист"
              required
              className="w-full bg-white dark:bg-slate-800/80 border border-blue-200/80 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-[#162b50] dark:text-slate-100 placeholder-[#7188a3] dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 dark:focus:border-sky-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#7188a3] dark:text-slate-300 mb-1">Описание</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Описание..."
              rows={3}
              className="w-full bg-white dark:bg-slate-800/80 border border-blue-200/80 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-[#162b50] dark:text-slate-100 placeholder-[#7188a3] dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 dark:focus:border-sky-400 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-medium text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 shadow-xs cursor-pointer"
            >
              Создать
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
