import { officialFor } from './canonicalRelease.js';
import { hasVersion } from '../utils/versionMatch.js';
import { spawn, ChildProcess } from 'node:child_process';
import { ytdlpSearch } from './ytdlpFallback.js';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Request, Response } from 'express';
import { Track } from '../types/index.js';
import { soundCloudService } from './SoundCloudService.js';
import { streamResolverService } from './StreamResolverService.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../database/client.js';
import { foldName, foldedCoverage, namesMatch } from './searchQuery.js';
import {AudioFileError,audioDeadline,completedAudioFile,downloadAudioFile,remuxHlsToFile,type CachedAudio} from './audioFileCache.js';

/** First non-null result; null once every attempt has settled empty. */
function firstResolved<T>(attempts: Array<Promise<T | null>>): Promise<T | null> {
  return new Promise((resolve) => {
    let pending = attempts.length;
    if (!pending) resolve(null);
    for (const attempt of attempts) {
      attempt.then((value) => { if (value) resolve(value); }, () => {}).finally(() => { if (--pending === 0) resolve(null); });
    }
  });
}

// A track that found no source is not searched again for a while: the client
// used to retry, and each retry walked the whole chain from scratch.
const UNAVAILABLE_TTL = 30 * 1000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ResolvedMaster {
  audioSource?: string;
  streamUrl: string;
  duration: number;
  title: string;
  channel: string;
  mimeType: string;
  expiresAt: number;
  /** A playlist (SoundCloud HLS), remuxed into the disk cache before it is served. */
  hls?: boolean;
}

interface WorkerResponse {
  id: string;
  success: boolean;
  candidate?: {
    streamUrl: string;
    duration: number;
    title: string;
    channel: string;
    score?: number;
    uploadDate?: string;
    reissue?: { pYear: number; released: string };
  } | null;
  reissue?: { pYear: number; released: string } | null;
  cutoff?: string;
  items?: any[];
  error?: string;
}

/** Markers of censored editions; never preferred unless the requested title carries them. */
const CENSORED = ['clean', 'censored', 'radio edit', 'radio version', 'цензур', 'без мата', 'bleeped', 'edited'];

export class StudioMasterService {
  private cacheDir: string;
  private urlCache = new Map<string, ResolvedMaster>();
  private inFlightResolutions = new Map<string, Promise<ResolvedMaster | null>>();
  private unavailableUntil = new Map<string, number>();
  private inFlightDownloads = new Map<string,Promise<CachedAudio>>();
  private get pythonPath(): string {
    return this.getPythonPath() || 'python';
  }
  private workerProcess: ChildProcess | null = null;
  private workerReady = false;
  private workerDisabled = false;
  private workerFailedAttempts = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (val: WorkerResponse) => void;
      reject: (err: any) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private requestIdCounter = 0;

  constructor() {
    // Bump the cache namespace whenever resolver rules change. This prevents a
    // previously accepted user upload from surviving a stricter provenance fix.
    this.cacheDir = path.resolve(process.cwd(), 'server', 'data', 'audio_cache_originals_v7');
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (err) {
      logger.error({ err }, 'Failed to create audio cache directory');
    }
    // Pre-warm the background Python worker process immediately
    this.ensureWorker();
  }

