import React, { useEffect, useRef, useState } from 'react';
import {DownloadCollectionButton} from '../offline/OfflineUI.js';
import {PageSkeleton} from '../components/common/Skeleton.js';
import { useLibraryStore } from '../stores/useLibraryStore.js';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Shuffle, Search, Trash2, Edit2, ListMusic, MoreHorizontal, BookmarkPlus, Check, X, Heart } from 'lucide-react';
import {usePlaylistFacts,playlistGenres,genreLabel} from '../components/playlist/playlistFacts.js';
import {useLanguageStore} from '../stores/useLanguageStore.js';
import { usePlaylistStore } from '../stores/usePlaylistStore.js';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { useShallow } from 'zustand/react/shallow';
import { useToastStore } from '../stores/useToastStore.js';
import { ArtworkImage } from '../components/common/ArtworkImage.js';
import { PlaylistTrackList } from '../components/playlist/PlaylistTrackList.js';
import { Modal } from '../components/common/Modal.js';
import { formatTime } from '../utils/formatters.js';
import { apiClient } from '../api/apiClient.js';
import { LoadingState } from '../components/common/LoadingState.js';
import {useTelegramStore} from '../telegram/runtime.js';
import clsx from 'clsx';
import {playShuffledCollection} from '../utils/collectionPlayback.js';

