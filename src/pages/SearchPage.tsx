import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useSearchParams, NavLink } from 'react-router-dom';
import { Search, X, Sparkles, Play, ArrowUpRight, Disc3 } from 'lucide-react';
import { SearchResult, Track } from '../types/index.js';
import { apiClient } from '../api/apiClient.js';
import { TrackRow } from '../components/tracks/TrackRow.js';
import { ShardArtwork } from '../components/tracks/ShardArtwork.js';
import { RecommendationShelf } from '../components/discovery/RecommendationShelf.js';
import { LoadingSurface, SkeletonCards, SkeletonRows } from '../components/common/Skeleton.js';
import { HomeDailyMixes } from '../components/discovery/HomeDailyMixes.js';
import { ConsentCard } from '../components/settings/ConsentCard.js';
import { SearchSuggestions } from '../components/discovery/SearchSuggestions.js';
import { useLibraryStore } from '../stores/useLibraryStore.js';
import { usePlaylistStore } from '../stores/usePlaylistStore.js';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { useTranslation } from '../stores/useLanguageStore.js';
import { UnreleasedSearchResults } from '../components/community/UnreleasedSearchResults.js';
import { UNRELEASED_OPEN } from '../config/beta.js';
import {ArtworkImage} from '../components/common/ArtworkImage.js';
import {selectBestSearchResult} from '../utils/searchRanking.js';
import {QueryVibeButton} from '../components/discovery/QueryVibeButton.js';

type TabType = 'all' | 'tracks' | 'artists' | 'albums' | 'playlists' | 'collection';

/** The last answers for this session: going back to a query shows it at once instead of searching again. */
const searchCache = new Map<string, { at: number; value: SearchResult }>();
const cachedSearch = (q: string) => { const hit = searchCache.get(q.toLocaleLowerCase()); return hit && Date.now() - hit.at < 5 * 60_000 ? hit.value : null; };
const rememberSearch = (q: string, value: SearchResult) => { searchCache.set(q.toLocaleLowerCase(), { at: Date.now(), value }); if (searchCache.size > 30) searchCache.delete(searchCache.keys().next().value!); };

