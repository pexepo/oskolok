import React, { useEffect, useState } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { Play, Pause, Heart, ExternalLink, Radio, Share2, PlusCircle, Maximize2 } from 'lucide-react';
import { Track } from '../types/index.js';
import { apiClient } from '../api/apiClient.js';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { useLibraryStore } from '../stores/useLibraryStore.js';
import { usePlaylistStore } from '../stores/usePlaylistStore.js';
import { useToastStore } from '../stores/useToastStore.js';
import { ArtworkImage } from '../components/common/ArtworkImage.js';
import { TrackRow } from '../components/tracks/TrackRow.js';
import { LyricsView } from '../components/lyrics/LyricsView.js';
import { formatTime } from '../utils/formatters.js';
import { formatDisplayTitle } from '../utils/formatTrack.js';

export const TrackPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [track, setTrack] = useState<Track | null>(null);
  const [related, setRelated] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  const { currentTrack, isPlaying, playTrack, togglePlay, currentTime, seek, setFullPlayerOpen } =
    usePlayerStore();
  const { isLiked, toggleLike } = useLibraryStore();
  const { playlists, addTrackToPlaylist } = usePlaylistStore();
  const { addToast } = useToastStore();
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    apiClient
      .getTrack(id)
      .then((data) => {
        setTrack(data);
        setLoading(false);
        // Fetch related tracks by artist
        return apiClient.getArtistTracks(data.artist.id, 1, 6).catch(()=>[]);
      })
      .then((relTracks) => {
        setRelated(relTracks.filter((t) => t.id !== id));
      })
      .catch(() => {
        setTrack(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="py-20 text-center text-[#7188a3] dark:text-slate-400 font-semibold">
        Загрузка трека...
      </div>
    );
  }

  if (!track) {
    return (
      <div className="py-20 text-center text-[#7188a3] dark:text-slate-400">
        <p className="text-xl font-bold text-[#162b50] dark:text-slate-100">Трек не найден</p>
      </div>
    );
  }

  const isCurrent = currentTrack?.id === track.id;
  const liked = isLiked(track.id);

  const handlePlay = async () => {
    if (isCurrent) {
      togglePlay();
    } else {
      await playTrack(track);
    }
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    addToast('Ссылка скопирована в буфер обмена', 'success');
  };

  return (
    <div className="space-y-10 pb-12 select-none">
      {/* Track Banner */}
      <div className="frost-panel flex flex-col md:flex-row items-start md:items-end gap-8 pb-8 border-b border-blue-100/70 dark:border-slate-800">
        <ArtworkImage
          src={track.artworkUrl}
          alt={track.title}
          className="w-48 h-48 md:w-56 md:h-56 rounded-2xl shrink-0 shadow-xl border border-blue-100/80 dark:border-slate-800"
          iconSize={72}
        />

        <div className="space-y-3 flex-1 min-w-0">
          <div className="text-xs font-bold text-blue-600 dark:text-sky-400 uppercase tracking-wider select-none">
            Трек
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-[#162b50] dark:text-slate-100 tracking-tight leading-[1.2] py-1 break-words line-clamp-2">
            {formatDisplayTitle(track.title, track.artist.name)}
          </h1>

          <NavLink
            to={`/artist/${encodeURIComponent(track.artist.id)}`}
            className="text-lg text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 hover:underline font-semibold block"
          >
            {track.artist.name}
          </NavLink>
          {track.release&&<NavLink className="text-button" to={`/release/${encodeURIComponent(track.release.id)}`}>Релиз · {track.release.title}</NavLink>}

          <div className="flex items-center gap-3 text-xs text-[#5a6e85] dark:text-slate-400 font-medium">
            <span>{formatTime(track.duration)}</span>
            {track.genre && (
              <>
                <span>•</span>
                <span>{track.genre}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-4 pt-3 flex-wrap">
            <button
              onClick={handlePlay}
              className="flex items-center gap-3 px-8 py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 font-bold text-base shadow-lg shadow-blue-500/25 dark:shadow-[0_0_15px_rgba(56,189,248,0.4)] hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              {isCurrent && isPlaying ? (
                <>
                  <Pause size={20} className="fill-white dark:fill-slate-950" />
                  <span>Пауза</span>
                </>
              ) : (
                <>
                  <Play size={20} className="fill-white dark:fill-slate-950 ml-0.5" />
                  <span>Слушать</span>
                </>
              )}
            </button>

            <button
              onClick={() => toggleLike(track)}
              className="p-3.5 rounded-2xl bg-white dark:bg-slate-900/80 hover:bg-blue-50/80 dark:hover:bg-slate-800 text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 border border-blue-100/80 dark:border-slate-700 shadow-xs transition-colors cursor-pointer"
              title={liked ? 'Удалить из Избранного' : 'Добавить в Избранное'}
            >
              <Heart size={20} className={liked ? 'text-red-500 fill-red-500' : ''} />
            </button>

            <div className="relative">
              <button
                onClick={() => setShowPlaylistMenu(!showPlaylistMenu)}
                className="p-3.5 rounded-2xl bg-white dark:bg-slate-900/80 hover:bg-blue-50/80 dark:hover:bg-slate-800 text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 border border-blue-100/80 dark:border-slate-700 shadow-xs transition-colors cursor-pointer"
                title="Добавить в плейлист"
              >
                <PlusCircle size={20} />
              </button>

              {showPlaylistMenu && (
                <div className="absolute left-0 top-full mt-2 w-48 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-blue-100/80 dark:border-slate-700 rounded-2xl shadow-xl p-2 z-50 text-[#162b50] dark:text-slate-100">
                  <div className="text-xs font-bold text-[#5a6e85] dark:text-slate-400 px-2 py-1 mb-1">
                    Добавить в плейлист:
                  </div>
                  {playlists.length === 0 ? (
                    <div className="text-xs text-[#8ea2ba] dark:text-slate-500 px-2 py-1">Нет плейлистов</div>
                  ) : (
                    playlists.map((pl) => (
                      <button
                        key={pl.id}
                        onClick={async () => {
                          setShowPlaylistMenu(false);
                          await addTrackToPlaylist(pl.id, track);
                        }}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-800 text-xs truncate text-[#162b50] dark:text-slate-200 font-medium cursor-pointer"
                      >
                        {pl.title}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleShare}
              className="p-3.5 rounded-2xl bg-white dark:bg-slate-900/80 hover:bg-blue-50/80 dark:hover:bg-slate-800 text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 border border-blue-100/80 dark:border-slate-700 shadow-xs transition-colors cursor-pointer"
              title="Поделиться"
            >
              <Share2 size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Lyrics Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-[#162b50] dark:text-slate-100">Текст песни</h3>
          <button
            onClick={() => {
              if (!isCurrent) {
                playTrack(track);
              }
              setFullPlayerOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 dark:bg-slate-900/80 hover:bg-blue-100/80 dark:hover:bg-slate-800 text-xs font-semibold text-blue-600 dark:text-sky-400 border border-transparent dark:border-slate-700 transition-colors cursor-pointer"
            title="Открыть караоке на весь экран"
          >
            <Maximize2 size={15} />
            <span>Открыть текст на весь экран</span>
          </button>
        </div>
        <div
          onClick={() => {
            if (!isCurrent) {
              playTrack(track);
            }
            setFullPlayerOpen(true);
          }}
          className="h-80 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border border-blue-100/90 dark:border-slate-800 rounded-3xl overflow-hidden shadow-xs cursor-pointer hover:border-blue-300 dark:hover:border-slate-700 transition-all"
          title="Нажмите, чтобы развернуть караоке"
        >
          <LyricsView
            trackId={track.id}
            trackName={track.title}
            artistName={track.artist.name}
            duration={track.duration}
            currentTime={isCurrent ? currentTime : 0}
            onSeek={seek}
          />
        </div>
      </div>

      {/* Related Tracks */}
      {related.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-xl font-bold text-[#162b50] dark:text-slate-100">Похожие треки</h3>
          <div className="space-y-0.5">
            {related.map((relTrack, idx) => (
              <TrackRow key={relTrack.id} track={relTrack} index={idx} collection={related} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
