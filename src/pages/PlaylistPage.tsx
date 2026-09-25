import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Search, Trash2, Edit2, ListMusic, MoreHorizontal, BookmarkPlus, Check, X } from 'lucide-react';
import { usePlaylistStore } from '../stores/usePlaylistStore.js';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { useToastStore } from '../stores/useToastStore.js';
import { ArtworkImage } from '../components/common/ArtworkImage.js';
import { PlaylistTrackList } from '../components/playlist/PlaylistTrackList.js';
import { Modal } from '../components/common/Modal.js';
import { formatTime } from '../utils/formatters.js';
import { apiClient } from '../api/apiClient.js';
import clsx from 'clsx';

export const PlaylistPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { currentPlaylist, playlists, fetchPlaylists, fetchPlaylistById, createPlaylist, updatePlaylist, deletePlaylist, isLoading } =
    usePlaylistStore();
  const { playCollection } = usePlayerStore();

  const [filterQuery, setFilterQuery] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (playlists.length === 0) {
      fetchPlaylists();
    }
  }, [playlists.length, fetchPlaylists]);

  useEffect(() => {
    if (id) {
      setJustSaved(false);
      fetchPlaylistById(id);
    }
  }, [id, fetchPlaylistById]);

  useEffect(() => {
    if (currentPlaylist?.tracks && currentPlaylist.tracks.length > 0) {
      const t0 = currentPlaylist.tracks[0]?.track;
      if (t0?.id) apiClient.prefetchTrack(t0.id).catch(() => {});
      const t1 = currentPlaylist.tracks[1]?.track;
      if (t1?.id) apiClient.prefetchTrack(t1.id).catch(() => {});
    }
  }, [currentPlaylist]);

  if (isLoading || !currentPlaylist) {
    return (
      <div className="py-20 text-center text-zinc-500">
        <p className="text-base font-semibold">Загрузка плейлиста...</p>
      </div>
    );
  }

  const isExternal = Boolean(
    currentPlaylist.id && (currentPlaylist.id.startsWith('soundcloud:') || currentPlaylist.id.startsWith('spotify:'))
  );

  const isSaved =
    justSaved ||
    playlists.some(
      (p) =>
        p.id === currentPlaylist.id ||
        (p.title && currentPlaylist.title && p.title.trim().toLowerCase() === currentPlaylist.title.trim().toLowerCase())
    );

  const tracks = (currentPlaylist.tracks || []).map((t) => t.track);
  const totalDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);

  const handlePlayAll = async () => {
    if (tracks.length > 0) {
      await playCollection(tracks, 0);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!currentPlaylist || isSaving || isSaved) return;
    setIsSaving(true);
    try {
      const newPl = await createPlaylist(
        currentPlaylist.title,
        currentPlaylist.description || '',
        currentPlaylist.artworkUrl,
        tracks
      );
      if (newPl) {
        setJustSaved(true);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddToProfile=async()=>{
    if(!currentPlaylist)return;
    setIsSaving(true);
    try{
      let playlistId=currentPlaylist.id;
      if(isExternal){const saved=await createPlaylist(currentPlaylist.title,currentPlaylist.description||'',currentPlaylist.artworkUrl,tracks);if(!saved)return;playlistId=saved.id;}
      await apiClient.request('/profile/playlists',{method:'POST',body:JSON.stringify({playlistId})});
      useToastStore.getState().addToast('Плейлист добавлен в профиль','success');
    }catch(e){useToastStore.getState().addToast((e as Error).message,'warning');}
    finally{setIsSaving(false);}
  };


  const handleDelete = async () => {
    if (confirm(`Удалить плейлист "${currentPlaylist.title}"?`)) {
      await deletePlaylist(currentPlaylist.id);
      navigate('/playlists');
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) return;
    await updatePlaylist(currentPlaylist.id, { title: editTitle, description: editDesc });
    setIsEditOpen(false);
  };

  const openEditModal = () => {
    setEditTitle(currentPlaylist.title);
    setEditDesc(currentPlaylist.description || '');
    setIsEditOpen(true);
  };

  return (
    <div className="space-y-8 pb-12 select-none relative">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row items-start md:items-end gap-6 pb-6 border-b border-blue-100/70 dark:border-slate-800">
        <ArtworkImage
          src={currentPlaylist.artworkUrl}
          alt={currentPlaylist.title}
          className="w-36 h-36 md:w-44 md:h-44 rounded-2xl shrink-0 shadow-md border border-blue-100/80 dark:border-slate-800"
          iconSize={56}
        />

        <div className="flex-1 min-w-0 flex flex-col justify-end gap-2">
          <div className="text-xs font-bold text-blue-600 dark:text-sky-400 uppercase tracking-wider select-none">
            Плейлист
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-[#162b50] dark:text-slate-100 tracking-tight leading-[1.2] py-1 break-words line-clamp-2">
            {currentPlaylist.title}
          </h1>
          {currentPlaylist.description && (
            <p className="text-sm text-[#5a6e85] dark:text-slate-400 line-clamp-2 leading-relaxed">{currentPlaylist.description}</p>
          )}

          <div className="flex items-center gap-3 text-xs text-[#7188a3] dark:text-slate-400 pt-1 font-medium">
            <span>Слушатель Oskolok</span>
            <span>•</span>
            <span>{tracks.length} треков</span>
            <span>•</span>
            <span>{formatTime(totalDuration)}</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          <button className="secondary-button" disabled={isSaving} onClick={()=>void handleAddToProfile()}><BookmarkPlus size={18}/>В профиль</button>
          {tracks.length > 0 && (
            <button
              onClick={handlePlayAll}
              className="flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 font-extrabold text-sm shadow-lg shadow-blue-600/20 dark:shadow-[0_0_15px_rgba(56,189,248,0.4)] hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <Play size={18} className="fill-white dark:fill-slate-950" />
              <span>Слушать</span>
            </button>
          )}

          {/* Save external playlist to local library button */}
          {isExternal && (
            <button
              onClick={handleSaveToLibrary}
              disabled={isSaving || isSaved}
              className={clsx(
                'flex items-center gap-2 px-5 py-3.5 rounded-2xl font-bold text-sm transition-all shadow-xs select-none cursor-pointer',
                isSaved
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 text-[#162b50] dark:text-slate-200 border border-blue-200/80 dark:border-slate-700 active:scale-95'
              )}
              title={isSaved ? 'Плейлист сохранён в вашу медиатеку' : 'Сохранить этот плейлист к себе'}
            >
              {isSaved ? (
                <>
                  <Check size={18} className="text-emerald-600 dark:text-emerald-400" />
                  <span>В медиатеке</span>
                </>
              ) : (
                <>
                  <BookmarkPlus size={18} className={isSaving ? 'animate-pulse' : ''} />
                  <span>{isSaving ? 'Сохранение...' : 'Сохранить к себе'}</span>
                </>
              )}
            </button>
          )}

          {/* Three-dots Menu (for local user-created playlists) */}
          {!isExternal && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-3.5 rounded-2xl bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 border border-blue-200/80 dark:border-slate-700 shadow-xs transition-colors cursor-pointer"
                title="Действия с плейлистом"
              >
                <MoreHorizontal size={20} />
              </button>

              {isMenuOpen && (
                <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-52 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-blue-100 dark:border-slate-800 rounded-xl shadow-xl p-1.5 z-40 animate-in fade-in zoom-in-95 duration-100">
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      openEditModal();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-blue-50/70 dark:hover:bg-slate-800/80 transition-colors text-left text-sm text-[#162b50] dark:text-slate-200 cursor-pointer"
                  >
                    <Edit2 size={16} className="text-[#7188a3] dark:text-slate-400" />
                    <span>Редактировать</span>
                  </button>

                  <div className="my-1 border-t border-blue-100 dark:border-slate-800" />

                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      handleDelete();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 transition-colors text-left text-sm cursor-pointer"
                  >
                    <Trash2 size={16} />
                    <span>Удалить плейлист</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Filter inside playlist */}
      {tracks.length > 0 && (
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7188a3] dark:text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Найти в плейлисте..."
            className="w-full bg-white/80 dark:bg-slate-900/80 border border-blue-200/80 dark:border-slate-700 rounded-xl pl-10 pr-9 py-2 text-sm text-[#162b50] dark:text-slate-100 placeholder-[#7188a3] dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 dark:focus:border-sky-400 shadow-xs"
          />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 cursor-pointer"
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}

      {/* Track List with Drag-and-Drop */}
      <PlaylistTrackList
        playlistId={currentPlaylist.id}
        items={currentPlaylist.tracks || []}
        filterQuery={filterQuery}
      />

      {/* Edit Modal */}
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Редактировать плейлист">
        <form onSubmit={handleEditSubmit} className="space-y-4 pt-1">
          <div>
            <label className="block text-xs font-semibold text-[#7188a3] dark:text-slate-300 mb-1">Название *</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              required
              className="w-full bg-white dark:bg-slate-800/80 border border-blue-200/80 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-[#162b50] dark:text-slate-100 placeholder-[#7188a3] dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 dark:focus:border-sky-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#7188a3] dark:text-slate-300 mb-1">Описание</label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              className="w-full bg-white dark:bg-slate-800/80 border border-blue-200/80 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-[#162b50] dark:text-slate-100 placeholder-[#7188a3] dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 dark:focus:border-sky-400 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setIsEditOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-medium text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 shadow-xs cursor-pointer"
            >
              Сохранить
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