const norm = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const SearchPage: React.FC = () => {
  const t = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get('q') || '';

  const [inputVal, setInputVal] = useState(queryParam);
  // Japanese/Chinese input: nothing is searched while a word is still being composed.
  const [composing, setComposing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [albumPage,setAlbumPage]=useState(1);
  const [loadingAlbums,setLoadingAlbums]=useState(false);
  const [albumError,setAlbumError]=useState('');

  const { likedTracks } = useLibraryStore();
  const { playlists } = usePlaylistStore();
  const playCollection = usePlayerStore(s => s.playCollection);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => { setInputVal(queryParam); setActiveTab('all'); }, [queryParam]);

  useEffect(() => {
    if (composing || inputVal.trim() === queryParam) return;
    const timer = setTimeout(() => setSearchParams(inputVal.trim() ? { q: inputVal.trim() } : {}, { replace: true }), 450);
    return () => clearTimeout(timer);
  }, [inputVal, queryParam, setSearchParams, composing]);

  const handleSearch = (q: string) => {
    const trimmed = q.trim();
    setSearchParams(trimmed ? { q: trimmed } : {});
  };

  useEffect(() => {
    if (!queryParam.trim()) { setResults(null); setLoading(false); return; }
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    setErrorMsg(null);
    const cached = cachedSearch(queryParam.trim());
    if (cached) { setResults(cached); setLoading(false); return; }
    setAlbumPage(1);setLoadingAlbums(false);setAlbumError('');
    apiClient
      .search(queryParam.trim(), 1, 25, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        rememberSearch(queryParam.trim(), res);
        setResults(res);
        if (res?.tracks?.length) apiClient.prefetchTrack(res.tracks[0].id).catch(() => {});
      })
      .catch((err) => {
        if (err.name !== 'AbortError') { setErrorMsg(err.message || t('Поиск не удался', 'Search failed')); setResults(null); }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [queryParam]);

  const localMatches = useMemo(() => {
    if (!queryParam.trim()) return { tracks: [] as Track[], playlists: [] as typeof playlists };
    const q = norm(queryParam);
    return {
      tracks: likedTracks.filter(tr => norm(`${tr.artist?.name || ''} ${tr.title}`).includes(q)),
      playlists: playlists.filter(p => norm(p.title).includes(q)),
    };
  }, [queryParam, likedTracks, playlists]);

  const effectiveQuery = results?.correctedQuery || queryParam;
  const best=results?selectBestSearchResult(results,effectiveQuery):undefined;
  const topArtist=best?.type==='artist'?best.artist:undefined;
  const topTrack=best?.type==='track'?best.track:undefined;
  const topAlbum=best?.type==='album'?best.album:undefined;
  const albums=results?.albums||[];
  const isEmpty = !results || (results.tracks.length === 0 && results.artists.length === 0 && results.playlists.length === 0 && albums.length===0 && localMatches.tracks.length === 0 && localMatches.playlists.length===0);
  const show = (tab: TabType) => activeTab === 'all' || activeTab === tab;
  const loadMoreAlbums=async()=>{
    const controller=abortControllerRef.current;
    if(loadingAlbums||!controller||controller.signal.aborted)return;
    setLoadingAlbums(true);setAlbumError('');
    try{
      const more=await apiClient.search(effectiveQuery,albumPage+1,25,controller.signal);
      if(controller.signal.aborted)return;
      setResults(current=>current?{...current,albums:[...new Map([...(current.albums||[]),...(more.albums||[])].map(album=>[album.id,album])).values()],pagination:{...current.pagination,sections:{...current.pagination.sections,albums:more.pagination.sections?.albums||{hasMore:false}}}}:current);
      setAlbumPage(page=>page+1);
    }catch(error){if(!controller.signal.aborted)setAlbumError(error instanceof Error?error.message:t('Не удалось загрузить альбомы','Could not load albums'));}
    finally{if(!controller.signal.aborted)setLoadingAlbums(false);}
  };

  const tabs: Array<{ id: TabType; label: string; count?: number }> = [
    { id: 'all', label: t('Все', 'All') },
    { id: 'tracks', label: t('Треки', 'Tracks'), count: results?.tracks.length },
    { id: 'artists', label: t('Исполнители', 'Artists'), count: results?.artists.length },
    { id: 'albums', label: t('Альбомы', 'Albums'), count: albums.length },
    { id: 'playlists', label: t('Плейлисты', 'Playlists'), count: results?.playlists.length },
    { id: 'collection', label: t('В коллекции', 'In collection'), count: localMatches.tracks.length + localMatches.playlists.length },
  ];

  return (
    <div className="search-page">
      <div className="search-hero">
        <span className="eyebrow">{t('Поиск', 'Search')}</span>
        <h1>{t('Найди свой', 'Find your')} <em>{t('осколок', 'shard')}</em></h1>
        <div className="search-shell" onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }} onKeyDown={e => { if (e.key === 'Escape') setFocused(false); }}>
          <form onSubmit={(e) => { e.preventDefault(); handleSearch(inputVal); setFocused(false); }} className="search-field">
            <Search size={20} aria-hidden="true" />
            <input
              type="search"
              autoFocus={window.matchMedia('(pointer: fine)').matches}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(e) => { setComposing(false); setInputVal(e.currentTarget.value); }}
              placeholder={t('Артист, трек, альбом или ссылка', 'Artist, track, album or link')}
              aria-label={t('Поиск музыки', 'Search music')}
            />
            {inputVal && <button type="button" aria-label={t('Очистить', 'Clear')} onClick={() => { setInputVal(''); setSearchParams({}); }}><X size={16} /></button>}
          </form>
          {focused && !composing && <SearchSuggestions query={inputVal} onChoose={() => setFocused(false)} />}
        </div>
        {queryParam.trim() && <div className="search-tabs" role="tablist">
          {tabs.map(tab => <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} onClick={() => {setFocused(false);setActiveTab(tab.id);}} className={activeTab === tab.id ? 'is-active' : ''}>
            {tab.label}{tab.count ? <small>{tab.count}</small> : null}
          </button>)}
        </div>}
      </div>

      {loading && (!results || isEmpty) ? (
        <LoadingSurface loading label={t('Ищем…', 'Searching…')} skeleton={<div className="search-skeleton"><div className="search-top"><div className="search-best crystal-slab"><SkeletonCards count={1} /></div><div className="search-top-tracks crystal-slab"><SkeletonRows rows={4} /></div></div></div>} />
      ) : errorMsg ? (
        <div className="search-message crystal-slab" role="alert">{errorMsg}<button className="text-button" onClick={() => handleSearch(queryParam)}>{t('Повторить', 'Retry')}</button></div>
      ) : !queryParam.trim() ? (
        <div className="search-start">
          <ConsentCard />
          <HomeDailyMixes />
          <RecommendationShelf title={t('Собрано для вас', 'Picked for you')} />
        </div>
      ) : isEmpty || !results ? (
        <div className="search-message crystal-slab">
          <strong>{t('Ничего не нашлось по запросу', 'Nothing found for')} «{queryParam}»</strong>
          <span>{t('Проверьте написание или попробуйте только имя артиста.', 'Check the spelling or try just the artist name.')}</span>
        </div>
      ) : (
        <div className={`search-results${loading ? ' is-refreshing' : ''}`} aria-busy={loading}>
          {results.correctedQuery && <p className="search-corrected" role="status"><Sparkles size={14} />{t('Показаны результаты для', 'Showing results for')} «{results.correctedQuery}»</p>}

          {activeTab === 'all' && best && <section className={`search-top ${results.tracks.length?'':'search-top--solo'}`}>
            <div className="search-best crystal-slab">
              <span className="eyebrow">{t('Лучший результат', 'Top result')}</span>
              {topArtist ? <NavLink to={`/artist/${encodeURIComponent(topArtist.id)}`} className="search-best-link shard-hover">
                <ShardArtwork src={topArtist.avatarUrl} alt={topArtist.name} index={4} portrait />
                <div><h2>{topArtist.name}</h2><p>{t('Исполнитель', 'Artist')}{topArtist.followersCount ? ` · ${new Intl.NumberFormat().format(topArtist.followersCount)} ${t('подписчиков', 'followers')}` : ''}</p></div>
                <ArrowUpRight size={20} className="search-best-go" />
              </NavLink> : topAlbum?<NavLink to={`/release/${encodeURIComponent(topAlbum.id)}`} className="search-best-link shard-hover">
                <ArtworkImage src={topAlbum.artworkUrl} alt={topAlbum.title} className="search-best-album"/>
                <div><h2>{topAlbum.title}</h2><p>{t('Альбом','Album')}{topAlbum.artist?` · ${topAlbum.artist.name}`:''}</p></div>
                <ArrowUpRight size={20} className="search-best-go" aria-hidden="true"/>
              </NavLink>:topTrack && <button type="button" className="search-best-link shard-hover" onClick={() => playCollection(results.tracks, Math.max(0,results.tracks.findIndex(track=>track.id===topTrack.id)))}>
                <ShardArtwork src={topTrack.artworkUrl} alt={topTrack.title} index={0} />
                <div><h2>{topTrack.title}</h2><p>{t('Трек', 'Track')} · {topTrack.artist.name}</p></div>
                <span className="search-best-play"><Play size={20} fill="currentColor" /></span>
              </button>}
              {(topTrack || topArtist || topAlbum?.artist) && <QueryVibeButton key={effectiveQuery} query={effectiveQuery}
                seed={topTrack ? { kind: 'track', track: topTrack } : { kind: 'artist', name: (topArtist?.name || topAlbum?.artist?.name)!, tracks: results.tracks }} />}
            </div>
            {results.tracks.length>0&&<div className="search-top-tracks crystal-slab">
              <h3>{t('Треки', 'Tracks')}</h3>
              {results.tracks.slice(0, 4).map((track, idx) => <TrackRow key={track.id} track={track} index={idx} collection={results.tracks} />)}
            </div>}
          </section>}

          {show('collection') && localMatches.tracks.length > 0 && <section className="search-section">
            <h3><Sparkles size={15} />{t('В вашей коллекции', 'In your collection')}</h3>
            <div className="crystal-slab search-list">{localMatches.tracks.map((track, idx) => <TrackRow key={`local-${track.id}`} track={track} index={idx} collection={localMatches.tracks} />)}</div>
          </section>}
          {activeTab === 'collection' && localMatches.playlists.length > 0 && <section className="search-section">
            <h3>{t('Ваши плейлисты', 'Your playlists')}</h3>
            <div className="search-playlists">{localMatches.playlists.map((pl, i) => <NavLink key={pl.id} to={`/playlist/${encodeURIComponent(pl.id)}`} className="search-playlist crystal-slab shard-hover"><ShardArtwork src={pl.artworkUrl || pl.tracks?.[0]?.track.artworkUrl} alt={pl.title} index={i} small /><span><strong>{pl.title}</strong><small>{pl.trackCount || pl.tracks?.length || 0} {t('треков', 'tracks')}</small></span></NavLink>)}</div>
          </section>}

          {show('tracks') && results.tracks.length > (activeTab === 'all' ? 4 : 0) && <section className="search-section">
            <h3>{activeTab === 'all' ? t('Ещё треки', 'More tracks') : t('Треки', 'Tracks')}</h3>
            <div className="crystal-slab search-list">{results.tracks.slice(activeTab === 'all' ? 4 : 0).map((track, idx) => <TrackRow key={track.id} track={track} index={idx + (activeTab === 'all' ? 4 : 0)} collection={results.tracks} />)}</div>
          </section>}

          {UNRELEASED_OPEN && show('tracks') && <UnreleasedSearchResults query={queryParam} />}
          {show('artists') && results.artists.length > 0 && <section className="search-section">
            <h3>{t('Исполнители', 'Artists')}</h3>
            <div className="search-artists">{results.artists.map((artist, i) => <NavLink key={artist.id} to={`/artist/${encodeURIComponent(artist.id)}`} className="search-artist shard-hover">
              <ShardArtwork src={artist.avatarUrl} alt={artist.name} index={i + 2} portrait />
              <strong>{artist.name}</strong><small>{t('Исполнитель', 'Artist')}</small>
            </NavLink>)}</div>
          </section>}

          {show('albums') && albums.length>0 && <section className="search-section">
            <h3><Disc3 size={16} aria-hidden="true"/>{t('Альбомы','Albums')}</h3>
            <div className="search-albums">{albums.map(album=><NavLink key={album.id} to={`/release/${encodeURIComponent(album.id)}`} className="search-album">
              <div className="search-album-cover"><ArtworkImage src={album.artworkUrl} alt={album.title} className="search-album-art"/><ArrowUpRight size={18} aria-hidden="true"/></div>
              <strong title={album.title}>{album.title}</strong>
              <small>{[album.artist?.name,album.date?.slice(0,4)].filter(Boolean).join(' · ')||t('Альбом','Album')}</small>
            </NavLink>)}</div>
            {results.pagination.sections?.albums?.hasMore&&<button type="button" className="secondary-button search-more-albums" disabled={loadingAlbums} onClick={()=>void loadMoreAlbums()}>{loadingAlbums?t('Загружаем…','Loading…'):t('Ещё альбомы','More albums')}</button>}
            {albumError&&<p className="search-album-error" role="alert">{albumError}</p>}
          </section>}
          {activeTab==='albums'&&albums.length===0&&<p className="search-message crystal-slab">{t('Альбомы не найдены. Попробуйте название альбома или имя исполнителя.','No albums found. Try an album title or artist name.')}</p>}

          {show('playlists') && results.playlists.length > 0 && <section className="search-section">
            <h3>{t('Плейлисты', 'Playlists')}</h3>
            <div className="search-playlists">{results.playlists.map((playlist, i) => <NavLink key={playlist.id} to={`/playlist/${encodeURIComponent(playlist.id)}`} className="search-playlist crystal-slab shard-hover">
              <ShardArtwork src={playlist.artworkUrl} alt={playlist.title} index={i} small />
              <span><strong>{playlist.title}</strong><small>{playlist.trackCount || 0} {t('треков', 'tracks')}</small></span>
            </NavLink>)}</div>
          </section>}
        </div>
      )}
    </div>
  );
};
