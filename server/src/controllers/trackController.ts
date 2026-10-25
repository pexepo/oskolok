import { warmMixAnalysis } from '../services/mixAnalysis.js';
import {spicyLyricsService} from '../services/SpicyLyricsService.js';
import {prisma} from '../database/client.js';
import {existsSync} from 'node:fs';
import { Request, Response, NextFunction } from 'express';
import { Track, SearchResult } from '../types/index.js';
import { spotifyService } from '../services/SpotifyService.js';
import { soundCloudService } from '../services/SoundCloudService.js';
import { streamResolverService } from '../services/StreamResolverService.js';
import { studioMasterService } from '../services/StudioMasterService.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import { officialCatalogService } from '../services/OfficialCatalogService.js';
import { musicCatalogService } from '../services/MusicCatalogService.js';
import { rankTrack, rankArtist, rankAlbum, mergeSearchArtists, deduplicateSearchAlbums, deduplicateSearchTracks, normalizeMusicText, matchesArtistSeed, nearlySameName } from '../services/trackRanking.js';
import { matchScore } from '../services/importMatch.js';
import { canonicalizeTracks } from '../services/canonicalRelease.js';
import { detectGenre } from '../services/genreIntent.js';
import type { Artist } from '../types/index.js';
import { phraseCoverage, swapKeyboardLayout } from '../services/searchQuery.js';
import { yandexQueryHint } from '../services/yandex/yandexSearchHint.js';
import { logger } from '../utils/logger.js';

