import { hasVersion } from '../utils/versionMatch.js';
import { exec, spawn, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
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

const execAsync = promisify(exec);
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
  };
  items?: any[];
  error?: string;
}

export class StudioMasterService {
  private cacheDir: string;
  private urlCache = new Map<string, ResolvedMaster>();
  private inFlightResolutions = new Map<string, Promise<ResolvedMaster | null>>();
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
    this.cacheDir = path.resolve(process.cwd(), 'server', 'data', 'audio_cache_originals_v6');
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

  private getFfmpegArg(): string {
    if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
      return `--ffmpeg-location "${process.env.FFMPEG_PATH}"`;
    }
    const wingetCandidate = path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft',
      'WinGet',
      'Links'
    );
    if (wingetCandidate && fs.existsSync(wingetCandidate)) {
      return `--ffmpeg-location "${wingetCandidate}"`;
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

  private getDiskCachePath(trackId: string): string {
    return path.join(this.cacheDir, `${this.sanitizeFilename(trackId)}.m4a`);
  }

  /** Completed cached audio only; never expose temporary files or arbitrary paths. */
  public getExportAudio(trackId: string): { path: string; size: number; extension: string; mime: string } | null {
    if (!/^(soundcloud|spotify|deezer|youtube|licensed):[a-zA-Z0-9:_-]{1,180}$/.test(trackId)) return null;
    const file = this.getDiskCachePath(trackId);
    if (!fs.existsSync(file)) return null;
    const size = fs.statSync(file).size;
    if (size < 500000 || size > 49 * 1024 * 1024) return null;
    const fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(16);
    try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
    if (header.toString('ascii', 4, 8) === 'ftyp') return { path: file, size, extension: 'm4a', mime: 'audio/mp4' };
    if (header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 255 && (header[1] & 224) === 224 && (header[1] & 6) !== 0)) return { path: file, size, extension: 'mp3', mime: 'audio/mpeg' };
    return null;
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
    const master=await this.resolveStudioStream(track);
    if(!master||master.audioSource==='deezer')throw new Error('Полный аудиофайл недоступен.');
    if(master.streamUrl.startsWith('https://'))this.cacheStreamToDisk(track.id,master.streamUrl);
    const deadline=Date.now()+60000;
    while(Date.now()<deadline){const file=this.getExportAudio(track.id);if(file)return file;await new Promise(resolve=>setTimeout(resolve,500));}
    throw new Error('Загрузка аудио не завершилась. Повторите попытку позже.');
  }

  /**
   * Resolves the authentic studio master stream URL for a given official track.
   * Uses in-flight promise de-duplication to prevent race conditions and queue congestion.
   */
  public async resolveStudioStream(track: Track, preferredSource?: string): Promise<ResolvedMaster | null> {
    // 1. In-memory cache check
    const cached = this.urlCache.get(track.id);
    if (cached && Date.now() < cached.expiresAt && (!preferredSource || cached.audioSource === preferredSource)) {
      return cached;
    }

    // 2. Disk cache check
    const diskPath = this.getDiskCachePath(track.id);
    if (!preferredSource && fs.existsSync(diskPath)) {
      const stats = fs.statSync(diskPath);
      if (stats.size > 500000) { // Valid audio file (> 500 KB)
        const resolved: ResolvedMaster = {
          streamUrl: `file://${diskPath}`,
          audioSource: 'cache',
          duration: track.duration,
          title: track.title,
          channel: track.artist.name,
          mimeType: 'audio/mp4',
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

    const promise = this.performResolve(track, preferredSource).then((resolved) => {
      // Keep an explicitly selected source warm for the range request that
      // follows the probe. A source mismatch is never reused for another
      // explicit choice.
      if (resolved) this.urlCache.set(track.id, resolved);
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

  private async performResolve(track: Track, preferredSource?: string): Promise<ResolvedMaster | null> {
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
    if (preferredSource !== 'soundcloud' && track.id.startsWith('youtube:') && !animeCheck.isAnimeCut) {
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
        const isPreview = pb?.url?.includes('/preview/') || pb?.url?.includes('preview') || pb?.url?.includes('snip');
        if (pb && pb.available && pb.url && pb.url.startsWith('http') && !isM3U8 && !isPreview) {
          const resolved: ResolvedMaster = {
            streamUrl: pb.url,
            audioSource: 'soundcloud',
            duration: track.duration,
            title: track.title,
            channel: track.artist.name,
            mimeType: pb.mimeType || 'audio/mpeg',
            expiresAt: pb.expiresAt || (Date.now() + 1000 * 60 * 60 * 3),
          };
          this.urlCache.set(track.id, resolved);
          this.cacheStreamToDisk(track.id, pb.url);
          return resolved;
        }
      } catch (scErr) {
        logger.debug({ scErr, trackId: track.id }, 'SoundCloud direct stream failed, proceeding to studio master resolver');
      }
    }

    let cleanTitle = animeCheck.isAnimeCut ? animeCheck.title : track.title;
    let cleanArtist = animeCheck.isAnimeCut && animeCheck.artist ? animeCheck.artist : track.artist.name.split(',')[0].trim();

    if (!animeCheck.isAnimeCut) {
      cleanTitle = cleanTitle
        .replace(/\s*[\(\[][^\)\]]*(?:official|audio|video|remastered|bonus|version|deluxe|edit|prod|feat|ft)[\)\]]/gi, '')
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

    const targetDuration = animeCheck.isAnimeCut ? 0 : (track.duration || 0);
    const queries = [
      `${cleanArtist} - ${cleanTitle}`,
      `${cleanArtist} ${cleanTitle} audio`,
    ];

    // Prefer a full, artist-owned SoundCloud upload before asking YouTube.
    // This is the common case for independent releases and avoids needless
    // cross-platform substitution.
    if (preferredSource === 'soundcloud' || (!preferredSource && track.source !== 'youtube' && track.source !== 'licensed')) {
      try {
        const clientId = await streamResolverService.getFreshClientId();
        const sc = await streamResolverService.searchAndResolve(`${cleanArtist} ${cleanTitle}`, cleanTitle, cleanArtist, targetDuration, clientId);
        if (sc.available && sc.url && !sc.url.includes('.m3u8')) {
          return { streamUrl: sc.url, audioSource: 'soundcloud', duration: track.duration, title: track.title, channel: track.artist.name, mimeType: sc.mimeType || 'audio/mpeg', expiresAt: sc.expiresAt || Date.now() + 3 * 60 * 60 * 1000 };
        }
      } catch (err) { logger.debug({ err, trackId: track.id }, 'Preferred SoundCloud source unavailable'); }
      if (preferredSource === 'soundcloud') return null;
    }

    if (preferredSource && preferredSource !== 'youtube') return null;

    // 1. High-speed two-phase resolution via persistent warm worker (~3s latency)
    for (const query of queries) {
      try {
        logger.info({ trackId: track.id, query }, 'Resolving studio master via warm Python worker');
        const res = await this.sendWorkerRequest(
          {
            action: 'resolve',
            query,
            cleanTitle,
            cleanArtist,
            targetDuration,
          },
          25000
        );

        if (res.success && res.candidate?.streamUrl) {
          const best = res.candidate;
          logger.info(
            {
              trackId: track.id,
              matchedTitle: best.title,
              channel: best.channel,
              duration: best.duration,
              score: best.score,
            },
            'Successfully resolved studio master stream via warm worker'
          );

          const resolved: ResolvedMaster = {
            streamUrl: best.streamUrl,
            audioSource: 'youtube',
            duration: best.duration || targetDuration,
            title: best.title || track.title,
            channel: best.channel || track.artist.name,
            mimeType: 'audio/mp4',
            expiresAt: Date.now() + 1000 * 60 * 60 * 5, // 5 hours
          };

          this.urlCache.set(track.id, resolved);
          this.cacheStreamToDisk(track.id, best.streamUrl);
          return resolved;
        }
      } catch (workerErr) {
        logger.warn({ err: workerErr, trackId: track.id, query }, 'Worker resolution query failed or timed out');
      }
    }

    // 2. Fallback: direct exec if worker candidate was not found
    const primaryQuery = queries[0];
    const pyBin = this.pythonPath;
    const ffmpegArg = this.getFfmpegArg();
    const cmd = `"${pyBin}" -m yt_dlp ${ffmpegArg} --no-check-certificates --js-runtimes node:node -f "ba[ext=m4a]/bestaudio/best" --playlist-end 4 --print "%(duration)s|%(title)s|%(channel)s|%(url)s" "ytsearch4:${primaryQuery.replace(/"/g, '')}"`;

    try {
      logger.info({ trackId: track.id, query: primaryQuery }, 'Resolving studio master via direct exec fallback');
      const { stdout } = await execAsync(cmd, {
        timeout: 18000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      const lines = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);

      const cleanTargetTitle = this.normalize(cleanTitle);
      const targetTokens = cleanTargetTitle.split(' ').filter((t) => t.length >= 2);
      const normTargetArtist = this.normalize(cleanArtist);
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

      const validCandidates: Array<{
        streamUrl: string;
        durSec: number;
        candTitle: string;
        channel: string;
        durDiff: number;
        score: number;
      }> = [];

      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length < 4) continue;

        const durSec = parseInt(parts[0], 10) || 0;
        const candTitle = parts[1];
        const channel = parts[2];
        const streamUrl = parts.slice(3).join('|');

        if (!streamUrl.startsWith('http')) continue;

        const titleLower = candTitle.toLowerCase();
        const normCandTitle = this.normalize(candTitle);

        const artistCompact = normTargetArtist.replace(/\s+/g, '');
        const channelNormalized = this.normalize(channel);
        const officialChannel = channel.toLowerCase().endsWith('- topic') || (artistCompact && channelNormalized.replace(/\s+/g, '').includes(artistCompact));
        if (artistCompact && !officialChannel) continue;

        // 1. Resilient title match
        const matchesCount = targetTokens.filter((token) => normCandTitle.includes(token)).length;
        const matchRatio = targetTokens.length > 0 ? matchesCount / targetTokens.length : 1;
        const hasTitle =
          normCandTitle.includes(cleanTargetTitle) ||
          matchRatio >= 0.4 ||
          (targetTokens.length <= 2 && matchesCount >= 1);

        let score = 200;
        if (hasTitle) {
          score += Math.round(matchRatio * 150);
        } else {
          continue;
        }

        // 2. Penalize unwanted modifiers if not explicitly requested
        const unwantedMods = modifierKeywords.filter((kw) => hasVersion(titleLower, kw) && !allowedKeywords.includes(kw));
        if (unwantedMods.length > 0) {
          continue;
        }

        // 2.1 Heavily penalize anime commercials, trailers, CM and promo clips (which contain speech and ads)
        for (const pkw of promoKeywords) {
          if (hasVersion(titleLower, pkw) && !hasVersion(targetCombined, pkw)) {
            score -= 1500;
            break;
          }
        }

        // 3. Duration check
        const durDiff = Math.abs(durSec - targetDuration);
        if (targetDuration > 30 && durSec > 0 && durDiff > 8) continue;

        if (durDiff <= 2) score += 350;
        else if (durDiff <= 5) score += 200;
        else if (durDiff <= 12) score += 100;
        else score -= durDiff * 5;

        if (channel.endsWith('- Topic')) score += 350;
        if (titleLower.includes('(audio)') || titleLower.includes('[audio]')) score += 250;
        else if (titleLower.includes('official audio')) score += 280;

        if (titleLower.includes('official video') || titleLower.includes('official music video') || titleLower.includes('клип')) {
          score += 100;
        }

        if (normCandTitle.includes(normTargetArtist) || this.normalize(channel).includes(normTargetArtist)) {
          score += 120;
        }

        validCandidates.push({ streamUrl, durSec, candTitle, channel, durDiff, score });
      }

      if (validCandidates.length > 0) {
        validCandidates.sort((a, b) => b.score - a.score);
        const best = validCandidates[0];

        const resolved: ResolvedMaster = {
          streamUrl: best.streamUrl,
            audioSource: 'youtube',
          duration: best.durSec,
          title: best.candTitle,
          channel: best.channel,
          mimeType: 'audio/mp4',
          expiresAt: Date.now() + 1000 * 60 * 60 * 5,
        };

        this.urlCache.set(track.id, resolved);
        this.cacheStreamToDisk(track.id, best.streamUrl);
        return resolved;
      }
    } catch (err) {
      logger.error({ err, trackId: track.id }, 'Error during yt-dlp direct exec fallback');
    }

    if(preferredSource==='youtube')return null;
    // 3. Fallback: Secondary resolution via SoundCloud stream resolver
    try {
      logger.info({ trackId: track.id }, 'Attempting secondary SoundCloud fallback via streamResolverService');
      const clientId = await streamResolverService.getFreshClientId();
      const scFallback = await streamResolverService.searchAndResolve(
        `${cleanArtist} ${cleanTitle}`,
        cleanTitle,
        cleanArtist,
        targetDuration,
        clientId
      );

      if (scFallback.available && scFallback.url && !scFallback.url.includes('.m3u8')) {
        const resolved: ResolvedMaster = {
          streamUrl: scFallback.url,
            audioSource: 'soundcloud',
          duration: track.duration,
          title: track.title,
          channel: track.artist.name,
          mimeType: scFallback.mimeType || 'audio/mpeg',
          expiresAt: scFallback.expiresAt || Date.now() + 1000 * 60 * 60 * 3,
        };

        this.urlCache.set(track.id, resolved);
        this.cacheStreamToDisk(track.id, scFallback.url);
        return resolved;
      }
    } catch (scErr) {
      logger.debug({ scErr, trackId: track.id }, 'Secondary SoundCloud fallback failed');
    }

    return null;
  }

  /**
   * Automatically downloads resolved audio stream to local disk cache in background
   * so all subsequent plays start with 0ms local latency.
   */
  private cacheStreamToDisk(trackId: string, url: string): void {
    const diskPath = this.getDiskCachePath(trackId);
    if (fs.existsSync(diskPath) || url.startsWith('file://')) {
      return;
    }

    const tempPath = `${diskPath}.pre.tmp`;
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    fetch(url, { headers })
      .then((res) => {
        if (!res.ok || !res.body) return;
        const fileStream = fs.createWriteStream(tempPath);
        const reader = res.body.getReader();

        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fileStream.write(value);
          }
          fileStream.end(() => {
            try {
              if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 500000) {
                fs.renameSync(tempPath, diskPath);
                logger.info({ trackId }, 'Pre-cached audio stream directly to disk');
              } else if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
              }
            } catch {}
          });
        };

        pump().catch(() => {
          try {
            fileStream.destroy();
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          } catch {}
        });
      })
      .catch(() => {});
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
    this.resolveStudioStream(track).catch((err) => {
      logger.debug({ err, trackId: track.id }, 'Background prefetch error');
    });
  }

  /**
   * Proxies audio stream with full HTTP 206 Partial Content (Range requests) support.
   */
  public async handleAudioStream(track: Track, req: Request, res: Response, preferredSource?: string): Promise<void> {
    if(preferredSource==='auto')preferredSource=undefined;
    if(preferredSource&&!['youtube','soundcloud','deezer'].includes(preferredSource)){res.status(400).json({error:{message:'Этот источник воспроизведения не подключён.'}});return;}
    if(preferredSource)track={...track,id:`${track.id}:playback:${preferredSource}`};
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
      // Proxy from URL (fall through to proxy logic below)
      return this.proxyStream(master.streamUrl, track, diskPath, req, res);
    }

    // Keep the first media request alive while resolving. An immediate 503 made
    // HTMLAudio fail and added the client's retry delay even for fast resolutions.
    const master = await this.resolveStudioStream(track, preferredSource);
    if (res.destroyed || req.aborted) return;
    if (master) {
      res.setHeader('X-Audio-Source', master.audioSource || 'unknown');
      if (master.streamUrl.startsWith('file://')) {
        const filePath = master.streamUrl.slice(7);
        if (fs.existsSync(filePath)) { this.streamLocalFile(filePath, fs.statSync(filePath).size, req, res); return; }
      } else { await this.proxyStream(master.streamUrl, track, diskPath, req, res); return; }
    }
    res.setHeader('Retry-After', '3');
    res.status(503).json({ error: { code: 'AUDIO_RESOLVING', message: 'Audio stream is being resolved, please retry' } });
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
