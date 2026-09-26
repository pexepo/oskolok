import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useSearchParams, NavLink } from 'react-router-dom';
import { Search, Loader2, Music, User, ListMusic, Play, X, Sparkles } from 'lucide-react';
import { SearchResult, Track } from '../types/index.js';
import { apiClient } from '../api/apiClient.js';
import { TrackRow } from '../components/tracks/TrackRow.js';
import { ArtworkImage } from '../components/common/ArtworkImage.js';
import { RecommendationShelf } from '../components/discovery/RecommendationShelf.js';
import { SearchSuggestions } from '../components/discovery/SearchSuggestions.js';
import { useLibraryStore } from '../stores/useLibraryStore.js';
import { usePlaylistStore } from '../stores/usePlaylistStore.js';

type TabType = 'all' | 'tracks' | 'artists' | 'playlists' | 'collection';

export const SearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get('q') || '';

  const [inputVal, setInputVal] = useState(queryParam);
  const [focused,setFocused]=useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { likedTracks } = useLibraryStore();
  const { playlists } = usePlaylistStore();

  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync local input with queryParam
  useEffect(() => {
    setInputVal(queryParam);
  }, [queryParam]);

  useEffect(()=>{
    if(inputVal.trim()===queryParam)return;
    const timer=setTimeout(()=>setSearchParams(inputVal.trim()?{q:inputVal.trim()}:{},{replace:true}),650);
    return()=>clearTimeout(timer);
  },[inputVal,queryParam,setSearchParams]);

  // Handle input submit / search trigger
  const handleSearch = (q: string) => {
    const trimmed = q.trim();
    if (trimmed) {
      setSearchParams({ q: trimmed });
    } else {
      setSearchParams({});
    }
  };

  // Search API execution
  useEffect(() => {
    if (!queryParam.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setErrorMsg(null);

    apiClient
      .search(queryParam.trim(), 1, 25, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setResults(res);
        if (res?.tracks && res.tracks.length > 0) {
          apiClient.prefetchTrack(res.tracks[0].id).catch(() => {});
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setErrorMsg(err.message || 'Ошибка выполнения поиска');
          setResults(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [queryParam]);

  // Local collection search matches
  const localMatches = useMemo(() => {
    if (!queryParam.trim()) return { tracks: [], playlists: [] };
    const q = queryParam.toLowerCase();
    const tracks = likedTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist?.name.toLowerCase().includes(q)
    );
    const matchedPlaylists = playlists.filter((p) =>
      p.title.toLowerCase().includes(q)
    );
    return { tracks, playlists: matchedPlaylists };
  }, [queryParam, likedTracks, playlists]);

  return (
    <div className="search-page max-w-6xl mx-auto space-y-8 pb-16 select-none pt-2">
      {/* Search Header & Large Input (Section 4) */}
      <div className="relative max-w-2xl mx-auto w-full search-shell" onFocus={()=>setFocused(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false);}} onKeyDown={e=>{if(e.key==='Escape')setFocused(false);}}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch(inputVal);
            setFocused(false);
          }}
          className="relative flex items-center group"
        >
          <Search
            size={20}
            className="absolute left-4 text-blue-600 transition-transform group-focus-within:scale-110"
          />
          <input
            type="text"
            autoFocus={window.matchMedia('(pointer: fine)').matches}
            value={inputVal}
            onChange={(e) => {
              setInputVal(e.target.value);
              // auto search on typing with slight debounce
            }}
            placeholder="Найти музыку..."
            className="w-full bg-white/85 dark:bg-[#0c1320]/90 backdrop-blur-xl border border-blue-200/80 dark:border-slate-700/80 focus:border-blue-500 dark:focus:border-sky-400 rounded-2xl pl-12 pr-12 py-3.5 text-base text-[#162b50] dark:text-slate-100 placeholder-[#7188a3] dark:placeholder-slate-500 focus:outline-none focus:ring-4 focus:ring-blue-500/15 dark:focus:ring-sky-500/20 shadow-[0_4px_24px_rgba(37,99,235,0.08)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.5)] transition-all"
          />
          {inputVal && (
            <button
              type="button"
              onClick={() => {
                setInputVal('');
                setSearchParams({});
              }}
              className="absolute right-4 p-1 rounded-full text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-white transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          )}
        </form>
        {focused&&<SearchSuggestions query={inputVal} onChoose={()=>setFocused(false)}/>}
      </div>

      {/* Category Tabs */}
      {queryParam.trim() && (
        <div className="search-tabs flex items-center justify-center gap-2 flex-wrap pt-1">
          {[
            { id: 'all', label: 'Все' },
            { id: 'tracks', label: 'Треки' },
            { id: 'artists', label: 'Исполнители' },
            { id: 'playlists', label: 'Плейлисты' },
            { id: 'collection', label: `В коллекции (${localMatches.tracks.length + localMatches.playlists.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-blue-600 dark:bg-sky-500 text-white dark:text-slate-950 shadow-md shadow-blue-500/25 dark:shadow-[0_0_12px_rgba(56,189,248,0.4)] font-bold'
                  : 'text-[#5a6e85] dark:text-slate-300 hover:text-[#162b50] dark:hover:text-white bg-white/70 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-800 border border-blue-100/60 dark:border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-[#7188a3] dark:text-slate-400">
          <Loader2 size={36} className="animate-spin text-blue-600 dark:text-sky-400 mb-3" />
          <p className="text-xs font-medium">Поиск среди осколков музыки...</p>
        </div>
      ) : errorMsg ? (
        <div className="py-10 text-center text-red-600 bg-red-50/70 border border-red-100 rounded-2xl p-6 max-w-lg mx-auto">
          {errorMsg}
        </div>
      ) : !queryParam.trim() ? (
        /* Empty State: Initial Search Welcome */
        <><div className="search-welcome py-12 text-center space-y-4 max-w-md mx-auto">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-blue-50 dark:bg-sky-500/15 border border-blue-100/80 dark:border-sky-500/30 flex items-center justify-center text-blue-600 dark:text-sky-400 shadow-sm">
            <Search size={28} />
          </div>
          <div className="space-y-1">
            <h3 className="text-xl font-semibold text-[#162b50] dark:text-slate-100">
              Найдите музыку по душе
            </h3>
            <p className="text-xs text-[#5a6e85] dark:text-slate-400">
              По умолчанию — каталог Spotify. Можно вставить ссылку на трек, альбом или плейлист.
            </p>
          </div>
        </div><RecommendationShelf title="Собрано для вас"/></>
      ) : !results ||
        (results.tracks.length === 0 &&
          results.artists.length === 0 &&
          results.playlists.length === 0 &&
          localMatches.tracks.length === 0) ? (
        <div className="py-20 text-center text-[#7188a3] dark:text-slate-400 space-y-2">
          <p className="text-lg font-semibold text-[#162b50] dark:text-slate-100">
            Ничего не найдено по запросу «{queryParam}»
          </p>
          <p className="text-xs text-[#5a6e85] dark:text-slate-400">
            Попробуйте изменить запрос или проверить написание
          </p>
        </div>
      ) : (
        /* Results View */
        <div className="space-y-10">
          {results.catalogSource && <p className="text-xs text-[#5a6e85] dark:text-slate-400 px-1" role="status">
            {results.catalogSource === 'spotify'
              ? 'Каталог Spotify · звук подбирается из доступных источников'
              : results.catalogFallbackReason === 'not_configured'
                ? 'Каталог Deezer · для Spotify администратору нужно настроить ключи приложения'
                : 'Каталог Deezer · Spotify временно недоступен'}
          </p>}
          {/* Local Collection Matches Section */}
          {(activeTab === 'all' || activeTab === 'collection') &&
            localMatches.tracks.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-blue-600 dark:text-sky-400" />
                  <h3 className="text-sm font-bold tracking-wide uppercase text-[#233a59] dark:text-slate-300">
                    Найдено в вашей коллекции
                  </h3>
                </div>
                <div className="space-y-1">
                  {localMatches.tracks.map((track, idx) => (
                    <TrackRow
                      key={`local-${track.id}`}
                      track={track}
                      index={idx}
                      collection={localMatches.tracks}
                    />
                  ))}
                </div>
              </section>
            )}

          {/* Tracks Section */}
          {(activeTab === 'all' || activeTab === 'tracks') && results.tracks.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-bold tracking-wide uppercase text-[#233a59] dark:text-slate-300">
                Треки
              </h3>
              <div className="space-y-1">
                {results.tracks.map((track, idx) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={idx}
                    collection={results.tracks}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Artists Section */}
          {(activeTab === 'all' || activeTab === 'artists') && results.artists.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-sm font-bold tracking-wide uppercase text-[#233a59] dark:text-slate-300">
                Исполнители
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {results.artists.map((artist) => (
                  <NavLink
                    key={artist.id}
                    to={`/artist/${encodeURIComponent(artist.id)}`}
                    className="group flex flex-col items-center text-center p-4 bg-white/60 dark:bg-slate-900/50 hover:bg-white/90 dark:hover:bg-slate-800/80 border border-blue-100/60 dark:border-slate-800 hover:border-blue-200/80 dark:hover:border-slate-700 rounded-2xl transition-all shadow-xs hover:shadow-md"
                  >
                    <ArtworkImage
                      src={artist.avatarUrl}
                      alt={artist.name}
                      className="w-20 h-20 rounded-full mb-3 object-cover shadow-sm group-hover:scale-105 transition-transform"
                    />
                    <div className="font-semibold text-xs text-[#162b50] dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-sky-400 truncate w-full">
                      {artist.name}
                    </div>
                    <div className="text-[11px] text-[#7188a3] dark:text-slate-400 mt-0.5">Исполнитель</div>
                  </NavLink>
                ))}
              </div>
            </section>
          )}

          {/* Playlists Section */}
          {(activeTab === 'all' || activeTab === 'playlists') && results.playlists.length > 0 && (
            <section className="space-y-4">
              <h3 className="text-sm font-bold tracking-wide uppercase text-[#233a59] dark:text-slate-300">
                Плейлисты
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {results.playlists.map((playlist) => (
                  <NavLink
                    key={playlist.id}
                    to={`/playlist/${encodeURIComponent(playlist.id)}`}
                    className="group flex items-center gap-3 p-3 bg-white/60 dark:bg-slate-900/50 hover:bg-white/90 dark:hover:bg-slate-800/80 border border-blue-100/60 dark:border-slate-800 hover:border-blue-200/80 dark:hover:border-slate-700 rounded-2xl transition-all shadow-xs hover:shadow-md"
                  >
                    <ArtworkImage
                      src={playlist.artworkUrl}
                      alt={playlist.title}
                      className="w-14 h-14 rounded-xl object-cover shadow-xs group-hover:scale-105 transition-transform shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-xs text-[#162b50] dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-sky-400 truncate">
                        {playlist.title}
                      </div>
                      <div className="text-[11px] text-[#7188a3] dark:text-slate-400 mt-0.5">
                        {playlist.trackCount || 0} треков
                      </div>
                    </div>
                  </NavLink>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
