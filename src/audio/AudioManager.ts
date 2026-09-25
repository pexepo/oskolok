import { Track, PlaybackInfo, RepeatMode } from '../types/index.js';
import { queueManager } from './QueueManager.js';
import { apiClient } from '../api/apiClient.js';
import {spotifyPlayback} from './SpotifyPlayback.js';

export type AudioErrorType =
  | 'NETWORK'
  | 'SOURCE_UNAVAILABLE'
  | 'ACCESS_DENIED'
  | 'PLAYBACK_BLOCKED'
  | 'AUTOPLAY_BLOCKED'
  | 'UNKNOWN';

export interface AudioStateListener {
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onSeek?: (currentTime: number, duration: number) => void;
  onStateChange?: (isPlaying: boolean, isBuffering: boolean) => void;
  onTrackChange?: (track: Track | null) => void;
  onError?: (errorType: AudioErrorType, message: string) => void;
}

export class AudioManager {
  private static instance: AudioManager;
  private audio: HTMLAudioElement;
  private currentTrack: Track | null = null;
  private currentPlaybackInfo: PlaybackInfo | null = null;
  private playSessionId = 0;
  private userWantsPlayback = false;
  private isStopping = false;
  private recoveryAttempts = 0;
  private maxRecoveryAttempts = 1;
  private isBuffering = false;
  private isMuted = false;
  private volume = 0.8;
  private listeners: Set<AudioStateListener> = new Set();
  private historyLoggedForCurrent = false;
  private timeUpdateTicker: ReturnType<typeof setInterval> | null = null;
  private preferredSources = new Map<string, string>();

  private constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';
    this.audio.volume = this.volume;

