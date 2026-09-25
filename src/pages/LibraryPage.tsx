import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Heart, ListMusic, Plus, Play, ChevronRight } from 'lucide-react';
import { useLibraryStore } from '../stores/useLibraryStore.js';
import { usePlaylistStore } from '../stores/usePlaylistStore.js';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { ArtworkImage } from '../components/common/ArtworkImage.js';
import { TrackRow } from '../components/tracks/TrackRow.js';
import { Modal } from '../components/common/Modal.js';

export const LibraryPage: React.FC = () => {
  const { likedTracks } = useLibraryStore();
  const { playlists, createPlaylist } = usePlaylistStore();
  const { playCollection } = usePlayerStore();

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
    <div className="space-y-10 pb-12 select-none">
      <div>
        <h1 className="text-3xl md:text-4xl font-extrabold text-[#162b50] dark:text-slate-100 tracking-tight">Коллекция</h1>
        <p className="text-sm text-[#5a6e85] dark:text-slate-400 mt-1">Все ваши избранные треки и плейлисты</p>
      </div>

      {/* "Мне нравится" Section (Yandex Music Style) */}
      <section className="space-y-4">
        <div className="flex items-center gap-4">
          <div
            onClick={async () => {
              if (likedTracks.length > 0) {
                await playCollection(likedTracks, 0);
              }
            }}
            className="group relative w-14 h-14 rounded-md bg-gradient-to-br from-rose-500 via-red-500 to-rose-700 flex items-center justify-center text-white shadow-lg shadow-rose-500/20 shrink-0 cursor-pointer overflow-hidden transition-transform hover:scale-105"
            title={likedTracks.length > 0 ? 'Воспроизвести всё' : undefined}
          >
            <Heart size={28} className="fill-white text-white drop-shadow-md transition-transform group-hover:scale-90" />
            {likedTracks.length > 0 && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <Play size={22} className="fill-white text-white ml-0.5" />
              </div>
            )}
          </div>

          <div>
            <NavLink
              to="/liked"
              className="group inline-flex items-center gap-1.5 font-black text-2xl md:text-3xl text-[#162b50] dark:text-slate-100 hover:text-blue-600 dark:hover:text-sky-400 transition-colors"
            >
              <span>Мне нравится</span>
              <ChevronRight size={26} className="text-[#7188a3] dark:text-slate-400 group-hover:translate-x-1 group-hover:text-blue-600 dark:group-hover:text-sky-400 transition-all stroke-[2.5]" />
            </NavLink>
            <div className="text-xs font-semibold text-[#5a6e85] dark:text-slate-400 mt-0.5">
              {likedTracks.length} {likedTracks.length === 1 ? 'трек' : likedTracks.length > 1 && likedTracks.length < 5 ? 'трека' : 'треков'}
            </div>
          </div>
        </div>

        {likedTracks.length === 0 ? (
          <div className="py-6 text-[#7188a3] text-xs">
            Здесь появятся ваши любимые треки. Нажмите на сердечко у любого трека, чтобы добавить его в коллекцию.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-0.5">
              {likedTracks.slice(0, 8).map((track, idx) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={idx}
                  collection={likedTracks}
                />
              ))}
            </div>

            {likedTracks.length > 8 && (
              <div className="pt-2">
                <NavLink
                  to="/liked"
                  className="inline-flex items-center gap-1 text-xs font-bold text-zinc-400 hover:text-white transition-colors"
                >
                  <span>Показать все ({likedTracks.length})</span>
                  <ChevronRight size={14} />
                </NavLink>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Playlists Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ListMusic size={22} className="text-brand-purple" />
            <h2 className="text-2xl font-extrabold text-white">Плейлисты ({playlists.length})</h2>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {/* Create New Playlist Tile (matching user's reference) */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="group text-left focus:outline-none"
          >
            <div className="w-full aspect-square rounded-md bg-elevated/70 hover:bg-elevated border border-border/50 hover:border-border transition-colors flex items-center justify-center text-zinc-400 group-hover:text-white">
              <Plus size={32} strokeWidth={1.5} />
            </div>
            <div className="mt-2.5">
              <h4 className="font-bold text-sm text-white truncate group-hover:text-sky-400 transition-colors">
                Новый плейлист
              </h4>
            </div>
          </button>

          {/* Existing Playlists */}
          {playlists.map((pl) => (
            <NavLink
              key={pl.id}
              to={`/playlist/${pl.id}`}
              className="group text-left"
            >
              <div className="w-full aspect-square rounded-md overflow-hidden bg-elevated/70 border border-border/50 hover:border-border transition-colors">
                <ArtworkImage
                  src={pl.artworkUrl}
                  alt={pl.title}
                  className="w-full h-full object-cover rounded-md"
                  iconSize={40}
                />
              </div>
              <div className="mt-2.5">
                <h4 className="font-bold text-sm text-white truncate group-hover:text-sky-400 transition-colors">
                  {pl.title}
                </h4>
                <p className="text-xs text-zinc-500 mt-0.5">{pl.trackCount || 0} треков</p>
              </div>
            </NavLink>
          ))}
        </div>
      </section>

      {/* Create Playlist Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Создать плейлист">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1">Название *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Мой плейлист"
              required
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand-purple"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1">Описание</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Описание плейлиста..."
              rows={3}
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand-purple resize-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-white"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-brand-purple to-brand-pink text-white"
            >
              Создать
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