import { useTranslation } from '../stores/useLanguageStore.js';
export const PlaylistPage: React.FC = () => {
  const t = useTranslation();
  const userId=useTelegramStore(s=>s.user?.id);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { currentPlaylist, playlists, fetchPlaylists, fetchPlaylistById, createPlaylist, updatePlaylist, deletePlaylist, isPlaylistLoading,playlistError } =
    usePlaylistStore();
  const { playCollection,shuffle,sourceQueue,toggleShuffle } = usePlayerStore(useShallow(s => ({ playCollection: s.playCollection,shuffle:s.shuffle,sourceQueue:s.queueState.sourceQueue,toggleShuffle:s.toggleShuffle })));

  const [filterQuery, setFilterQuery] = useState('');
  const [genre,setGenre]=useState<string|null>(null);
  const ru=useLanguageStore(s=>s.language)!=='en';
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCover,setEditCover]=useState(''),[editPublic,setEditPublic]=useState(false);
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

  const allTracks=React.useMemo(()=>(currentPlaylist&&currentPlaylist.id===id?currentPlaylist.tracks||[]:[]).map(item=>item.track),[currentPlaylist,id]);
  const {facts}=usePlaylistFacts(allTracks);
  useEffect(()=>{setGenre(null);},[id]);

  if(playlistError)return <div role="alert"><p>{playlistError}</p><button className="secondary-button" onClick={()=>id&&void fetchPlaylistById(id)}>{t("Повторить","Retry")}</button></div>;
  if (isPlaylistLoading || !currentPlaylist || currentPlaylist.id!==id) {
    return <PageSkeleton label={t('Загрузка плейлиста…', 'Loading playlist…')}/>;
  }

  const isExternal = Boolean(
    currentPlaylist.id && (currentPlaylist.id.startsWith('soundcloud:') || currentPlaylist.id.startsWith('spotify:'))
  );

  const canEdit=!isExternal&&currentPlaylist.userId===`telegram:${userId}`;
  const isSaved =
    justSaved ||
    playlists.some(
      (p) =>
        p.id === currentPlaylist.id ||
        (p.title && currentPlaylist.title && p.title.trim().toLowerCase() === currentPlaylist.title.trim().toLowerCase())
    );

  const genres=playlistGenres(allTracks,facts);
  const activeGenre=genre&&genres.some(g=>g.name===genre)?genre:null;
  const visibleItems=activeGenre?(currentPlaylist.tracks||[]).filter(item=>facts[item.track.id]?.genres?.includes(activeGenre)):(currentPlaylist.tracks||[]);
  // Play and shuffle follow the genre filter.
  const tracks = visibleItems.map((t) => t.track);
  const totalDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const isPlaylistQueue=tracks.length>0&&tracks.length===sourceQueue.length&&tracks.every((track,index)=>track.id===sourceQueue[index]?.id);
  const isShuffling=shuffle&&isPlaylistQueue;
  const owner=currentPlaylist.owner;

  const handlePlayAll = async () => {
    if (tracks.length > 0) {
      await playCollection(tracks, 0);
    }
  };
  const handleShuffle=async()=>{
    if(isShuffling){toggleShuffle();return;}
    await playShuffledCollection(tracks,usePlayerStore.getState());
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
      if(!canEdit){const saved=await createPlaylist(currentPlaylist.title,currentPlaylist.description||'',currentPlaylist.artworkUrl,tracks);if(!saved)return;playlistId=saved.id;}
      await apiClient.request('/profile/showcase',{method:'POST',body:JSON.stringify({kind:'playlist',playlistId})});
      useToastStore.getState().addToast(t('Плейлист добавлен в профиль','Playlist added to profile'),'success');
    }catch(e){useToastStore.getState().addToast((e as Error).message,'warning');}
    finally{setIsSaving(false);}
  };


  const handleDelete = async () => {
    if (confirm(t(`Удалить плейлист "${currentPlaylist.title}"?`, `Delete playlist "${currentPlaylist.title}"?`))) {
      await deletePlaylist(currentPlaylist.id);
      navigate('/playlists');
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) return;
    setIsSaving(true);
    try{const saved=await updatePlaylist(currentPlaylist.id, { title: editTitle.trim(), description: editDesc, artworkUrl:editCover,isPublic:editPublic });if(saved)setIsEditOpen(false);}
    finally{setIsSaving(false);}
  };

  const openEditModal = () => {
    setEditTitle(currentPlaylist.title);
    setEditDesc(currentPlaylist.description || '');
    setEditCover(currentPlaylist.artworkUrl||'');setEditPublic(!!currentPlaylist.isPublic);
    setIsEditOpen(true);
  };

  return (
    <div className="playlist-page space-y-8 pb-12 select-none relative">
      {/* Header Banner */}
      <div className="playlist-header flex flex-col md:flex-row items-start md:items-end gap-6 pb-6 border-b border-blue-100/70 dark:border-slate-800">
        <ArtworkImage
          src={currentPlaylist.artworkUrl}
          alt={currentPlaylist.title}
          className="w-36 h-36 md:w-44 md:h-44 rounded-2xl shrink-0 shadow-md border border-blue-100/80 dark:border-slate-800"
          iconSize={56}
        />

        <div className="flex-1 min-w-0 flex flex-col justify-end gap-2">
          <div className="text-xs font-bold text-blue-600 dark:text-sky-400 uppercase tracking-wider select-none">
            {t('Плейлист', 'Playlist')}
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-[#162b50] dark:text-slate-100 tracking-tight leading-[1.2] py-1 break-words line-clamp-2">
            {currentPlaylist.title}
          </h1>
          {currentPlaylist.description && (
            <p className="text-sm text-[#5a6e85] dark:text-slate-400 line-clamp-2 leading-relaxed">{currentPlaylist.description}</p>
          )}

          <div className="playlist-meta flex flex-wrap items-center gap-3 text-xs text-[#7188a3] dark:text-slate-400 pt-1 font-medium">
            {owner&&<><span className="playlist-owner" title={owner.username?`@${owner.username.replace(/^@/,'')}`:owner.name}>{owner.name}</span><span aria-hidden="true">•</span></>}
            <span>{t(`${tracks.length} треков`, `${tracks.length} tracks`)}</span>
            <span>•</span>
            <span>{formatTime(totalDuration)}</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="playlist-actions flex items-center gap-3 flex-wrap sm:flex-nowrap">
          <button className="secondary-button playlist-profile" aria-label={t('Добавить плейлист в профиль','Add playlist to profile')} title={t('В профиль','To profile')} disabled={isSaving} onClick={()=>void handleAddToProfile()}><BookmarkPlus size={18}/><span>{t('В профиль', 'To profile')}</span></button>
          {tracks.length > 0 && (
            <button
              onClick={handlePlayAll}
              className="playlist-play primary-button"
            >
              <Play size={18} className="fill-white dark:fill-slate-950" />
              <span>{t('Слушать', 'Play')}</span>
            </button>
          )}
          <button type="button" className={clsx('playlist-shuffle',isShuffling&&'is-active')} onClick={()=>void handleShuffle()} disabled={tracks.length<2}
            aria-label={t('Перемешать и слушать','Shuffle and play')} aria-pressed={isShuffling}
            title={isShuffling?t('Выключить перемешивание','Turn shuffle off'):t('Перемешать и слушать','Shuffle and play')}>
            <Shuffle size={19} aria-hidden="true"/>
          </button>
          <DownloadCollectionButton tracks={tracks}/>

          {/* Save external playlist to local library button */}
          {isExternal && (
            <button
              onClick={handleSaveToLibrary}
              disabled={isSaving || isSaved}
              className={clsx(
                'flex items-center gap-2 px-5 py-3.5 rounded-2xl font-bold text-sm transition shadow-xs select-none cursor-pointer',
                isSaved
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 text-[#162b50] dark:text-slate-200 border border-blue-200/80 dark:border-slate-700 active:scale-95'
              )}
              title={isSaved ? t('Плейлист сохранён в вашу медиатеку', 'Playlist saved to your library') : t('Сохранить этот плейлист к себе', 'Save this playlist to your library')}
            >
              {isSaved ? (
                <>
                  <Check size={18} className="text-emerald-600 dark:text-emerald-400" />
                  <span>{t('В медиатеке', 'In library')}</span>
                </>
              ) : (
                <>
                  <BookmarkPlus size={18} className={isSaving ? 'animate-pulse' : ''} />
                  <span>{isSaving ? t('Сохранение...', 'Saving...') : t('Сохранить к себе', 'Save to library')}</span>
                </>
              )}
            </button>
          )}

          {/* Three-dots menu: «all to liked» for any playlist, editing for the owner's own. */}
          {(canEdit || tracks.length > 0) && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-3.5 rounded-2xl bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 border border-blue-200/80 dark:border-slate-700 shadow-xs transition-colors cursor-pointer"
                title={t('Действия с плейлистом', 'Playlist actions')}
              >
                <MoreHorizontal size={20} />
              </button>

              {isMenuOpen && (
                <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-60 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-blue-100 dark:border-slate-800 rounded-xl shadow-xl p-1.5 z-40 animate-in fade-in zoom-in-95 duration-100">
                  {tracks.length > 0 && <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      void useLibraryStore.getState().likeAll(tracks);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-blue-50/70 dark:hover:bg-slate-800/80 transition-colors text-left text-sm text-[#162b50] dark:text-slate-200 cursor-pointer"
                  >
                    <Heart size={16} className="text-[#7188a3] dark:text-slate-400" />
                    <span>{t('Все треки в любимые', 'Like all tracks')}</span>
                  </button>}
                  {canEdit && <>
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      openEditModal();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-blue-50/70 dark:hover:bg-slate-800/80 transition-colors text-left text-sm text-[#162b50] dark:text-slate-200 cursor-pointer"
                  >
                    <Edit2 size={16} className="text-[#7188a3] dark:text-slate-400" />
                    <span>{t('Редактировать', 'Edit')}</span>
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
                    <span>{t('Удалить плейлист', 'Delete playlist')}</span>
                  </button>
                  </>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Filter inside playlist */}
      {allTracks.length > 0 && (
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7188a3] dark:text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={t('Найти в плейлисте...', 'Find in playlist...')}
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

      {genres.length >= 2 && (
        <div className="playlist-genres" role="radiogroup" aria-label={t('Жанр','Genre')}>
          <button type="button" role="radio" aria-checked={!activeGenre} className={clsx(!activeGenre&&'is-active')} onClick={()=>setGenre(null)}>{t('Все','All')}</button>
          {genres.map(g=><button key={g.name} type="button" role="radio" aria-checked={activeGenre===g.name} className={clsx(activeGenre===g.name&&'is-active')} onClick={()=>setGenre(activeGenre===g.name?null:g.name)}>{genreLabel(g.name,ru)}<small>{g.count}</small></button>)}
        </div>
      )}

      {/* Track List with Drag-and-Drop */}
      <PlaylistTrackList
        playlistId={currentPlaylist.id}
        // Reordering a filtered list would rewrite the playlist without the hidden tracks.
        readOnly={!canEdit||!!activeGenre}
        items={visibleItems}
        filterQuery={filterQuery}
      />

      {/* Edit Modal */}
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title={t('Редактировать плейлист', 'Edit playlist')}>
        <form onSubmit={handleEditSubmit} className="space-y-4 pt-1">
          <div>
            <label className="block text-xs font-semibold text-[#7188a3] dark:text-slate-300 mb-1">{t('Название *', 'Title *')}</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              required
              className="w-full bg-white dark:bg-slate-800/80 border border-blue-200/80 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-[#162b50] dark:text-slate-100 placeholder-[#7188a3] dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 dark:focus:border-sky-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#7188a3] dark:text-slate-300 mb-1">{t('Описание', 'Description')}</label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              className="w-full bg-white dark:bg-slate-800/80 border border-blue-200/80 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-[#162b50] dark:text-slate-100 placeholder-[#7188a3] dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 dark:focus:border-sky-400 resize-none"
            />
          </div>
          <label className="block">{t('Обложка: ссылка или файл','Cover: URL or file')}<input className="glass-input w-full" type="url" value={editCover.startsWith('data:')?'':editCover} onChange={e=>setEditCover(e.target.value)}/><input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1000000){useToastStore.getState().addToast(t('Обложка — до 1 МБ','Cover must be under 1 MB'),'warning');return;}const reader=new FileReader();reader.onload=()=>setEditCover(String(reader.result));reader.readAsDataURL(file);}}/>{editCover&&<ArtworkImage src={editCover} alt="" className="w-20 h-20 rounded-xl"/>}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={editPublic} onChange={e=>setEditPublic(e.target.checked)}/>{t('Публичный плейлист — доступен по ссылке','Public playlist — accessible by link')}</label>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setIsEditOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-medium text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {t('Отмена', 'Cancel')}
            </button>
            <button
              type="submit" disabled={isSaving}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 shadow-xs cursor-pointer"
            >
              {t('Сохранить', 'Save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