    this.attachAudioListeners();
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  public subscribe(listener: AudioStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private startTimeUpdateTicker(): void {
    if (this.timeUpdateTicker) return;
    this.timeUpdateTicker = setInterval(() => {
      if (this.userWantsPlayback && !this.audio.paused) {
        const cur = this.audio.currentTime;
        const dur = this.audio.duration || 0;
        this.notifyTimeUpdate(cur, dur);
      }
    }, 100);
  }

  private stopTimeUpdateTicker(): void {
    if (this.timeUpdateTicker) {
      clearInterval(this.timeUpdateTicker);
      this.timeUpdateTicker = null;
    }
  }

  private stopAudioPipeline(): void {
    this.stopTimeUpdateTicker();
    this.isStopping = true;
    try {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    } catch {
      // Ignore errors when resetting media element
    }
    this.isStopping = false;
    this.isBuffering = false;
  }

  public async playTrack(track: Track, preferredSource?: string): Promise<void> {
    spotifyPlayback.activateFromGesture();
    const priorSource=this.preferredSources.get(track.id);
    if(preferredSource==='auto')this.preferredSources.delete(track.id);
    else if(preferredSource)this.preferredSources.set(track.id,preferredSource);
    if (this.currentTrack?.id === track.id && (this.audio.src||spotifyPlayback.active) && (preferredSource===undefined||priorSource===this.preferredSources.get(track.id))) {
      this.resume();
      return;
    }

    // Increment session ID to immediately invalidate all past callbacks/promises
    const sessionId = ++this.playSessionId;
    this.userWantsPlayback = true;
    this.currentTrack = track;
    this.historyLoggedForCurrent = false;
    this.recoveryAttempts = 0;

    // Immediately stop and teardown any previous audio stream so it stops playing instantly
    this.stopAudioPipeline();
    if(spotifyPlayback.active){void spotifyPlayback.pause().catch(()=>{});spotifyPlayback.stop();}

    // Update UI immediately
    this.notifyTrackChange(track);
    this.setBuffering(true);

    const selectedSource = this.preferredSources.get(track.id);
    const mobileBrowser = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent)
      || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

    // On phones, start the media element during the user's tap. Waiting for a
    // Spotify lookup and a Range probe can consume WebKit's playback gesture.
    // Explicit Spotify selection still uses the chosen Spotify device.
    if (mobileBrowser && selectedSource !== 'spotify') {
      const localStreamUrl = apiClient.getStreamUrl(track.id, selectedSource);
      this.audio.src = localStreamUrl;
      const immediatePlayback = this.audio.play();
      try {
        await immediatePlayback;
        if (sessionId !== this.playSessionId || !this.userWantsPlayback) return;
        this.setupMediaSession(track);
        this.setBuffering(false);
        this.notifyStateChange(true, false);
        void fetch(localStreamUrl, { headers: { Range: 'bytes=0-1' }, signal: AbortSignal.timeout(12000) })
          .then(async response => {
            const source = response.headers.get('X-Audio-Source');
            await response.body?.cancel();
            if (source && sessionId === this.playSessionId) {
              this.currentTrack = { ...track, audioSource: source };
              this.notifyTrackChange(this.currentTrack);
            }
          }).catch(() => {});
        return;
      } catch (error) {
        if (sessionId !== this.playSessionId) return;
        if ((error as Error)?.name === 'AbortError') return;
        if ((error as Error)?.name === 'NotAllowedError') {
          this.setBuffering(false);
          this.notifyStateChange(false, false);
          this.notifyError('AUTOPLAY_BLOCKED', 'Нажмите «Воспроизвести» для запуска');
          return;
        }
        this.stopAudioPipeline();
        this.setBuffering(true);
      }
    }

    // Automatic Spotify Connect may choose a different device on a phone.
    // Keep automatic mobile playback local; explicit Spotify still uses it.
    if (!mobileBrowser || selectedSource === 'spotify') {
      try{
        const external=await spotifyPlayback.play(track,selectedSource,(playing,time,duration)=>{
        if(this.currentTrack?.id!==track.id||!spotifyPlayback.active)return;
        this.notifyTimeUpdate(time,duration);this.notifyStateChange(playing&&this.userWantsPlayback,false);
        },()=>{if(sessionId===this.playSessionId)void this.next();});
        if(sessionId!==this.playSessionId){if(external){void spotifyPlayback.pause().catch(()=>{});spotifyPlayback.stop();}return;}
        if(external){this.currentTrack={...track,audioSource:'spotify',playbackDevice:external.deviceName};this.notifyTrackChange(this.currentTrack);this.setupMediaSession(track);this.setBuffering(false);this.notifyStateChange(true,false);return;}
      }catch(error){
        if(selectedSource==='spotify'){this.setBuffering(false);this.notifyStateChange(false,false);this.notifyError('SOURCE_UNAVAILABLE',(error as Error).message);return;}
      }
    }

    const streamUrl = apiClient.getStreamUrl(track.id, selectedSource);
    this.currentPlaybackInfo = {
      available: true,
      type: 'progressive',
      url: streamUrl,
      expiresAt: Date.now() + 86400000,
      mimeType: 'audio/mp4',
    };

    // Pre-warm the next track in the queue in background
    this.prefetchNextTrack();

    // Poll the stream endpoint — server may be resolving YouTube URL (takes up to 25s cold)
    // We check HTTP status first before assigning src to avoid triggering audio error events
    const maxPolls = 6;
    const pollDelays = [0, 3000, 5000, 6000, 6000, 5000]; // total ~25s

    for (let attempt = 0; attempt < maxPolls; attempt++) {
      if (sessionId !== this.playSessionId || !this.userWantsPlayback) {
        return;
      }

      if (pollDelays[attempt] > 0) {
        await new Promise((r) => setTimeout(r, pollDelays[attempt]));
        if (sessionId !== this.playSessionId || !this.userWantsPlayback) {
          return;
        }
      }

      let probeStatus = 200;
      try {
        // Probe the endpoint with a quick fetch — abort body immediately after getting status
        const ac = new AbortController();
        const probe = await fetch(`${streamUrl}${attempt > 0 ? `${streamUrl.includes('?')?'&':'?'}r=${attempt}` : ''}`, {
          method: 'GET',
          headers: { Range: 'bytes=0-1' },
          signal: ac.signal,
        });
        probeStatus = probe.status;
        const audioSource = probe.headers.get('X-Audio-Source');
        if (audioSource && sessionId === this.playSessionId) {
          this.currentTrack = { ...track, audioSource };
          this.notifyTrackChange(this.currentTrack);
        }
        // Immediately abort body — we only needed the status code
        ac.abort();
      } catch (fetchErr: any) {
        if (fetchErr.name === 'AbortError') {
          // Our own abort after getting status — continue normally
        } else if (fetchErr.name === 'TimeoutError') {
          continue; // Timeout — retry
        } else {
          // Network error — fall through to direct src assignment
          break;
        }
      }

      if (probeStatus === 503 || probeStatus === 202) {
        // Still resolving — continue polling
        continue;
      }

      if (probeStatus === 200 || probeStatus === 206 || (probeStatus >= 200 && probeStatus < 400)) {
        // Stream is ready — assign to audio element and play
        if (sessionId !== this.playSessionId || !this.userWantsPlayback) {
          return;
        }

        this.audio.src = streamUrl;
        this.setupMediaSession(track);

        try {
          await this.audio.play();
          if (sessionId !== this.playSessionId || !this.userWantsPlayback) {
            return;
          }
          this.setBuffering(false);
          this.notifyStateChange(true, false);
          return;
        } catch (playErr: any) {
          if (playErr.name === 'AbortError') return;
          if (playErr.name === 'NotAllowedError') {
            this.notifyError('AUTOPLAY_BLOCKED', 'Нажмите «Воспроизвести» для запуска');
            return;
          }
          // play() failed (e.g. format issue) — try next attempt
          if (attempt < maxPolls - 1) continue;
        }
      }

      // Non-retriable HTTP error (404, 5xx that's not 503)
      if (probeStatus === 404 || (probeStatus >= 500 && probeStatus !== 503)) {
        break;
      }
    }

    // All retries exhausted — try direct src assignment as last resort
    if (sessionId === this.playSessionId && this.userWantsPlayback) {
      try {
        this.audio.src = streamUrl;
        this.setupMediaSession(track);
        await this.audio.play();
        if (sessionId === this.playSessionId && this.userWantsPlayback) {
          this.setBuffering(false);
          this.notifyStateChange(true, false);
          return;
        }
      } catch (lastErr: any) {
        if (lastErr.name === 'AbortError') return;
        if (lastErr.name === 'NotAllowedError') {
          this.notifyError('AUTOPLAY_BLOCKED', 'Нажмите «Воспроизвести» для запуска');
          return;
        }
      }
    }

    if (sessionId !== this.playSessionId) return;

    this.stopAudioPipeline();
    this.notifyStateChange(false, false);

    const hasNext = queueManager.peekNextTrack() !== null || this.onNeedMoreTracksHandler !== null;
    if (hasNext && this.userWantsPlayback) {
      this.notifyError('SOURCE_UNAVAILABLE', 'Трек недоступен. Переход к следующему...');
      setTimeout(() => {
        if (sessionId === this.playSessionId && this.userWantsPlayback) {
          this.next();
        }
      }, 1200);
    } else {
      this.notifyError('SOURCE_UNAVAILABLE', 'Не удалось загрузить аудиодорожку');
    }
  }