import { proxyAudio } from '../utils/audioProxy.js';
export class TrackController {
  public search = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = (req.query.q as string) || '';
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
      const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '20', 10) || 20));

      if (!q.trim()) {
        res.json({
          data: {
            tracks: [],
            artists: [],
            albums: [],
            playlists: [],
            pagination: { page: 1, limit, hasMore: false },
          },
        });
        return;
      }

      if (/^https:\/\/(?:www\.)?deezer\.com\//i.test(q)) {
        res.status(400).json({error:{code:'IMPORT_SOURCE_UNSUPPORTED',message:'Новый импорт Deezer недоступен. Существующая библиотека сохранена.'}});
        return;
      }

      // Check if user pasted a Spotify link (track or album)
      if (q.includes('spotify.com') || q.startsWith('spotify:')) {
        const spotifyResolved = await spotifyService.resolveSpotifyUrl(q);
        if (spotifyResolved && spotifyResolved.tracks.length > 0) {
          res.json({ data: spotifyResolved });
          return;
        }
      }

      const runSearch = async (query: string) => {
        // YouTube is capped at 2 s so a slow upload index never blocks the page.
        const ytPromise = Promise.race([
          studioMasterService.searchTracks(query, 6),
          new Promise<Track[]>((resolve) => setTimeout(() => resolve([]), 2000)),
        ]);
        const [catalog, soundCloud, youtube] = await Promise.allSettled([
          musicCatalogService.search(query, { page, limit }),
          soundCloudService.search(query, { page, limit }),
          ytPromise,
        ]);
        return {
          catalog: catalog.status === 'fulfilled' ? catalog.value : { tracks: [], artists: [], albums: [], playlists: [], pagination: { page, limit, hasMore: false } } as SearchResult,
          soundCloud: soundCloud.status === 'fulfilled' ? soundCloud.value : { tracks: [], artists: [], playlists: [] },
          youtube: youtube.status === 'fulfilled' ? youtube.value : [],
        };
      };

      // The catalogue's own order already blends relevance with popularity.
      const priors = new Map<string, number>();
      const notePriors = (items: Array<{ id: string }>, weight: number) => items.forEach((item, index) => {
        priors.set(item.id, Math.max(priors.get(item.id) || 0, Math.max(0, weight - index * 3)));
      });
      const score = (track: Track, query: string) => rankTrack(track, query, priors.get(track.id) || 0);
      const strongHits = (tracks: Track[], query: string) => tracks.filter(t => phraseCoverage(normalizeMusicText(query), normalizeMusicText(`${t.artist.name} ${t.title}`)) >= .8).length;

      let effectiveQuery = q;
      // Yandex reads queries well (typos, «пирокинезис» → pyrokinesis); its answer only steers our own catalogue.
      const hintPromise = page === 1 ? yandexQueryHint(q) : Promise.resolve(null);
      let first = await runSearch(q);
      notePriors(first.catalog.tracks, 45);
      let pool = [...first.catalog.tracks, ...first.soundCloud.tracks, ...first.youtube];
      let artistsPool = [...(first.catalog.artists || []), ...(first.soundCloud.artists || [])];
      let albumsPool = [...(first.catalog.albums || [])];
      let playlistsPool = [...(first.catalog.playlists || []), ...(first.soundCloud.playlists || [])];

      // Typed with the wrong keyboard layout ("фтвн цфкрщд")? Ask again with the swap.
      const swapped = swapKeyboardLayout(q);
      const nonTrackHits = (catalog: SearchResult, query: string) =>
        catalog.artists.filter(artist => normalizeMusicText(artist.name) === normalizeMusicText(query)).length * 4
        + (catalog.albums || []).filter(album => rankAlbum(album, query) >= 500).length * 4;
      if (swapped && strongHits(pool, q) + nonTrackHits(first.catalog, q) < 3) {
        const second = await runSearch(swapped);
        if (strongHits([...second.catalog.tracks, ...second.soundCloud.tracks], swapped) + nonTrackHits(second.catalog, swapped) > strongHits(pool, q) + nonTrackHits(first.catalog, q)) {
          effectiveQuery = swapped;
          notePriors(second.catalog.tracks, 45);
          pool = [...second.catalog.tracks, ...second.soundCloud.tracks, ...second.youtube, ...pool];
          artistsPool = [...(second.catalog.artists || []), ...(second.soundCloud.artists || []), ...artistsPool];
          albumsPool = [...(second.catalog.albums || []), ...albumsPool];
          playlistsPool = [...(second.catalog.playlists || []), ...(second.soundCloud.playlists || []), ...playlistsPool];
          first = second;
        }
      }

      const awaitedHint = await hintPromise;
      // A keyboard-layout swap already reread the query; Yandex's reading of the raw text no longer applies.
      const hint = effectiveQuery === q ? awaitedHint : null;
      if (hint) {
        // Yandex spells the query another way (a fixed typo, the artist's own spelling): search that too
        // when our first answer did not already find it.
        const yq = hint.query;
        if (yq && normalizeMusicText(yq) !== normalizeMusicText(q) && strongHits(pool, yq) + nonTrackHits(first.catalog, yq) < 3) {
          const second = await runSearch(yq);
          if (strongHits([...second.catalog.tracks, ...second.soundCloud.tracks], yq) + nonTrackHits(second.catalog, yq) > strongHits(pool, q) + nonTrackHits(first.catalog, q)) {
            notePriors(second.catalog.tracks, 45);
            pool = [...second.catalog.tracks, ...second.soundCloud.tracks, ...second.youtube, ...pool];
            artistsPool = [...(second.catalog.artists || []), ...(second.soundCloud.artists || []), ...artistsPool];
            albumsPool = [...(second.catalog.albums || []), ...albumsPool];
            playlistsPool = [...(second.catalog.playlists || []), ...(second.soundCloud.playlists || []), ...playlistsPool];
            first = second;
          }
        }
        // A typo Yandex fixed: rank by the fixed text and say so, as «Показаны результаты для …».
        if (hint.corrected && strongHits(pool, yq) > 0) effectiveQuery = yq;
        // Yandex's own order is a strong relevance signal: its top tracks and best artist lead ties.
        hint.priors(pool).forEach((weight, id) => priors.set(id, Math.max(priors.get(id) || 0, weight)));
        hint.priors(artistsPool.map(a => ({ id: a.id, title: '', artist: { name: a.name } }))).forEach((weight, id) => priors.set(id, Math.max(priors.get(id) || 0, weight)));
      }
      const altQuery = !hint ? null : hint.query !== effectiveQuery ? hint.query : effectiveQuery !== q ? q : null;
      const best = (track: Track) => altQuery ? Math.max(score(track, effectiveQuery), score(track, altQuery)) : score(track, effectiveQuery);
      const candidates = pool.sort((a, b) => best(b) - best(a));
      const mergedTracks = deduplicateSearchTracks(candidates);

      // Artists: only names that actually answer the query, best first.
      notePriors(first.catalog.artists || [], 30);
      const mergedArtists = (altQuery ? [...mergeSearchArtists(artistsPool, altQuery, priors), ...mergeSearchArtists(artistsPool, effectiveQuery, priors)] : mergeSearchArtists(artistsPool, effectiveQuery, priors))
        .filter((artist, index, list) => list.findIndex(other => other.id === artist.id) === index);
      notePriors(first.catalog.albums || [], 25);
      const mergedAlbums = deduplicateSearchAlbums(albumsPool
        .map(album => ({ album, score: Math.max(rankAlbum(album, effectiveQuery, priors.get(album.id) || 0), altQuery ? rankAlbum(album, altQuery, priors.get(album.id) || 0) : 0) }))
        .filter(item => item.score > 0).sort((a, b) => b.score - a.score).map(item => item.album));

      // «heavy metal», «фонк», «джаз»: the genre's defining artists and their best-known songs lead,
      // instead of whatever tracks happen to be titled with the genre word.
      const genre = page === 1 ? detectGenre(effectiveQuery) : null;
      let finalTracks = mergedTracks, finalArtists: Artist[] = mergedArtists;
      if (genre) {
        const lookups = await Promise.all(genre.artists.map(name => Promise.race([
          musicCatalogService.search(name, { limit: 10 }).then(r => ({ name, r })),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
        ]).catch(() => null)));
        const perArtist: Track[][] = [], canon: Artist[] = [];
        for (const hit of lookups) {
          if (!hit) continue;
          const artist = [...hit.r.artists].sort((a, b) => rankArtist(b, hit.name) - rankArtist(a, hit.name)).find(a => normalizeMusicText(a.name) === normalizeMusicText(hit.name));
          if (artist) canon.push(artist);
          perArtist.push(hit.r.tracks.filter(t => matchesArtistSeed(t, hit.name)).sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 3));
        }
        // Round-robin so the first screen spans the whole genre rather than one band.
        const genreTracks: Track[] = [];
        for (let round = 0; round < 3; round++) perArtist.forEach(list => { if (list[round]) genreTracks.push(list[round]); });
        finalTracks = deduplicateSearchTracks([...genreTracks, ...mergedTracks.filter(t => (t.popularity ?? 50) >= 35)]);
        const canonNames = new Set(canon.map(a => normalizeMusicText(a.name)));
        // Accounts merely named after the genre («Heavy Metal Kings») are noise unless they have a real audience.
        finalArtists = [...canon, ...mergedArtists.filter(a => !canonNames.has(normalizeMusicText(a.name)) && (a.followersCount || 0) >= 100000)];
      }

      // One artist, one card: profiles whose names fold together («17Seventeen» / «17 SEVENTEEN») collapse into the one with the larger audience.
      {
        const fold = (n: string) => normalizeMusicText(n).replace(/\s+/g, '');
        const best = new Map<string, Artist>();
        for (const a of finalArtists) { const k = fold(a.name || ''), prev = best.get(k); if (!prev || (a.followersCount || 0) > (prev.followersCount || 0)) best.set(k, prev ? { ...a, alsoOn: [...(a.alsoOn || []), ...(prev.alsoOn || []), { source: prev.source, id: prev.id, url: prev.permalinkUrl }] } : a); }
        finalArtists = finalArtists.filter((a, i, list) => list.findIndex(b => fold(b.name || '') === fold(a.name || '')) === i).map(a => best.get(fold(a.name || ''))!);
      }

      const mergedPlaylists = playlistsPool
        .filter(playlist => phraseCoverage(normalizeMusicText(effectiveQuery), normalizeMusicText(playlist.title || '')) >= .5)
        .concat(playlistsPool)
        .filter((playlist, index, list) => list.findIndex(other => other.id === playlist.id) === index);

      // One song, one release: SoundCloud re-uploads give way to the official track.
      finalTracks = await canonicalizeTracks(finalTracks.slice(0, limit * 2 + 10));
      // Yandex's «лучший результат», when our answer holds the same item: the client shows it first.
      const yb = hint?.best;
      const bestHint = !yb ? undefined
        : yb.type === 'artist' ? (() => { const a = finalArtists.find(x => nearlySameName(x.name || '', yb.name)); return a ? { type: 'artist' as const, id: a.id } : undefined; })()
        : yb.type === 'track' ? (() => { const tr = finalTracks.find(x => matchScore(yb.artists.join(', '), yb.title, x) >= 0.95); return tr ? { type: 'track' as const, id: tr.id } : undefined; })()
        : (() => { const al = mergedAlbums.find(x => normalizeMusicText(x.title) === normalizeMusicText(yb.title) && (!yb.artists[0] || nearlySameName(x.artist?.name || '', yb.artists[0]))); return al ? { type: 'album' as const, id: al.id } : undefined; })();
      res.json({
        data: {
          tracks: finalTracks.slice(0, limit * 2),
          artists: finalArtists.slice(0, 10),
          // limit is per provider; returning both pages avoids skipping albums
          // when the next request advances both catalog offsets.
          albums: mergedAlbums.slice(0, limit * 2),
          playlists: mergedPlaylists.slice(0, 12),
          pagination: {
            page,
            limit,
            hasMore: first.catalog.pagination.hasMore || ('pagination' in first.soundCloud && !!first.soundCloud.pagination?.hasMore),
            sections: first.catalog.pagination.sections,
          },
          catalogSource: first.catalog.catalogSource,
          catalogFallbackReason: first.catalog.catalogFallbackReason,
          correctedQuery: effectiveQuery !== q ? effectiveQuery : undefined,
          bestHint,
        },
      });
    } catch (err: any) {
      logger.error({ err }, 'Search controller error');
      next(err);
    }
  };

  public resolveTrack = async (id: string): Promise<Track | null> => {
    if (!id) return null;

    // 1. Try cache
    const cached = await trackCacheRepository.getCachedTrack(id);
    if (cached) {
      return cached;
    }

    // 2. Resolve based on source ID format
    let track: Track | null = null;

    if (id.startsWith('youtube:')) {
      const vidId = id.replace('youtube:', '');
      track = {
        id,
        source: 'licensed',
        sourceId: vidId,
        title: 'YouTube Audio',
        artist: {
          id: 'youtube:unknown',
          source: 'licensed',
          sourceId: 'unknown',
          name: 'YouTube',
        },
        artworkUrl: `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
        duration: 180,
        trackUrl: `https://www.youtube.com/watch?v=${vidId}`,
        access: 'playable',
      };
    } else if (id.startsWith('deezer:')) {
      track = await officialCatalogService.getTrack(id);
    } else if (id.startsWith('spotify:') || id.startsWith('licensed:')) {
      track = await spotifyService.getTrack(id);
    } else if (id.startsWith('soundcloud:')) {
      track = await soundCloudService.getTrack(id);
    } else {
      // Fallback for unknown prefix: try soundCloud then spotify
      try {
        track = await soundCloudService.getTrack(id);
      } catch {}
      if (!track) {
        try {
          track = await spotifyService.getTrack(id);
        } catch {}
      }
    }

    if (track) {
      await trackCacheRepository.setCachedTrack(track).catch(() => {});
    }

    return track;
  };

  public getTrack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const track = await this.resolveTrack(id);

      if (!track) {
        res.status(404).json({
          error: { code: 'TRACK_NOT_FOUND', message: 'Track not found' },
        });
        return;
      }

      res.json({ data: track });
    } catch (err) {
      next(err);
    }
  };

  public getPlaybackInfo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const track = await this.resolveTrack(id);

      if (track) {
        // Return stream URL immediately so frontend audio element begins buffering without lag
        res.json({
          data: {
            available: true,
            type: 'progressive',
            url: `/api/tracks/${encodeURIComponent(track.id)}/stream`,
            expiresAt: Date.now() + 86400000,
            mimeType: 'audio/mp4',
          },
        });
        // Kick off background stream preparation
        if (req.body?.mix === true) warmMixAnalysis(track.id, () => studioMasterService.getExportAudio(track.id)?.path ?? null, () => studioMasterService.prepareExportAudio(track));
        else studioMasterService.prefetch(track);
        spicyLyricsService.warmSpotifyIds([track]);
        return;
      }

      // Fallback for native SoundCloud ID
      if (!id.startsWith('spotify:') && !id.startsWith('licensed:') && !id.startsWith('youtube:')) {
        const playbackInfo = await soundCloudService.getPlaybackInfo(id);
        if (playbackInfo.available) {
          res.json({ data: playbackInfo });
          return;
        }
      }

      res.json({
        data: {
          available: false,
          type: 'none',
          message: 'Аудиодорожка временно недоступна для этого трека.',
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public prefetchTrack = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = (req.body?.trackId || req.query?.trackId || req.params?.id) as string;
      if (!id) {
        res.json({ ok: true });
        return;
      }

      const track = await this.resolveTrack(id);
      if (track) {
        if (req.body?.mix === true) warmMixAnalysis(track.id, () => studioMasterService.getExportAudio(track.id)?.path ?? null, () => studioMasterService.prepareExportAudio(track));
        else studioMasterService.prefetch(track);
        spicyLyricsService.warmSpotifyIds([track]);
      }

      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  };

  public streamAudio = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const track = await this.resolveTrack(id);

      if (!track) {
        res.status(404).json({
          error: { code: 'TRACK_NOT_FOUND', message: 'Track not found' },
        });
        return;
      }

      const recordingId=typeof req.query.recording==='string'?req.query.recording:undefined;
      if(recordingId){
        const source=String(req.query.source||'');
        if(!['youtube','soundcloud'].includes(source)){res.status(400).json({error:{message:'Некорректный источник'}});return;}
        // The list is stored under the resolved track id; an alias in the URL must still find it.
        const stored=await prisma.artistEnrichment.findUnique({where:{id:`recordings:v1:${source}:${track.id}`}})||await prisma.artistEnrichment.findUnique({where:{id:`recordings:v1:${source}:${id}`}});
        const candidate=stored&&(JSON.parse(stored.data) as Track[]).find(t=>t.id===recordingId);
        // A refreshed list may have dropped the chosen recording: play the usual source instead of failing.
        if(candidate){await studioMasterService.handleAudioStream(candidate,req,res,source,true);return;}
      }
      let requestedSource = typeof req.query.source === 'string' && req.query.source!=='auto' ? req.query.source : undefined;
      if(requestedSource&&!['personal','soundcloud','youtube','spotify'].includes(requestedSource)){res.status(400).json({error:{code:'SOURCE_INVALID',message:'Неизвестный источник.'}});return;}
      if(req.query.exact==='1'){
        if(!requestedSource||!['youtube','soundcloud'].includes(requestedSource)||!id.startsWith(`${requestedSource}:`)){res.status(400).json({error:{message:'Некорректная аудиодорожка'}});return;}
        await studioMasterService.handleAudioStream(track,req,res,requestedSource,true);return;
      }
      const userId=res.locals.userId;
      const personal=userId?await prisma.personalTrack.findUnique({where:{userId_trackId:{userId,trackId:id}}}):null;
      if(personal?.audioFileId && (!requestedSource||requestedSource==='personal')){
        const file=await prisma.userFile.findFirst({where:{id:personal.audioFileId,userId}});
        if(file&&existsSync(file.path)){res.setHeader('X-Audio-Source','personal');res.setHeader('Cache-Control','private, no-store');res.type(file.mime).sendFile(file.path);return;}
      }
      if(requestedSource==='personal'){res.status(404).json({error:{code:'PERSONAL_SOURCE_MISSING',message:'Личный файл не найден. Загрузите его снова или выберите другой источник.'}});return;}
      const shared=await prisma.sharedTrackOverride.findUnique({where:{trackId:id}});
      if(shared&&(!requestedSource||requestedSource===shared.platform)){
        const file=shared.audioFileId?await prisma.userFile.findUnique({where:{id:shared.audioFileId}}):null;
        if(file&&existsSync(file.path)){res.setHeader('X-Audio-Source','community');res.type(file.mime).sendFile(file.path);return;}
        if(shared.sourceUrl){
          const url=new URL(shared.sourceUrl);
          if(shared.platform==='youtube'){
            const video=url.hostname==='youtu.be'?url.pathname.slice(1):url.searchParams.get('v')||url.pathname.match(/\/(?:shorts|embed)\/([\w-]+)/)?.[1];
            if(video&&/^[\w-]{11}$/.test(video)){await studioMasterService.handleAudioStream({...track,id:`youtube:${video}`,source:'youtube',sourceId:video,trackUrl:shared.sourceUrl},req,res,'youtube');return;}
          }else if(shared.platform==='soundcloud'){
            const resolved=await soundCloudService.resolveLink(shared.sourceUrl);
            if(resolved.tracks.length===1){await studioMasterService.handleAudioStream(resolved.tracks[0],req,res,'soundcloud');return;}
          }
        }
      }
      if(requestedSource==='spotify')requestedSource=undefined;
      await studioMasterService.handleAudioStream(track, req, res, requestedSource);
    } catch (err) {
      next(err);
    }
  };

  public getArtist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      let artist = null;

      if (id.startsWith('soundcloud:')) {
        artist = await soundCloudService.getArtist(id);
      } else {
        artist = id.startsWith('deezer:') ? await officialCatalogService.getArtist(id) : await spotifyService.getArtist(id);
      }

      if (!artist) {
        res.status(404).json({
          error: { code: 'ARTIST_NOT_FOUND', message: 'Artist not found' },
        });
        return;
      }
      res.json({ data: artist });
    } catch (err) {
      next(err);
    }
  };

  public getArtistTracks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const page = parseInt((req.query.page as string) || '1', 10);
      const limit = parseInt((req.query.limit as string) || '500', 10);

      let tracks = [];
      if (id.startsWith('soundcloud:')) {
        // A SoundCloud profile shows its own songs: other artists' official songs it re-uploaded are dropped.
        tracks = await canonicalizeTracks(await soundCloudService.getArtistTracks(id, { page, limit }), { mode: 'drop', maxLookups: 40, budgetMs: 3000 });
      } else {
        tracks = id.startsWith('deezer:') ? await officialCatalogService.getArtistTracks(id, { page, limit }) : await spotifyService.getArtistTracks(id, { page, limit });
      }

      res.json({ data: tracks });
    } catch (err) {
      next(err);
    }
  };

  public getPlaylist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const playlist = await soundCloudService.getPlaylist(id);
      if (!playlist) {
        res.status(404).json({
          error: { code: 'PLAYLIST_NOT_FOUND', message: 'SoundCloud playlist not found' },
        });
        return;
      }
      res.json({ data: playlist });
    } catch (err) {
      next(err);
    }
  };
}

export const trackController = new TrackController();