  private getPythonPath(): string | null {
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
      return process.env.PYTHON_PATH;
    }
    const candidates = [
      path.resolve('.venv/bin/python'),
      path.resolve('.venv/Scripts/python.exe'),
      'C:\\Python314\\python.exe',
      'C:\\Python313\\python.exe',
      'C:\\Python312\\python.exe',
      'C:\\Python311\\python.exe',
      'C:\\Python310\\python.exe',
      'C:\\Program Files\\Python312\\python.exe',
      'C:\\Program Files\\Python311\\python.exe',
      '/usr/bin/python3',
      '/usr/local/bin/python3',
      '/usr/bin/python',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    // Fallback to command name if available in system PATH
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  private getFfmpegLocation(): string {
    if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
      return process.env.FFMPEG_PATH;
    }
    const wingetCandidate = path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft',
      'WinGet',
      'Links'
    );
    if (wingetCandidate && fs.existsSync(wingetCandidate)) {
      return wingetCandidate;
    }
    return '';
  }

  private getWorkerScriptPath(): string | null {
    const candidates = [
      path.resolve(__dirname, 'ytdlp_worker.py'),
      path.resolve(__dirname, '../../server/src/services/ytdlp_worker.py'),
      path.resolve(process.cwd(), 'server/src/services/ytdlp_worker.py'),
      path.resolve(process.cwd(), 'dist-server/services/ytdlp_worker.py'),
      path.join((process as any).resourcesPath || '', 'app.asar.unpacked', 'dist-server', 'services', 'ytdlp_worker.py'),
      path.join((process as any).resourcesPath || '', 'app.asar.unpacked', 'server', 'src', 'services', 'ytdlp_worker.py'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  private ensureWorker(): ChildProcess | null {
    if (this.workerDisabled) return null;
    if (this.workerProcess && !this.workerProcess.killed && this.workerProcess.exitCode === null) {
      return this.workerProcess;
    }

    const pythonPath = this.getPythonPath();
    const workerScript = this.getWorkerScriptPath();

    if (!pythonPath || !workerScript) {
      if (!this.workerDisabled) {
        logger.warn({ pythonPath, workerScript }, 'Python worker unavailable, skipping YouTube worker');
      }
      this.workerDisabled = true;
      return null;
    }

    try {
      const worker = spawn(pythonPath, [workerScript], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
      });

      worker.on('error', (err) => {
        logger.warn({ err }, 'Python worker process error');
        this.workerProcess = null;
        this.workerReady = false;
        this.workerFailedAttempts++;
        if (this.workerFailedAttempts >= 3) {
          this.workerDisabled = true;
        }
      });

      const rl = readline.createInterface({
        input: worker.stdout!,
        terminal: false,
      });

      rl.on('line', (line) => {
        const str = line.trim();
        if (!str) return;
        try {
          const msg = JSON.parse(str);
          if (msg.status === 'READY') {
            this.workerReady = true;
            this.workerFailedAttempts = 0;
            logger.info('ytdlp_worker is READY and pre-warmed for ultra-fast audio resolution');
            return;
          }

          if (msg.id && this.pendingRequests.has(msg.id)) {
            const { resolve, timer } = this.pendingRequests.get(msg.id)!;
            clearTimeout(timer);
            this.pendingRequests.delete(msg.id);
            resolve(msg);
          }
        } catch (err) {
          logger.error({ err, line: str }, 'Failed to parse worker output');
        }
      });

      worker.on('exit', (code, signal) => {
        logger.warn({ code, signal }, 'ytdlp_worker exited');
        this.workerProcess = null;
        this.workerReady = false;
        this.workerFailedAttempts++;
        if (this.workerFailedAttempts >= 3) {
          this.workerDisabled = true;
        }
        for (const [id, req] of this.pendingRequests) {
          clearTimeout(req.timer);
          req.reject(new Error(`Worker exited with code ${code}`));
        }
        this.pendingRequests.clear();
      });

      this.workerProcess = worker;
      return worker;
    } catch (err) {
      logger.warn({ err }, 'Failed to spawn Python worker');
      this.workerDisabled = true;
      return null;
    }
  }

  private sendWorkerRequest(req: any, timeoutMs = 20000): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      try {
        const worker = this.ensureWorker();
        if (!worker) {
          return reject(new Error('Python worker is not available'));
        }
        const id = `req_${++this.requestIdCounter}_${Date.now()}`;
        req.id = id;

        const timer = setTimeout(() => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            reject(new Error('Worker request timed out'));
          }
        }, timeoutMs);

        this.pendingRequests.set(id, { resolve, reject, timer });
        worker.stdin!.write(JSON.stringify(req) + '\n');
      } catch (err) {
        reject(err);
      }
    });
  }

  private sanitizeFilename(str: string): string {
    return str.replace(/[^a-zA-Z0-9_\-]/g, '_');
  }

  /** Bumped when source selection changes in a way cached audio must not survive
   * (v2: pitched copies rejected, pre-re-release originals preferred). */
  private static readonly CACHE_VERSION = 2;
  private getDiskCachePath(trackId: string): string {
    return path.join(this.cacheDir, `${this.sanitizeFilename(trackId)}.v${StudioMasterService.CACHE_VERSION}.m4a`);
  }

  private originalChecks = new Map<string, { at: number; value: ResolvedMaster | null }>();
  /** Russian 2026 re-releases replaced older songs with muted ("censored") audio under the same title, length and
   * channel. For such songs the most-watched exact-length copy uploaded before the re-release is the original. */
  private async findOriginalEdition(track: Track, cleanTitle: string, cleanArtist: string, targetDuration: number): Promise<ResolvedMaster | null> {
    if (!/[\u0400-\u04FF]/.test(`${track.artist.name} ${track.title}`)) return null;
    const known = this.originalChecks.get(track.id);
    if (known && Date.now() - known.at < (known.value ? 4 * 3600_000 : 30 * 24 * 3600_000)) return known.value;
    const stored = await prisma.artistEnrichment.findUnique({ where: { id: `orig1:${track.id}` } }).catch(() => null);
    if (stored && Date.now() - stored.updatedAt.getTime() < 30 * 24 * 3600_000 && JSON.parse(stored.data).reissue === null) {
      this.originalChecks.set(track.id, { at: Date.now(), value: null });
      return null;
    }
    try {
      const cutoff = await streamResolverService.reissueUploadDate(cleanArtist, cleanTitle, targetDuration);
      const res = await this.sendWorkerRequest({ action: 'original', cleanTitle, cleanArtist, targetDuration, cutoff }, 30000);
      if (!res.success) return null;
      await prisma.artistEnrichment.upsert({ where: { id: `orig1:${track.id}` }, create: { id: `orig1:${track.id}`, data: JSON.stringify({ reissue: res.reissue ?? null, cutoff: res.cutoff, original: res.candidate ? { title: res.candidate.title, channel: res.candidate.channel, uploadDate: res.candidate.uploadDate } : null }) }, update: { data: JSON.stringify({ reissue: res.reissue ?? null, cutoff: res.cutoff, original: res.candidate ? { title: res.candidate.title, channel: res.candidate.channel, uploadDate: res.candidate.uploadDate } : null }) } }).catch(() => {});
      const value: ResolvedMaster | null = res.candidate?.streamUrl ? { streamUrl: res.candidate.streamUrl, audioSource: 'youtube', duration: res.candidate.duration || targetDuration, title: res.candidate.title || track.title, channel: res.candidate.channel || track.artist.name, mimeType: 'audio/mp4', expiresAt: Date.now() + 1000 * 60 * 60 * 5 } : null;
      if (res.reissue) logger.info({ trackId: track.id, reissue: res.reissue, cutoff: res.cutoff, original: res.candidate ? `${res.candidate.title} · ${res.candidate.channel} · ${res.candidate.uploadDate}` : null }, 'Re-released song: original edition lookup');
      this.originalChecks.set(track.id, { at: Date.now(), value });
      if (this.originalChecks.size > 2000) this.originalChecks.delete(this.originalChecks.keys().next().value!);
      return value;
    } catch (err) {
      logger.debug({ err, trackId: track.id }, 'Original edition lookup failed');
      return null;
    }
  }

  /** Completed cached audio only; never expose temporary files or arbitrary paths. */
  public getExportAudio(trackId: string): { path: string; size: number; extension: string; mime: string } | null {
    if (!/^(soundcloud|spotify|deezer|youtube|licensed):[a-zA-Z0-9:_-]{1,180}$/.test(trackId)) return null;
    return completedAudioFile(this.getDiskCachePath(trackId),49*1024*1024);
  }

  private normalize(str: string): string {
    return (str || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  public async prepareExportAudio(track:Track) {
    const cached=this.getExportAudio(track.id);if(cached)return cached;
    const master=await audioDeadline(this.resolveStudioStream(track),45000,'Поиск полного аудио занял слишком долго. Попробуйте позже.');
    if(!master||master.audioSource==='deezer')throw new AudioFileError('Полный аудиофайл недоступен.');
    if(master.streamUrl.startsWith('https://')){
      try{await this.downloadToCache(track.id,master.streamUrl);}
      catch(error){if(this.urlCache.get(track.id)?.streamUrl===master.streamUrl)this.urlCache.delete(track.id);throw error;}
    }
    const file=this.getExportAudio(track.id);if(file)return file;
    throw new AudioFileError('Полный MP3 или M4A этой версии недоступен либо превышает 49 МБ.');
  }

  /**
   * Resolves the authentic studio master stream URL for a given official track.
   * Uses in-flight promise de-duplication to prevent race conditions and queue congestion.
   */
  public async resolveStudioStream(track: Track, preferredSource?: string, exactRecording = false): Promise<ResolvedMaster | null> {
    // 1. In-memory cache check
    const cached = this.urlCache.get(track.id);
    if (cached && Date.now() < cached.expiresAt && (!preferredSource || cached.audioSource === preferredSource)) {
      return cached;
    }

    // 2. Disk cache check
    const diskPath = this.getDiskCachePath(track.id);
    if (!preferredSource) {
      const audio=completedAudioFile(diskPath);
      if (audio) {
        const resolved: ResolvedMaster = {
          streamUrl: `file://${diskPath}`,
          audioSource: 'cache',
          duration: track.duration,
          title: track.title,
          channel: track.artist.name,
          mimeType: audio.mime,
          expiresAt: Date.now() + 86400000 * 7,
        };
        this.urlCache.set(track.id, resolved);
        return resolved;
      }
    }

    // 3. In-flight promise de-duplication: reuse active resolution if already in progress
    const resolutionKey = `${track.id}:${preferredSource || 'auto'}`;
    if (this.inFlightResolutions.has(resolutionKey)) {
      return this.inFlightResolutions.get(resolutionKey)!;
    }

    if ((this.unavailableUntil.get(resolutionKey) || 0) > Date.now()) return null;

    const promise = this.performResolve(track, preferredSource, exactRecording).then((resolved) => {
      // Keep an explicitly selected source warm for the range request that
      // follows the probe. A source mismatch is never reused for another
      // explicit choice.
      if (resolved) { this.urlCache.set(track.id, resolved); this.unavailableUntil.delete(resolutionKey); }
      else this.unavailableUntil.set(resolutionKey, Date.now() + UNAVAILABLE_TTL);
      return resolved;
    }).finally(() => {
      this.inFlightResolutions.delete(resolutionKey);
    });

    this.inFlightResolutions.set(resolutionKey, promise);
    return promise;
  }

  public parseAnimeTrack(rawTitle: string, rawArtist?: string): { title: string; artist: string; isAnimeCut: boolean } {
    const titleLower = (rawTitle || '').toLowerCase();
    const isAnimeCut =
      rawTitle.includes('ノンクレジット') ||
      rawTitle.includes('オープニング') ||
      rawTitle.includes('エンディング') ||
      rawTitle.includes('TVアニメ') ||
      rawTitle.includes('OP映像') ||
      rawTitle.includes('ED映像') ||
      titleLower.includes('creditless') ||
      titleLower.includes('non-credit') ||
      titleLower.includes('trailer') ||
      titleLower.includes('teaser') ||
      titleLower.includes('cm') ||
      titleLower.includes('pv') ||
      titleLower.includes('commercial');

    if (!isAnimeCut) {
      return { title: rawTitle, artist: rawArtist || '', isAnimeCut: false };
    }

    const parts = (rawTitle || '').split(/\s*[｜／\|\/—]\s*/).map((p) => p.trim()).filter(Boolean);
    let songPart = '';

    if (parts.length > 1) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (
          !p.startsWith('TVアニメ') &&
          !p.startsWith('【ノンクレジット') &&
          !p.startsWith('【公式】') &&
          !p.startsWith('アニメ')
        ) {
          songPart = p;
          break;
        }
      }
      if (!songPart) {
        songPart = parts[parts.length - 1];
      }
    } else {
      songPart = rawTitle;
    }

    let title = '';
    let artist = '';

    const bracketMatch = songPart.match(/(?:OPテーマ[：:]|EDテーマ[：:]|主題歌[：:]|\s+)?(.*?)[「『](.*?)[」』](.*)/);
    if (bracketMatch) {
      artist = bracketMatch[1].replace(/【.*?】/g, '').replace(/TVアニメ.*$/g, '').trim();
      title = bracketMatch[2].trim();
      const extra = bracketMatch[3] ? bracketMatch[3].trim() : '';
      if (extra && /feat\./i.test(extra)) {
        title += ' ' + extra;
      }
    }

    if (!title) {
      title = songPart
        .replace(/【.*?】/g, '')
        .replace(/TVアニメ[「『].*?[」』]/g, '')
        .replace(/(?:ノンクレジット|オープニング映像|エンディング映像|OP|ED|creditless|opening|ending)/gi, '')
        .trim();
    }

    if (!artist && rawArtist && !rawArtist.includes('公式') && !rawArtist.includes('Official') && !rawArtist.includes('CHANNEL')) {
      artist = rawArtist;
    }

    return { title: title.trim() || rawTitle, artist: artist.trim() || rawArtist || '', isAnimeCut: true };
  }

  private async performResolve(track: Track, preferredSource?: string, exactRecording = false): Promise<ResolvedMaster | null> {
    const animeCheck = this.parseAnimeTrack(track.title, track.artist?.name);

    // Spotify exposes metadata through its Web API, but not a raw audio URL.
    // Actual Spotify playback belongs to the Web Playback SDK (Premium + OAuth)
    // and is intentionally reported as unavailable by this server resolver.
    if (preferredSource === 'spotify') return null;

    // Deezer's public URL on an imported track is normally a 30-second preview.
    // Honour an explicit choice, but label it as a preview instead of silently
    // substituting a different service.
    if (preferredSource === 'deezer' && track.source==='deezer' && track.streamUrl?.startsWith('https://') && new URL(track.streamUrl).hostname.endsWith('.dzcdn.net')) {
      return { streamUrl: track.streamUrl, audioSource: 'deezer', duration: Math.min(track.duration, 30), title: track.title, channel: track.artist.name, mimeType: 'audio/mpeg', expiresAt: Date.now() + 15 * 60 * 1000 };
    }

    // 0. If track is from YouTube (direct video ID from search or link) AND NOT a TV anime cut/commercial
    if (preferredSource !== 'soundcloud' && track.id.startsWith('youtube:') && (!animeCheck.isAnimeCut || exactRecording)) {
      const vidId = track.sourceId;
      try {
        const res = await this.sendWorkerRequest({
          action: 'resolve_url',
          url: `https://www.youtube.com/watch?v=${vidId}`,
        });
        if (res.success && res.candidate?.streamUrl) {
          const resolved: ResolvedMaster = {
            streamUrl: res.candidate.streamUrl,
            audioSource: 'youtube',
            duration: res.candidate.duration || track.duration,
            title: res.candidate.title || track.title,
            channel: res.candidate.channel || track.artist.name,
            mimeType: 'audio/mp4',
            expiresAt: Date.now() + 1000 * 60 * 60 * 5,
          };
          this.urlCache.set(track.id, resolved);
          this.cacheStreamToDisk(track.id, res.candidate.streamUrl);
          return resolved;
        }
      } catch (ytErr) {
        logger.debug({ ytErr, trackId: track.id }, 'Direct YouTube stream resolution failed, proceeding to query resolver');
      }
    }

    // 0. If track is from SoundCloud, resolve its authentic progressive audio stream directly if not HLS/preview
    if (preferredSource !== 'youtube' && (track.source === 'soundcloud' || track.id.startsWith('soundcloud:'))) {
      try {
        const pb = await soundCloudService.getPlaybackInfo(`soundcloud:${track.sourceId}`);
        const isM3U8 = pb?.url?.includes('.m3u8') || pb?.type === 'hls';
        if (isM3U8 && pb.url) this.hlsUrls.add(pb.url);
        const isPreview = pb?.url?.includes('/preview/') || pb?.url?.includes('preview') || pb?.url?.includes('snip');
        if (pb && pb.available && pb.url && pb.url.startsWith('http') && !isPreview) {
          const resolved: ResolvedMaster = {
            streamUrl: pb.url,
            audioSource: 'soundcloud',
            duration: track.duration,
            title: track.title,
            channel: track.artist.name,
            mimeType: pb.mimeType || 'audio/mpeg',
            expiresAt: pb.expiresAt || (Date.now() + 1000 * 60 * 60 * 3),
            hls: isM3U8,
          };
          this.urlCache.set(track.id, resolved);
          this.cacheStreamToDisk(track.id, pb.url);
          return resolved;
        }
      } catch (scErr) {
        logger.debug({ scErr, trackId: track.id }, 'SoundCloud direct stream failed, proceeding to studio master resolver');
      }
    }

    // A censorship vote must describe the selected upload, so never substitute a search result.
    if (exactRecording) return null;

    let cleanTitle = animeCheck.isAnimeCut ? animeCheck.title : track.title;
    let cleanArtist = animeCheck.isAnimeCut && animeCheck.artist ? animeCheck.artist : track.artist.name.split(',')[0].trim();

    if (!animeCheck.isAnimeCut) {
      cleanTitle = cleanTitle
        .replace(/\s*[\(\[][^\)\]]*(?:official|audio|video|prod|feat|ft)[\)\]]/gi, '')
        .replace(/\s+(?:feat\.?|ft\.?)\s+.*$/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
    if (!cleanTitle) cleanTitle = track.title;

    if (cleanTitle.toLowerCase().startsWith(cleanArtist.toLowerCase() + ' -')) {
      cleanTitle = cleanTitle.slice(cleanArtist.length + 2).trim();
    } else if (cleanTitle.toLowerCase().startsWith(cleanArtist.toLowerCase() + ' –')) {
      cleanTitle = cleanTitle.slice(cleanArtist.length + 2).trim();
    } else if (cleanTitle.toLowerCase().startsWith(cleanArtist.toLowerCase() + ' —')) {
      cleanTitle = cleanTitle.slice(cleanArtist.length + 2).trim();
    }

    // The reference length is the official release's, not the upload's own: a sped-up or slowed copy in a library
    // would otherwise make the resolver look for another copy at the same wrong speed.
    let referenceDuration = track.duration || 0;
    if (!animeCheck.isAnimeCut && ['soundcloud', 'licensed', 'youtube'].includes(track.source)) {
      const official = await Promise.race([officialFor(track), new Promise<null>(r => setTimeout(() => r(null), 1500))]);
      if (official?.duration) referenceDuration = official.duration;
    }
    const targetDuration = animeCheck.isAnimeCut ? 0 : referenceDuration;
    const queries = [
      `${cleanArtist} - ${cleanTitle}`,
      // Label uploads carry this line; it surfaces official audio that plain
      // searches bury under re-uploads.
      `${cleanArtist} ${cleanTitle} "Provided to YouTube"`,
    ];
    // Compilations credit the label first («BRN1NG BRAIN SOUND INDUSTRIES, Onion Room»): every credited name may own the upload.
    const altArtists = track.artist.name.split(',').slice(1).map(name => name.trim()).filter(Boolean);
    const allowSoundCloud = preferredSource === 'soundcloud' || (!preferredSource && track.source !== 'youtube' && track.source !== 'licensed');
    const allowYouTube = !preferredSource || preferredSource === 'youtube';
    let workerAnswered = false;

    // An artist-owned SoundCloud upload is the most faithful copy of an
    // independent release.
    const viaSoundCloud = async (): Promise<ResolvedMaster | null> => {
      if (!allowSoundCloud) return null;
      try {
        const clientId = await streamResolverService.getFreshClientId();
        const sc = await streamResolverService.searchAndResolve(`${cleanArtist} ${cleanTitle}`, cleanTitle, cleanArtist, targetDuration, clientId);
        if (sc.available && sc.url) {
          const hls = sc.type === 'hls' || sc.url.includes('.m3u8');
          if (hls) this.hlsUrls.add(sc.url);
          return { streamUrl: sc.url, audioSource: 'soundcloud', duration: track.duration, title: track.title, channel: track.artist.name, mimeType: hls ? 'audio/mp4' : sc.mimeType || 'audio/mpeg', expiresAt: sc.expiresAt || Date.now() + 3 * 60 * 60 * 1000, hls };
        }
      } catch (err) { logger.debug({ err, trackId: track.id }, 'SoundCloud source unavailable'); }
      return null;
    };

    // Warm yt-dlp worker: flat search, then stream extraction (~2–4s).
    const viaWorker = async (query: string): Promise<ResolvedMaster | null> => {
      try {
        logger.info({ trackId: track.id, query }, 'Resolving studio master via warm Python worker');
        const res = await this.sendWorkerRequest({ action: 'resolve', query, cleanTitle, cleanArtist, targetDuration, altArtists, album: track.release?.title }, 25000);
        workerAnswered = true;
        if (res.success && res.candidate?.streamUrl) {
          const best = res.candidate;
          logger.info({ trackId: track.id, matchedTitle: best.title, channel: best.channel, duration: best.duration, score: best.score }, 'Resolved studio master via warm worker');
          return { streamUrl: best.streamUrl, audioSource: 'youtube', duration: best.duration || targetDuration, title: best.title || track.title, channel: best.channel || track.artist.name, mimeType: 'audio/mp4', expiresAt: Date.now() + 1000 * 60 * 60 * 5 };
        }
      } catch (workerErr) {
        logger.warn({ err: workerErr, trackId: track.id, query }, 'Worker resolution failed or timed out');
      }
      return null;
    };
    const viaYouTube = async (): Promise<ResolvedMaster | null> => {
      if (!allowYouTube) return null;
      return (await viaWorker(queries[0])) ?? (await viaWorker(queries[1]));
    };

    // A re-released song is checked alongside: when the label replaced its audio, the original wins.
    const original = !animeCheck.isAnimeCut && (!preferredSource || preferredSource === 'youtube') ? this.findOriginalEdition(track, cleanTitle, cleanArtist, targetDuration) : Promise.resolve(null);

    // Both paths verify the artist and the duration, so the first answer wins
    // instead of waiting for SoundCloud before even asking YouTube.
    let resolved = await firstResolved([viaSoundCloud(), viaYouTube()]);
    const originalEdition = await original;
    if (originalEdition) resolved = originalEdition;

    // The one-shot yt-dlp process only helps when the worker itself is down;
    // a worker that answered "no match" would give the same answer slower.
    if (!resolved && allowYouTube && !workerAnswered) resolved = await this.resolveViaExec(track, queries[0], cleanTitle, cleanArtist, targetDuration);

    if (resolved) {
      this.urlCache.set(track.id, resolved);
      this.cacheStreamToDisk(track.id, resolved.streamUrl);
    }
    return resolved;
  }

  private async resolveViaExec(track: Track, query: string, cleanTitle: string, cleanArtist: string, targetDuration: number): Promise<ResolvedMaster | null> {
    const pyBin = this.pythonPath;
    try {
      logger.info({ trackId: track.id, query }, 'Resolving studio master via direct exec fallback');
      const stdout = await ytdlpSearch(pyBin, this.getFfmpegLocation(), query);
      const lines = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
      const targetCombined = `${cleanTitle} ${cleanArtist}`.toLowerCase();
      const modifierKeywords = [
        'cover', 'кавер', 'karaoke', 'караоке', 'nightcore', 'sped up', 'slowed',
        'reverb', 'bass boost', '8d audio', 'tribute', 'remix', 'ремикс', 'speed up', 'mashup', 'live', 'instrumental', 'минус', 'ремейк', 'remake'
      ];
      const promoKeywords = [
        'trailer', 'teaser', 'трейлер', 'тизер', 'реклама', 'cm', 'pv', 'promo', 'промо',
        'commercial', 'announcement', 'анонс', 'превью', 'ノンクレジット'
      ];
      const allowedKeywords = modifierKeywords.filter((kw) => hasVersion(targetCombined, kw));
      const titleTokens = foldName(cleanTitle).split(' ').filter((t) => t.length >= 2);
      const candidates: Array<{ streamUrl: string; durSec: number; candTitle: string; channel: string; score: number }> = [];

      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length < 5) continue;
        const durSec = parseInt(parts[0], 10) || 0;
        const views = parseInt(parts[1], 10) || 0;
        const candTitle = parts[2];
        const channel = parts[3];
        const streamUrl = parts.slice(4).join('|');
        if (!streamUrl.startsWith('http')) continue;
        const titleLower = candTitle.toLowerCase();

        // Folded comparison: a Cyrillic channel matches a Latin catalogue name.
        const topic = channel.toLowerCase().endsWith('- topic');
        if (cleanArtist && !namesMatch(cleanArtist, topic ? channel.slice(0, -8) : channel)) continue;

        const ratio = foldedCoverage(candTitle, cleanTitle);
        const hasTitle = foldName(candTitle).includes(foldName(cleanTitle)) || ratio >= 0.4 || (titleTokens.length <= 2 && ratio > 0);
        if (!hasTitle) continue;
        let score = 200 + Math.round(ratio * 150);

        if (modifierKeywords.some((kw) => hasVersion(titleLower, kw) && !allowedKeywords.includes(kw))) continue;
        if (promoKeywords.some((kw) => hasVersion(titleLower, kw) && !hasVersion(targetCombined, kw))) score -= 1500;

        const durDiff = Math.abs(durSec - targetDuration);
        if (targetDuration > 30 && durSec > 0 && durDiff > 8) continue;
        if (durDiff <= 2) score += 350;
        else if (durDiff <= 5) score += 200;
        else if (durDiff <= 12) score += 100;
        else score -= durDiff * 5;

        if (topic) score += 350;
        if (titleLower.includes('(audio)') || titleLower.includes('[audio]')) score += 250;
        else if (titleLower.includes('official audio')) score += 280;
        if (titleLower.includes('official video') || titleLower.includes('official music video') || titleLower.includes('клип')) score += 100;
        // Censored re-releases share title, length and channel with the original; the original keeps its audience.
        if (!CENSORED.some((kw) => hasVersion(targetCombined, kw)) && CENSORED.some((kw) => hasVersion(titleLower, kw))) score -= 900;
        score += Math.round(Math.min(260, 40 * Math.log10(views + 1)));
        candidates.push({ streamUrl, durSec, candTitle, channel, score });
      }

      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      if (best) return { streamUrl: best.streamUrl, audioSource: 'youtube', duration: best.durSec, title: best.candTitle, channel: best.channel, mimeType: 'audio/mp4', expiresAt: Date.now() + 1000 * 60 * 60 * 5 };
    } catch (err) {
      logger.error({ err, trackId: track.id }, 'Error during yt-dlp direct exec fallback');
    }
    return null;
  }

  /**
   * Automatically downloads resolved audio stream to local disk cache in background
   * so all subsequent plays start with 0ms local latency.
   */
  private hlsUrls = new Set<string>();
  private downloadToCache(trackId:string,url:string):Promise<CachedAudio> {
    const pending=this.inFlightDownloads.get(trackId);if(pending)return pending;
    const hls=this.hlsUrls.has(url)||url.includes('.m3u8');
    if(this.hlsUrls.size>2000)this.hlsUrls.clear();
    const operation=(hls?remuxHlsToFile(url,this.getDiskCachePath(trackId)):downloadAudioFile(url,this.getDiskCachePath(trackId))).finally(()=>this.inFlightDownloads.delete(trackId));
    this.inFlightDownloads.set(trackId,operation);
    return operation;
  }

  private cacheStreamToDisk(trackId: string, url: string): void {
    if(!url.startsWith('https://'))return;
    // Playback and Telegram export share the same download instead of writing
    // concurrently into one temporary file. Export receives the actual failure.
    void this.downloadToCache(trackId,url).catch(error=>logger.debug({trackId,message:error instanceof Error?error.message:String(error)},'Audio cache download failed'));
  }

  /**
   * Pre-fetches and pre-caches the studio master for an upcoming track in the queue.
   * Runs in the background without blocking the caller.
   */
  public prefetch(track: Track): void {
    if (!track || !track.id) return;
    if (this.urlCache.has(track.id) || fs.existsSync(this.getDiskCachePath(track.id))) {
      return;
    }
    // Hover and queue warm-ups are a bonus: they never take the resolver away from a song someone pressed play on.
    if (this.inFlightResolutions.size >= 3) return;
    this.resolveStudioStream(track).catch((err) => {
      logger.debug({ err, trackId: track.id }, 'Background prefetch error');
    });
  }

  /**
   * Proxies audio stream with full HTTP 206 Partial Content (Range requests) support.
   */
  public async handleAudioStream(track: Track, req: Request, res: Response, preferredSource?: string, exactRecording = false): Promise<void> {
    if(preferredSource==='auto')preferredSource=undefined;
    const requested=track;
    if(preferredSource&&!['youtube','soundcloud','deezer'].includes(preferredSource)){res.status(400).json({error:{message:'Этот источник воспроизведения не подключён.'}});return;}
    if(preferredSource)track={...track,id:`${track.id}:playback:${preferredSource}${exactRecording?':exact':''}`};
    const diskPath = this.getDiskCachePath(track.id);

    // If already saved on disk, stream directly from disk with Range support
    if (!preferredSource && fs.existsSync(diskPath)) {
      const stats = fs.statSync(diskPath);
      if (stats.size > 500000) {
        res.setHeader('X-Audio-Source', this.urlCache.get(track.id)?.audioSource || 'cache');
        this.streamLocalFile(diskPath, stats.size, req, res);
        return;
      }
    }

    // Check in-memory URL cache first (instant, no I/O)
    const cachedMaster = this.urlCache.get(track.id);
    if (cachedMaster && Date.now() < cachedMaster.expiresAt && (!preferredSource || cachedMaster.audioSource === preferredSource)) {
      // Already resolved — stream directly
      const master = cachedMaster;
      res.setHeader('X-Audio-Source', master.audioSource || 'unknown');
      if (master.streamUrl.startsWith('file://')) {
        const filePath = master.streamUrl.replace('file://', '');
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          this.streamLocalFile(filePath, stats.size, req, res);
          return;
        }
      }
      if (master.hls) return this.serveHls(master, track, req, res);
      // Proxy from URL (fall through to proxy logic below)
      return this.proxyStream(master.streamUrl, track, diskPath, req, res);
    }

    // Keep the first media request alive while resolving. An immediate 503 made
    // HTMLAudio fail and added the client's retry delay even for fast resolutions.
    const master = await this.resolveStudioStream(track, preferredSource, exactRecording);
    if (res.destroyed || req.aborted) return;
    if (master) {
      res.setHeader('X-Audio-Source', master.audioSource || 'unknown');
      if (master.streamUrl.startsWith('file://')) {
        const filePath = master.streamUrl.slice(7);
        if (fs.existsSync(filePath)) { this.streamLocalFile(filePath, fs.statSync(filePath).size, req, res); return; }
      } else if (master.hls) { await this.serveHls(master, track, req, res); return; }
      else { await this.proxyStream(master.streamUrl, track, diskPath, req, res); return; }
    }
    // A chosen source is a preference, not a wall: a song that is not on SoundCloud (or YouTube) still plays,
    // from the automatic choice, and the player is told which source stood in.
    if (preferredSource && !exactRecording && !res.headersSent) {
      res.setHeader('X-Source-Fallback', preferredSource);
      return this.handleAudioStream(requested, req, res, undefined, false);
    }
    // The request was held for the whole resolution, so an empty result is
    // final: report it instead of inviting the client to start over.
    res.status(404).json({ error: { code: 'AUDIO_UNAVAILABLE', message: 'Для этого трека не нашлось полной аудиодорожки.' } });
  }

  /** HLS can't be proxied byte-for-byte to an <audio> element: the remuxed file is served with Range support instead (~2–5 s once per song). */
  private async serveHls(master: ResolvedMaster, track: Track, req: Request, res: Response): Promise<void> {
    try {
      this.hlsUrls.add(master.streamUrl);
      const file = await this.downloadToCache(track.id, master.streamUrl);
      if (res.destroyed || req.aborted) return;
      this.streamLocalFile(file.path, file.size, req, res);
    } catch (error) {
      logger.warn({ trackId: track.id, message: error instanceof Error ? error.message : String(error) }, 'SoundCloud HLS remux failed');
      this.urlCache.delete(track.id);
      if (!res.headersSent) res.status(502).json({ error: { code: 'AUDIO_REMUX_FAILED', message: 'Не удалось подготовить аудио. Попробуйте ещё раз.' } });
    }
  }

  private async proxyStream(streamUrl: string, track: Track, diskPath: string, req: Request, res: Response): Promise<void> {
    // Proxy the remote studio stream to the client with Range forwarding and clean abort on disconnect
    const abortController = new AbortController();
    let writeStream: fs.WriteStream | null = null;

    const cleanup = () => {
      try {
        abortController.abort();
      } catch {}
      if (writeStream && !writeStream.destroyed) {
        try {
          writeStream.destroy();
        } catch {}
      }
    };

    // An IncomingMessage can emit `close` as soon as its request has been
    // received. That does not mean the client has finished reading the audio.
    res.on('close', () => { if (!res.writableEnded) cleanup(); });
    req.on('aborted', cleanup);
    req.on('error', cleanup);

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      let upstreamRes = await fetch(streamUrl, {
        headers,
        signal: abortController.signal,
      });

      // If upstream expired (e.g. 403 Forbidden or 410 Gone), invalidate cache and re-resolve once
      if (upstreamRes.status === 403 || upstreamRes.status === 410) {
        logger.warn({ trackId: track.id, status: upstreamRes.status }, 'Upstream stream expired, re-resolving');
        this.urlCache.delete(track.id);
        const source=typeof req.query.source==='string'&&req.query.source!=='auto'?req.query.source:undefined;
        const freshMaster = await this.resolveStudioStream(track,source);
        if (freshMaster?.streamUrl) {
          upstreamRes = await fetch(freshMaster.streamUrl, {
            headers,
            signal: abortController.signal,
          });
        }
      }

      // If upstream failed and track has a valid progressive direct streamUrl, fallback
      if (!upstreamRes.ok && (!req.query.source || req.query.source==='auto') && this.isValidProgressiveUrl(track.streamUrl)) {
        logger.warn({ trackId: track.id, status: upstreamRes.status }, 'Upstream stream failed, falling back to direct streamUrl');
        res.redirect(track.streamUrl);
        return;
      }

      res.status(upstreamRes.status);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      for (const [key, val] of upstreamRes.headers.entries()) {
        const k = key.toLowerCase();
        if (['content-type', 'content-length', 'content-range'].includes(k)) {
          res.setHeader(key, val);
        }
      }

      if (!upstreamRes.body) {
        res.end();
        return;
      }

      const reader = upstreamRes.body.getReader();

      // If this is a full request (bytes=0- or no range), write to disk cache simultaneously
      const isFromStart = !req.headers.range || req.headers.range.startsWith('bytes=0-');
      if (isFromStart && upstreamRes.status === 200) {
        try {
          const tempPath = `${diskPath}.tmp`;
          writeStream = fs.createWriteStream(tempPath);
        } catch {
          writeStream = null;
        }
      }

      while (true) {
        if (req.aborted || res.destroyed) {
          cleanup();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        const canContinue = res.write(value);
        if (!canContinue) {
          await new Promise<void>((resolve) => {
            const resume = () => {
              res.off('drain', resume);
              res.off('close', resume);
              resolve();
            };
            res.once('drain', resume);
            res.once('close', resume);
          });
        }

        if (writeStream && !writeStream.destroyed) {
          writeStream.write(value);
        }
      }

      if (writeStream && !writeStream.destroyed) {
        writeStream.end(() => {
          try {
            const tempPath = `${diskPath}.tmp`;
            if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 500000) {
              fs.renameSync(tempPath, diskPath);
              logger.info({ trackId: track.id, size: fs.statSync(diskPath).size }, 'Cached audio to disk');
            }
          } catch {
            // Ignore rename errors
          }
        });
      }

      if (!res.writableEnded) {
        res.end();
      }
    } catch (err: any) {
      cleanup();
      if (err.name !== 'AbortError' && err.name !== 'ECONNRESET') {
        logger.error({ err, trackId: track.id }, 'Error streaming audio');
      }
      if (!res.headersSent) {
        if ((!req.query.source || req.query.source==='auto') && this.isValidProgressiveUrl(track.streamUrl)) {
          res.redirect(track.streamUrl);
        } else {
          res.status(502).json({ error: { code: 'STREAM_FAILED', message: 'Could not stream track' } });
        }
      }
    }
  }

  private isValidProgressiveUrl(url?: string): url is string {
    if (!url || typeof url !== 'string') return false;
    return (
      url.startsWith('http') &&
      !url.includes('preview') &&
      !url.includes('cdns-preview') &&
      !url.includes('cdnt-preview') &&
      !url.includes('dzcdn.net') &&
      !url.includes('.m3u8')
    );
  }

  private streamLocalFile(filePath: string, totalSize: number, req: Request, res: Response): void {
    const range = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    // The cache key is historically named .m4a even when an upstream source
    // supplied MP3. Safari needs the actual MIME type to decode cached tracks.
    const signature = Buffer.alloc(4);
    const file = fs.openSync(filePath, 'r');
    try { fs.readSync(file, signature, 0, signature.length, 0); }
    finally { fs.closeSync(file); }
    const mp3 = signature.toString('ascii', 0, 3) === 'ID3'
      || (signature[0] === 0xff && (signature[1] & 0xe0) === 0xe0);
    res.setHeader('Content-Type', mp3 ? 'audio/mpeg' : 'audio/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!range) {
      res.setHeader('Content-Length', totalSize);
      res.status(200);
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

    if (start >= totalSize || end >= totalSize) {
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      res.status(416).end();
      return;
    }

    const chunkSize = end - start + 1;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Content-Length', chunkSize);
    res.status(206);

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  }

  /**
   * Searches for tracks (including anime openings, J-Pop, OSTs and official releases)
   * via the warm Python worker with flat extraction (~1s latency).
   */
  public async searchTracks(query: string, limit = 10): Promise<Track[]> {
    if (!query || !query.trim()) return [];
    try {
      const cleanQ = query.replace(/https?:\/\/[^\s]+/gi, '').trim();
      if (!cleanQ) return [];

      const res = await this.sendWorkerRequest(
        {
          action: 'search',
          query: cleanQ,
          limit,
        },
        8000
      );

      if (!res.success || !res.items || !Array.isArray(res.items)) {
        return [];
      }

      return res.items
        .filter((item: any) => {
          const t = (item.title || '').toLowerCase();
          return !['trailer', 'teaser', 'трейлер', 'тизер', 'реклама', 'cm', 'pv', 'promo', 'промо', 'commercial', 'announcement', '予告'].some((kw) => t.includes(kw));
        })
        .map((item: any) => {
          const parsed = this.parseAnimeTrack(item.title, item.uploader);
          let title = parsed.title;
          let artistName = parsed.artist || item.uploader || 'YouTube';

          if (!parsed.isAnimeCut) {
            const sepMatch = title.match(/^(.*?)\s+[-—–|]\s+(.*)$/);
            if (sepMatch && sepMatch[1].length > 1 && sepMatch[2].length > 0) {
              artistName = sepMatch[1].trim();
              title = sepMatch[2].trim();
            }

            title = title
              .replace(/\s*[\(\[][^\)\]]*(?:official|audio|video|lyrics|full|creditless|hd|4k|mv|ost)[\)\]]/gi, '')
              .replace(/\s{2,}/g, ' ')
              .trim();
          }

          const track: Track = {
            id: `youtube:${item.id}`,
            source: 'licensed',
            sourceId: item.id,
            title: title || item.title,
            artist: {
              id: `youtube:channel:${encodeURIComponent(artistName)}`,
              source: 'licensed',
              sourceId: artistName,
              name: artistName,
              avatarUrl: item.thumbnail,
            },
            artworkUrl: item.thumbnail,
            duration: item.duration || 180,
            trackUrl: `https://www.youtube.com/watch?v=${item.id}`,
            access: 'playable',
          };

          trackCacheRepository.setCachedTrack(track).catch(() => {});
          return track;
        });
    } catch (err) {
      logger.debug({ err, query }, 'Error searching tracks via YouTube worker');
      return [];
    }
  }
}

export const studioMasterService = new StudioMasterService();