  public prefetchNextTrack(): void {
    try {
      const nextTrack = queueManager.peekNextTrack();
      if (nextTrack && nextTrack.id) {
        apiClient.prefetchTrack(nextTrack.id).catch(() => {});
      }
    } catch {
      // Non-blocking prefetch
    }
  }

  public async playCollection(tracks: Track[], startIndex: number = 0, preferredSource?: string): Promise<void> {
    if (tracks.length === 0) return;
    if (preferredSource) tracks.forEach((track,index) => { if(index!==startIndex) preferredSource==='auto'?this.preferredSources.delete(track.id):this.preferredSources.set(track.id, preferredSource); });
    queueManager.setQueue(tracks, startIndex);
    const targetTrack = queueManager.getCurrentTrack();
    if (targetTrack) {
      await this.playTrack(targetTrack, preferredSource);
      this.prefetchNextTrack();
    }
  }

  public async playNow(track: Track): Promise<void> {
    queueManager.playNow(track);
    await this.playTrack(track);
    this.prefetchNextTrack();
  }

  public playNextTrackInQueue(track: Track): void {
    queueManager.playNext(track);
    this.prefetchNextTrack();
  }

  public addToQueue(track: Track): void {
    queueManager.addToQueue(track);
    this.prefetchNextTrack();
  }

  public pause(): void {
    this.stopTimeUpdateTicker();
    this.userWantsPlayback = false;
    this.playSessionId++;
    try {
      this.audio.pause();
    } catch {}
    if(spotifyPlayback.active)void spotifyPlayback.pause().catch(()=>{});
    this.notifyStateChange(false, false);
  }

  public resume(): void {
    if (!this.currentTrack) return;
    this.userWantsPlayback = true;
    const sessionId = ++this.playSessionId;

    if(spotifyPlayback.active){spotifyPlayback.activateFromGesture();void spotifyPlayback.resume().then(()=>{if(sessionId===this.playSessionId)this.notifyStateChange(true,false);}).catch(e=>this.notifyError('SOURCE_UNAVAILABLE',(e as Error).message));return;}

    if (!this.audio.src) {
      this.playTrack(this.currentTrack);
      return;
    }

    this.audio
      .play()
      .then(() => {
        if (sessionId === this.playSessionId && this.userWantsPlayback) {
          this.notifyStateChange(true, false);
        } else {
          try {
            this.audio.pause();
          } catch {}
        }
      })
      .catch((err) => {
        if (sessionId !== this.playSessionId) return;
        if (err.name === 'NotAllowedError') {
          this.notifyError('AUTOPLAY_BLOCKED', 'Нажмите «Воспроизвести» для запуска');
        } else if (err.name !== 'AbortError') {
          this.handlePlaybackError(err);
        }
      });
  }

  public togglePlay(): void {
    if(spotifyPlayback.active){if(this.userWantsPlayback)this.pause();else this.resume();return;}
    if (this.audio.paused || !this.userWantsPlayback) {
      this.resume();
    } else {
      this.pause();
    }
  }

  private onNeedMoreTracksHandler: (() => Promise<void | boolean>) | null = null;

  public setOnNeedMoreTracks(handler: (() => Promise<void | boolean>) | null): void {
    this.onNeedMoreTracksHandler = handler;
  }

  public async next(): Promise<void> {
    if (this.onNeedMoreTracksHandler && queueManager.peekNextTrack() === null) {
      try {
        await this.onNeedMoreTracksHandler();
      } catch {}
    }
    const { track, shouldLoopCurrent } = queueManager.getNextTrack();
    if (shouldLoopCurrent && this.currentTrack) {
      this.seek(0);
      this.resume();
      return;
    }
    if (track) {
      await this.playTrack(track);
    } else {
      this.pause();
      this.seek(0);
    }
  }

  public async previous(): Promise<void> {
    const { track, seekToZero } = queueManager.getPreviousTrack(this.audio.currentTime);
    if (seekToZero) {
      this.seek(0);
      return;
    }
    if (track) {
      await this.playTrack(track);
    }
  }

  public seek(seconds: number): void {
    if(spotifyPlayback.active){void spotifyPlayback.seek(seconds).catch(()=>{});this.notifyTimeUpdate(seconds,this.currentTrack?.duration||0);return;}
    if (this.audio.duration && !isNaN(this.audio.duration)) {
      const targetTime = Math.max(0, Math.min(seconds, this.audio.duration));
      this.audio.currentTime = targetTime;
      this.notifyTimeUpdate(targetTime, this.audio.duration);
      this.listeners.forEach((listener) => listener.onSeek?.(targetTime, this.audio.duration));
    }
  }

  public setVolume(val: number): void {
    const bounded = Math.max(0, Math.min(1, val));
    this.volume = bounded;
    this.audio.volume = this.isMuted ? 0 : bounded;
    if(spotifyPlayback.active)void spotifyPlayback.volume(this.isMuted?0:bounded).catch(()=>{});
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    this.audio.volume = this.isMuted ? 0 : this.volume;
    if(spotifyPlayback.active)void spotifyPlayback.volume(this.isMuted?0:this.volume).catch(()=>{});
    return this.isMuted;
  }

  public toggleShuffle(): boolean {
    return queueManager.toggleShuffle();
  }

  public setRepeatMode(mode: RepeatMode): void {
    queueManager.setRepeatMode(mode);
  }

  public getCurrentTime(): number {
    return spotifyPlayback.active ? spotifyPlayback.getCurrentTime() : this.audio.currentTime || 0;
  }

  public getDuration(): number {
    return spotifyPlayback.active ? this.currentTrack?.duration || 0 : this.audio.duration || 0;
  }

  public getIsPlaying(): boolean {
    return spotifyPlayback.active ? spotifyPlayback.isPlaying && this.userWantsPlayback : !this.audio.paused && this.userWantsPlayback;
  }

  public getCurrentTrack(): Track | null {
    return this.currentTrack;
  }

  private attachAudioListeners(): void {
    this.audio.addEventListener('timeupdate', () => {
      if (!this.userWantsPlayback) return;
      const cur = this.audio.currentTime;
      const dur = this.audio.duration || 0;
      this.notifyTimeUpdate(cur, dur);

      // Check playback history threshold rule: >= 30 seconds or >= 50% duration
      if (!this.historyLoggedForCurrent && this.currentTrack) {
        if (cur >= 30 || (dur > 0 && cur >= dur * 0.5)) {
          this.historyLoggedForCurrent = true;
          apiClient.addHistory(this.currentTrack).catch(() => {});
        }
      }
    });

    this.audio.addEventListener('play', () => {
      this.startTimeUpdateTicker();
    });

    this.audio.addEventListener('pause', () => {
      this.stopTimeUpdateTicker();
    });

    this.audio.addEventListener('ended', async () => {
      this.stopTimeUpdateTicker();
      this.notifyStateChange(false, false);
      await this.next();
    });

    this.audio.addEventListener('waiting', () => {
      if (this.userWantsPlayback) {
        this.setBuffering(true);
      }
    });

    this.audio.addEventListener('canplay', () => {
      this.setBuffering(false);
    });

    this.audio.addEventListener('error', (e) => {
      if (this.isStopping || !this.userWantsPlayback || !this.audio.src) {
        return;
      }
      this.handlePlaybackError(e);
    });
  }

  private isValidDirectStream(url?: string): url is string {
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

  private async handlePlaybackError(_err?: any): Promise<void> {
    if (!this.currentTrack || this.isStopping || !this.userWantsPlayback) return;

    const currentSession = this.playSessionId;

    if (this.recoveryAttempts < this.maxRecoveryAttempts) {
      this.recoveryAttempts++;
      try {
        if (
          this.isValidDirectStream(this.currentTrack.streamUrl) &&
          this.audio.src !== this.currentTrack.streamUrl
        ) {
          this.audio.src = this.currentTrack.streamUrl;
          if (currentSession === this.playSessionId && this.userWantsPlayback) {
            await this.audio.play();
            if (currentSession === this.playSessionId && this.userWantsPlayback) {
              this.setBuffering(false);
              this.notifyStateChange(true, false);
              return;
            }
          }
        }
      } catch {
        // Recovery failed
      }
    }

    if (currentSession === this.playSessionId) {
      this.stopAudioPipeline();
      this.notifyStateChange(false, false);

      const hasNext = queueManager.peekNextTrack() !== null || this.onNeedMoreTracksHandler !== null;
      if (hasNext && this.userWantsPlayback) {
        this.notifyError('SOURCE_UNAVAILABLE', 'Трек недоступен. Переход к следующему...');
        setTimeout(() => {
          if (currentSession === this.playSessionId && this.userWantsPlayback) {
            this.next();
          }
        }, 1200);
      } else {
        this.notifyError('SOURCE_UNAVAILABLE', 'Не удалось воспроизвести трек. Попробуйте другой.');
      }
    }
  }

  private setupMediaSession(track: Track): void {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist.name,
        album: 'Oskolok',
        artwork: track.artworkUrl ? [{ src: track.artworkUrl, sizes: '512x512', type: 'image/png' }] : [],
      });

      const actions: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
        play: () => this.resume(), pause: () => this.pause(),
        previoustrack: () => this.previous(), nexttrack: () => this.next(),
        seekto: details => { if (details.seekTime !== undefined) this.seek(details.seekTime); },
        seekbackward: details => this.seek(Math.max(0, this.audio.currentTime - (details.seekOffset || 10))),
        seekforward: details => this.seek(this.audio.currentTime + (details.seekOffset || 10)),
      };
      for (const [action, handler] of Object.entries(actions)) {
        try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler!); } catch { /* Unsupported by this WebView. */ }
      }
    }
  }

  private setBuffering(buffering: boolean): void {
    this.isBuffering = buffering;
    this.notifyStateChange(!this.audio.paused && this.userWantsPlayback, buffering);
  }

  private notifyTimeUpdate(cur: number, dur: number): void {
    if ('mediaSession' in navigator && Number.isFinite(dur) && dur > 0 && Number.isFinite(cur)) {
      try { navigator.mediaSession.setPositionState?.({ duration: dur, position: Math.min(dur, Math.max(0,cur)), playbackRate: this.audio.playbackRate }); } catch { /* Platform may not support position state. */ }
    }
    this.listeners.forEach((l) => l.onTimeUpdate?.(cur, dur));
  }

  private notifyStateChange(playing: boolean, buffering: boolean): void {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    this.listeners.forEach((l) => l.onStateChange?.(playing, buffering));
  }

  private notifyTrackChange(track: Track | null): void {
    this.listeners.forEach((l) => l.onTrackChange?.(track));
  }

  private notifyError(type: AudioErrorType, msg: string): void {
    this.listeners.forEach((l) => l.onError?.(type, msg));
  }
}

export const audioManager = AudioManager.getInstance();
