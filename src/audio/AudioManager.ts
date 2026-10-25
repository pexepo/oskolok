import {getPreferredSource,setPreferredSource,getRecording} from '../utils/playbackPreferences.js';
import {planMix,DEFAULT_MIX_SETTINGS,type MixAnalysis,type MixPlan,type MixSettings} from './mixPlanner.js';
import {buildMixChain,mixAnalysis,resetChain,runMix,type MixChain} from './mixer.js';
import { Track, PlaybackInfo, RepeatMode } from '../types/index.js';
import { queueManager } from './QueueManager.js';
import { apiClient } from '../api/apiClient.js';
import {spotifyPlayback} from './SpotifyPlayback.js';
import {EQ_FREQUENCIES,normalizeEqualizer} from './equalizer.js';
import {elementVolume,normalizationGain} from './loudness.js';
import {DEFAULT_EFFECTS,normalizeEffects,pitchRatio,reverbImpulse,type MediaEffects} from './mediaEffects.js';
import {scopedStorageKey} from '../telegram/runtime.js';
import {isDownloaded,offlineAudioUrl} from '../offline/offlineStore.js';

import { tr } from '../stores/useLanguageStore.js';
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
  /** The track played to its very end (not a skip, not a seek past the end by hand). */
  onEnded?: (track: Track | null) => void;
  /** Audio really started (first «playing» of a track), as opposed to a play request. */
  onAudioStarted?: (track: Track | null) => void;
}

/** The Android app's bridge to its system media notification (absent in browsers). */
type NativeMedia = { update(title: string, artist: string, artwork: string, playing: boolean, positionMs: number, durationMs: number): void; clear(): void };
const nativeMedia = (): NativeMedia | undefined => (window as unknown as { OskolokNative?: NativeMedia }).OskolokNative;

export class AudioManager {
  private static instance: AudioManager;
  private audio: HTMLAudioElement;
  /** The second media element (crossfade): idle, or finishing the previous track while it fades out. */
  private spare: HTMLAudioElement;
  private fading: HTMLAudioElement | null = null;
  private pendingFadeIn: { el: HTMLAudioElement; secs: number } | null = null;
  /** «ИИ-микс»: each element's effect chain, and the transition waiting for the incoming track to sound. */
  private mixChains = new Map<HTMLAudioElement, MixChain>();
  private pendingMix: { el: HTMLAudioElement; out: HTMLAudioElement; plan: MixPlan; a: MixAnalysis | null; b: MixAnalysis | null } | null = null;
  private rateRestore: ReturnType<typeof setInterval> | undefined;
  /** The transition now playing, for the player's «сводим» chip; null when none. */
  public mixNow: { preset: MixPlan['preset']; beatmatched: boolean; from?: number; to?: number } | null = null;
  private crossfadeAdvance = false;
  private elementGains = new Map<HTMLAudioElement, GainNode>();
  private volumeRamps = new Map<HTMLAudioElement, ReturnType<typeof setInterval>>();
  private currentTrack: Track | null = null;
  private currentPlaybackInfo: PlaybackInfo | null = null;
  private playSessionId = 0;
  private userWantsPlayback = false;
  private isStopping = false;
  private recoveryAttempts = 0;
  /** How the last move to another track happened (for listening statistics). */
  public lastAdvance: 'natural' | 'manual' = 'manual';
  private startedTrackId = '';
  /** When next() last ran: a track change shortly after it came from «next», not from picking another track. */
  public advanceAt = 0;
  private maxRecoveryAttempts = 2;
  private isBuffering = false;
  private isMuted = false;
  private volume = 0.6;
  private loudnessDb=-6;
  private normalizationNode:GainNode|null=null;
  private loudnessTimer:ReturnType<typeof setTimeout>|undefined;
  private loudnessAbort:AbortController|undefined;
  private positionReported={at:0,time:0,duration:0};
  public getNormalization():boolean {try{return localStorage.getItem(scopedStorageKey('volume-normalization'))!=='off';}catch{return true;}}
  public setNormalization(enabled:boolean):void {
    localStorage.setItem(scopedStorageKey('volume-normalization'),enabled?'on':'off');this.applyNormalization();
    if(enabled&&this.currentTrack)this.measureTrack(this.currentTrack,this.playSessionId);
  }
  private applyNormalization():void {
    if(this.normalizationNode&&this.equalizerContext)this.normalizationNode.gain.setTargetAtTime(normalizationGain(this.loudnessDb,this.getNormalization(),this.equalizerGains),this.equalizerContext.currentTime,.5);
  }
  private measureTrack(track:Track,session:number):void {
    clearTimeout(this.loudnessTimer);this.loudnessAbort?.abort();
    this.loudnessDb=-6;this.applyNormalization();
    if(!this.equalizerSupported()||!this.getNormalization())return;
    const controller=new AbortController();this.loudnessAbort=controller;let attempt=0;
    const check=async()=>{
      if(session!==this.playSessionId||controller.signal.aborted)return;
      try {
        const result=await apiClient.request<{status:string;gainDb:number}>(`/tracks/${encodeURIComponent(track.id)}/loudness`,{signal:controller.signal});
        if(session!==this.playSessionId||controller.signal.aborted)return;
        if(result.status==='ready'&&Number.isFinite(result.gainDb)){this.loudnessDb=result.gainDb;this.applyNormalization();return;}
      }catch{/* Measurement must never interrupt playback. */}
      if(++attempt<6&&!controller.signal.aborted)this.loudnessTimer=setTimeout(check,5000);
    };
    this.loudnessTimer=setTimeout(check,1500);
  }
  private listeners: Set<AudioStateListener> = new Set();
  private historyLoggedForCurrent = false;
  private timeUpdateTicker: ReturnType<typeof setInterval> | null = null;
  private preferredSources = new Map<string, string>();
  private nativeSent = { key: '', at: 0 };
  /** Tell the Android shell what plays; position is re-sent only on state changes or every 5 s. */
  private reportNative(force = false): void {
    const bridge = nativeMedia(); if (!bridge) return;
    const track = this.currentTrack;
    try {
      if (!track) { if (this.nativeSent.key) bridge.clear(); this.nativeSent = { key: '', at: 0 }; return; }
      const playing = this.getIsPlaying(), key = `${track.id}|${playing}|${track.artworkUrl || ''}`, now = Date.now();
      if (!force && key === this.nativeSent.key && now - this.nativeSent.at < 5000) return;
      this.nativeSent = { key, at: now };
      const artwork = track.artworkUrl ? new URL(track.artworkUrl, location.href).href : '';
      bridge.update(track.title, track.artist.name, artwork, playing, Math.round(this.getCurrentTime() * 1000), Math.round((this.getDuration() || track.duration || 0) * 1000));
    } catch { /* The page keeps playing even if the shell refuses an update. */ }
  }
  /** Внешний плеер (источник «Telegram» в Mini App): трек играет нативный плеер Telegram, здесь только очередь и UI. */
  public externalPlayback: { active(): boolean; play(track: Track): void; resume(): void; step(delta: number): void } | null = null;
  /** Показать трек, который сейчас играет внешний плеер (бот листнул очередь), без запуска локального аудио. */
  public setExternalTrack(track: Track): void { if (this.currentTrack?.id === track.id) return; this.currentTrack = track; this.notifyTrackChange(track); this.startExternalClock(0); }

  /**
   * Telegram plays the audio in its own player and never reports back. The app keeps a virtual clock
   * from the moment the track went to the chat, so the player, lyrics, karaoke and annotations keep
   * working; pause and seek here move that clock (to line the words up with what Telegram is playing).
   */
  private ext: { offset: number; startedAt: number; running: boolean; timer: ReturnType<typeof setInterval> | null; logged: boolean } = { offset: 0, startedAt: 0, running: false, timer: null, logged: false };
  private externalOn(): boolean { return !!this.externalPlayback?.active(); }
  private externalTime(): number {
    const e = this.ext, t = e.offset + (e.running ? (performance.now() - e.startedAt) / 1000 : 0);
    return Math.max(0, Math.min(this.currentTrack?.duration || Infinity, t));
  }
  private startExternalClock(from: number): void {
    const e = this.ext;
    if (e.timer) clearInterval(e.timer);
    e.offset = from; e.startedAt = performance.now(); e.running = true; if (from === 0) e.logged = false;
    e.timer = setInterval(() => {
      const t = this.externalTime(), d = this.currentTrack?.duration || 0;
      this.notifyTimeUpdate(t, d);
      if (!e.logged && this.currentTrack && (t >= 30 || (d > 0 && t >= d * 0.5))) { e.logged = true; apiClient.addHistory(this.currentTrack).catch(() => {}); }
      if (d > 0 && t >= d) { this.stopExternalClock(); this.notifyStateChange(false, false); }
    }, 250);
    this.notifyStateChange(true, false);
  }
  public stopExternalClock(): void {
    const e = this.ext;
    e.offset = this.externalTime(); e.running = false;
    if (e.timer) { clearInterval(e.timer); e.timer = null; }
  }

  private equalizerContext: AudioContext | null = null;
  private equalizerNodes: BiquadFilterNode[] = [];
  private equalizerGains = normalizeEqualizer(null);
  private analyser: AnalyserNode | null = null;
  /** Live analyser for visualisers; null while Spotify plays, before the first gesture or when the context is not running. */
  public getAnalyser(): AnalyserNode | null {
    return !spotifyPlayback.active&&this.equalizerContext?.state==="running"&&!this.audio.paused?this.analyser:null;
  }

  private eqOut: AudioNode | null = null;
  private dryNode: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private wetNode: GainNode | null = null;
  private pitchNode: AudioWorkletNode | null = null;
  private pitchLoading: Promise<void> | null = null;
  private effects: MediaEffects = (() => { try { return normalizeEffects(JSON.parse(localStorage.getItem(scopedStorageKey('media-effects')) || 'null')); } catch { return { ...DEFAULT_EFFECTS }; } })();
  public getEffects(): MediaEffects { return { ...this.effects }; }
  /** Speed works everywhere (it's the media element's own rate); pitch and reverb need the Web Audio chain. */
  public setEffects(next: Partial<MediaEffects>): void {
    this.effects = normalizeEffects({ ...this.effects, ...next });
    try { localStorage.setItem(scopedStorageKey('media-effects'), JSON.stringify(this.effects)); } catch { /* Private mode keeps it for the session. */ }
    if (this.effects.pitch !== 0 || this.effects.reverb > 0) this.ensureEqualizer();
    this.applyEffects();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('oskolok-effects'));
  }
  private applyEffects(): void {
    const e = this.effects;
    this.audio.defaultPlaybackRate = e.speed;
    this.audio.playbackRate = e.speed;
    (this.audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = e.preservePitch;
    const ctx = this.equalizerContext;
    if (!ctx || !this.effectsBus || !this.dryNode || !this.normalizationNode) return;
    const now = ctx.currentTime;
    if (e.reverb > 0 && !this.wetNode) {
      const convolver = ctx.createConvolver();
      convolver.buffer = reverbImpulse(ctx);
      this.wetNode = ctx.createGain(); this.wetNode.gain.value = 0;
      this.normalizationNode.connect(convolver); convolver.connect(this.wetNode); this.wetNode.connect(this.effectsBus);
    }
    this.wetNode?.gain.setTargetAtTime(e.reverb * 0.9, now, 0.08);
    this.dryNode.gain.setTargetAtTime(1 - e.reverb * 0.35, now, 0.08);
    if (e.pitch !== 0 && !this.pitchNode && !this.pitchLoading && ctx.audioWorklet) {
      this.pitchLoading = ctx.audioWorklet.addModule('/worklets/pitch-shifter.js').then(() => {
        if (!this.eqOut || !this.normalizationNode) return;
        const node = new AudioWorkletNode(ctx, 'oskolok-pitch-shifter', { outputChannelCount: [2] });
        this.eqOut.disconnect(this.normalizationNode); this.eqOut.connect(node); node.connect(this.normalizationNode);
        this.pitchNode = node;
        this.applyEffects();
      }).catch(() => { /* No worklets in this WebView: pitch stays as recorded. */ }).finally(() => { this.pitchLoading = null; });
    }
    this.pitchNode?.parameters.get('ratio')?.setTargetAtTime(pitchRatio(e.pitch), now, 0.03);
  }

  public getEqualizer(): number[] {
    try { return normalizeEqualizer(JSON.parse(localStorage.getItem(scopedStorageKey("equalizer")) || "null")); } catch { return normalizeEqualizer(null); }
  }
  public setEqualizer(values:number[]): void {
    this.equalizerGains=normalizeEqualizer(values);
    localStorage.setItem(scopedStorageKey("equalizer"),JSON.stringify(this.equalizerGains));
    this.ensureEqualizer();
    this.equalizerNodes.forEach((node,i)=>node.gain.setTargetAtTime(this.equalizerGains[i],this.equalizerContext!.currentTime,0.025));
    this.applyNormalization();
  }
  /**
   * iOS WebKit suspends an AudioContext when the screen locks or Safari goes to the background. A media
   * element routed through createMediaElementSource then goes silent with it, so on iOS the element
   * plays directly and keeps the system audio session (lock screen, Control Centre, AirPods).
   */
  private static readonly appleMobile = typeof navigator !== "undefined" && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
  public equalizerSupported():boolean {return typeof AudioContext !== "undefined" && !spotifyPlayback.active && !AudioManager.appleMobile;}
  private ensureEqualizer():void {
    if (!this.equalizerSupported()) return;
    try {
      if(!this.equalizerContext){
        this.equalizerContext=new AudioContext();
        // Both media elements feed the same chain, each through its own gain (the crossfade).
        const input=this.equalizerContext.createGain();
        // «ИИ-микс» reverb: one room both tracks can send into.
        const mixRoom=this.equalizerContext.createConvolver();mixRoom.buffer=reverbImpulse(this.equalizerContext,3,2.6);const mixRoomGain=this.equalizerContext.createGain();mixRoomGain.gain.value=.8;mixRoom.connect(mixRoomGain);mixRoomGain.connect(input);
        for(const el of [this.audio,this.spare]){const source=this.equalizerContext.createMediaElementSource(el),gain=this.equalizerContext.createGain();this.mixChains.set(el,buildMixChain(this.equalizerContext,source,gain,input,mixRoom));gain.connect(input);this.elementGains.set(el,gain);}
        let previous:AudioNode=input;
        this.equalizerNodes=EQ_FREQUENCIES.map(frequency=>{const filter=this.equalizerContext!.createBiquadFilter();filter.type="peaking";filter.frequency.value=frequency;filter.Q.value=1;previous.connect(filter);previous=filter;return filter;});
        this.eqOut=previous;
        this.normalizationNode=this.equalizerContext.createGain();previous.connect(this.normalizationNode);previous=this.normalizationNode;
        // Reverb: dry and wet paths meet in one bus; the convolver is built only once reverb is turned up.
        this.dryNode=this.equalizerContext.createGain();previous.connect(this.dryNode);
        const bus=this.equalizerContext.createGain();this.dryNode.connect(bus);this.effectsBus=bus;previous=bus;
        // The analyser taps the end of the chain for the home visualiser; it passes audio through untouched.
        try{const analyser=this.equalizerContext.createAnalyser();analyser.fftSize=512;analyser.smoothingTimeConstant=0.7;previous.connect(analyser);previous=analyser;this.analyser=analyser;}catch{this.analyser=null;}
        previous.connect(this.equalizerContext.destination);
      }
      this.equalizerGains=this.getEqualizer();
      this.equalizerNodes.forEach((node,i)=>node.gain.value=this.equalizerGains[i]);
      this.applyEffects();
      this.applyNormalization();
      if(this.equalizerContext.state==="suspended")void this.equalizerContext.resume().catch(()=>{});
    } catch { /* Unsupported WebViews keep normal audio playback. */ }
  }
  public closeTrack():void {
    this.cuedPosition=0;this.cancelCrossfade();
    ++this.playSessionId;this.userWantsPlayback=false;this.stopAudioPipeline();
    if(spotifyPlayback.active){void spotifyPlayback.pause().catch(()=>{});spotifyPlayback.stop();}
    this.currentTrack=null;this.currentPlaybackInfo=null;
    this.notifyTrackChange(null);this.notifyTimeUpdate(0,0);this.notifyStateChange(false,false);
    if("mediaSession" in navigator)navigator.mediaSession.metadata=null;
  }

  private makeElement(): HTMLAudioElement {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.volume = elementVolume(this.volume);
    el.setAttribute('playsinline', '');
    el.setAttribute('x-webkit-airplay', 'allow');
    return el;
  }

  private constructor() {
    // Two media elements: the active one plays the current track; during a crossfade the other one
    // finishes the previous track while it fades out. Events of the inactive element are ignored.
    this.audio = this.makeElement();
    this.spare = this.makeElement();
    this.applyEffects();
    this.attachAudioListeners(this.audio);
    this.attachAudioListeners(this.spare);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      if (document.hidden || !this.equalizerContext) return;
      if (this.equalizerContext.state !== 'running' && !this.audio.paused) void this.equalizerContext.resume().catch(() => {});
    });
    // Buttons of the Android notification, lock screen and headphones.
    (window as unknown as { __oskolokMedia?: (command: string, positionMs: number) => void }).__oskolokMedia = (command, positionMs) => {
      if (command === 'play') this.resume(); else if (command === 'pause') this.pause();
      else if (command === 'next') void this.next(); else if (command === 'previous') void this.previous();
      else if (command === 'seek') this.seek(positionMs / 1000);
    };
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
        this.maybeCrossfade(cur, dur);
      }
    }, 250);
  }

  private stopTimeUpdateTicker(): void {
    if (this.timeUpdateTicker) {
      clearInterval(this.timeUpdateTicker);
      this.timeUpdateTicker = null;
    }
  }

  /* ---------- Crossfade (Spotify, Яндекс «плавное переключение») ---------- */
  public getCrossfade(): number { try { const v = Number(localStorage.getItem(scopedStorageKey('crossfade'))); return Number.isFinite(v) ? Math.max(0, Math.min(12, v)) : 0; } catch { return 0; } }
  public setCrossfade(seconds: number): void {
    try { localStorage.setItem(scopedStorageKey('crossfade'), String(Math.max(0, Math.min(12, Math.round(seconds))))); } catch { /* private mode */ }
    if (!seconds) this.cancelCrossfade();
  }
  /** «ИИ-микс»: transitions planned per track pair from beat analysis (beatmatch, bass swap, filters, echo). */
  public getMix(): boolean { try { return localStorage.getItem(scopedStorageKey('ai-mix')) === '1'; } catch { return false; } }
  public setMix(on: boolean): void {
    try { localStorage.setItem(scopedStorageKey('ai-mix'), on ? '1' : '0'); } catch { /* private mode */ }
    if (on) { this.ensureEqualizer(); this.prefetchNextTrack(); } else this.cancelCrossfade();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('oskolok-mix'));
  }
  public getMixSettings(): MixSettings { try { return { ...DEFAULT_MIX_SETTINGS, ...JSON.parse(localStorage.getItem(scopedStorageKey('ai-mix-settings')) || '{}') }; } catch { return DEFAULT_MIX_SETTINGS; } }
  public setMixSettings(next: Partial<MixSettings>): void {
    try { localStorage.setItem(scopedStorageKey('ai-mix-settings'), JSON.stringify({ ...this.getMixSettings(), ...next })); } catch { /* private mode */ }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('oskolok-mix'));
  }
  private setMixNow(value: AudioManager['mixNow']): void { this.mixNow = value; if (typeof window !== 'undefined') window.dispatchEvent(new Event('oskolok-mix')); }
  /** iOS keeps media volume read-only and the Web Audio chain off: there the tracks simply follow each other. */
  /** «ИИ-микс» works only inside Резонанс (the wave); the player store keeps this in step with isWaveActive. */
  private waveActive = false;
  public setWaveActive(on: boolean): void { if (this.waveActive === on) return; this.waveActive = on; if (!on) this.cancelCrossfade(); else this.prefetchNextTrack(); }
  public mixActive(): boolean { return this.waveActive && this.getMix() && this.crossfadeSupported(); }
  public crossfadeSupported(): boolean { return !AudioManager.appleMobile && !spotifyPlayback.active; }

  /** Moves a media element's own gain (Web Audio when the chain runs, element volume otherwise). */
  private rampElement(el: HTMLAudioElement, target: number, seconds: number): void {
    const gain = this.elementGains.get(el), ctx = this.equalizerContext;
    if (gain && ctx) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now);
      if (seconds > 0) gain.gain.linearRampToValueAtTime(target, now + seconds); else gain.gain.setValueAtTime(target, now);
      return;
    }
    clearInterval(this.volumeRamps.get(el));
    const base = this.isMuted ? 0 : elementVolume(this.volume) * this.fadeGain, from = base ? el.volume / base : 1, started = performance.now();
    if (seconds <= 0) { el.volume = base * target; return; }
    this.volumeRamps.set(el, setInterval(() => {
      const k = Math.min(1, (performance.now() - started) / (seconds * 1000));
      try { el.volume = Math.max(0, Math.min(1, base * (from + (target - from) * k))); } catch { /* read-only volume */ }
      if (k >= 1) { clearInterval(this.volumeRamps.get(el)); this.volumeRamps.delete(el); }
    }, 50));
  }
  private releaseFading(el: HTMLAudioElement): void {
    if (this.fading !== el) return;
    this.fading = null;
    clearInterval(this.volumeRamps.get(el)); this.volumeRamps.delete(el);
    try { el.pause(); el.removeAttribute('src'); el.load(); } catch { /* already idle */ }
    this.rampElement(el, 1, 0);
    const chain = this.mixChains.get(el);
    if (chain && this.equalizerContext) resetChain(this.equalizerContext, chain);
  }
  /** Any manual move (pause, seek, another track) ends a running crossfade at once. */
  private cancelCrossfade(): void {
    if (this.pendingMix || this.mixNow || this.rateRestore) {
      this.pendingMix = null; clearInterval(this.rateRestore); this.rateRestore = undefined;
      const chain = this.mixChains.get(this.audio);
      if (chain && this.equalizerContext) resetChain(this.equalizerContext, chain);
      this.applyEffects(); this.setMixNow(null);
    }
    if (this.fading) this.releaseFading(this.fading);
    if (this.pendingFadeIn || (this.elementGains.get(this.audio)?.gain.value ?? 1) !== 1) { this.pendingFadeIn = null; this.rampElement(this.audio, 1, 0); }
  }
  private maybeCrossfade(cur: number, dur: number): void {
    const secs = this.getCrossfade();
    if (this.mixActive() && this.equalizerContext) { this.maybeMix(cur, dur, secs); return; }
    if (!secs || this.fading || this.crossfadeAdvance || !this.crossfadeSupported() || this.externalOn()) return;
    if (!this.userWantsPlayback || this.audio.paused || !Number.isFinite(dur) || dur < secs * 3) return;
    const left = (dur - cur) / (this.audio.playbackRate || 1);
    if (left > secs || left < 0.4) return;
    if (this.stopAfterCurrent || queueManager.getState().repeatMode === 'one' || queueManager.peekNextTrack() === null) return;
    const out = this.audio, incoming = this.spare, fade = Math.max(0.5, left);
    this.fading = out;
    // The outgoing track counts as played to its end (history, listening statistics, wave feedback).
    this.listeners.forEach(l => l.onEnded?.(this.currentTrack));
    this.audio = incoming; this.spare = out;
    incoming.volume = this.isMuted ? 0 : elementVolume(this.volume) * this.fadeGain;
    this.applyEffects();
    this.rampElement(incoming, 0, 0);
    this.pendingFadeIn = { el: incoming, secs: fade };
    this.rampElement(out, 0, fade);
    const release = () => this.releaseFading(out);
    out.addEventListener('ended', release, { once: true });
    setTimeout(release, fade * 1000 + 250);
    this.crossfadeAdvance = true;
    try { void this.next('natural'); } finally { this.crossfadeAdvance = false; }
  }

  /** «ИИ-микс»: when A reaches the planned point, B starts on the spare element and the plan takes over. */
  private maybeMix(cur: number, dur: number, secs: number): void {
    if (this.fading || this.crossfadeAdvance || !this.crossfadeSupported() || this.externalOn()) return;
    if (!this.userWantsPlayback || this.audio.paused || !Number.isFinite(dur) || dur < 30) return;
    if (this.stopAfterCurrent || queueManager.getState().repeatMode === 'one') return;
    const nextTrack = queueManager.peekNextTrack(), current = this.currentTrack;
    if (!nextTrack || !current || dur - cur > 90) return;
    // Analyses are asked for in the last 90 s; whatever has arrived by the planned point is used.
    const a = mixAnalysis(current.id) ?? null, b = mixAnalysis(nextTrack.id) ?? null;
    const plan = planMix(a, b, dur, secs || 6, this.getMixSettings());
    if (cur < plan.at || cur > plan.at + plan.duration * .6) return;
    const out = this.audio, incoming = this.spare;
    this.fading = out;
    this.listeners.forEach(l => l.onEnded?.(this.currentTrack));
    this.audio = incoming; this.spare = out;
    incoming.volume = this.isMuted ? 0 : elementVolume(this.volume) * this.fadeGain;
    this.applyEffects();
    this.rampElement(incoming, 0, 0);
    this.pendingMix = { el: incoming, out, plan, a, b };
    this.setMixNow({ preset: plan.preset, beatmatched: plan.beatmatched, from: a?.bpm, to: b?.bpm });
    const release = () => { if (this.fading === out) this.releaseFading(out); };
    out.addEventListener('ended', release, { once: true });
    setTimeout(release, (plan.at + plan.duration - cur) * 1000 + 600);
    this.crossfadeAdvance = true;
    try { void this.next('natural'); } finally { this.crossfadeAdvance = false; }
  }
  /** B sounds: cue it on A's beat grid (beatmatched pairs) and run the planned automation for the time left. */
  private startPendingMix(el: HTMLAudioElement): void {
    const m = this.pendingMix; if (!m || m.el !== el) return;
    this.pendingMix = null;
    const ctx = this.equalizerContext, outChain = this.mixChains.get(m.out), inChain = this.mixChains.get(el), outGain = this.elementGains.get(m.out), inGain = this.elementGains.get(el);
    if (!ctx || !outChain || !inChain || !outGain || !inGain) { this.rampElement(el, 1, m.plan.duration); return; }
    const elapsed = Math.max(0, m.out.currentTime - m.plan.at), p0 = Math.min(.95, elapsed / m.plan.duration);
    const frac = (x: number) => x - Math.floor(x);
    if (m.plan.beatmatched && m.a && m.b) {
      let target = m.plan.bStart + elapsed * m.plan.rate;
      let shift = frac((m.out.currentTime - m.a.downbeat) / m.a.beat) - frac((target - m.b.downbeat) / m.b.beat);
      if (shift > .5) shift -= 1;
      if (shift < -.5) shift += 1;
      target += shift * m.b.beat;
      try { el.currentTime = Math.max(0, target); } catch { /* not seekable yet: plays from where it is */ }
      (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      el.playbackRate = this.effects.speed * m.plan.rate;
    } else if (m.plan.bStart > 0) { try { el.currentTime = m.plan.bStart + elapsed; } catch { /* plays from the start */ } }
    runMix(ctx, m.plan, p0, { chain: outChain, gain: outGain }, { chain: inChain, gain: inGain }, m.a?.beat ?? .5);
    const left = m.plan.duration * (1 - p0);
    setTimeout(() => {
      if (this.audio !== el) return;
      resetChain(ctx, inChain, .3); this.setMixNow(null);
      // The borrowed tempo eases back to normal over a few seconds, too slowly to notice.
      clearInterval(this.rateRestore);
      this.rateRestore = setInterval(() => {
        const target = this.effects.speed, rate = el.playbackRate + (target - el.playbackRate) * .12;
        if (this.audio !== el || Math.abs(rate - target) < .002) {
          if (this.audio === el) { el.playbackRate = target; (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = this.effects.preservePitch; }
          clearInterval(this.rateRestore); this.rateRestore = undefined; return;
        }
        el.playbackRate = rate;
      }, 250);
    }, left * 1000 + 200);
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
    if (this.externalPlayback?.active()) {
      ++this.playSessionId; this.userWantsPlayback = false; this.stopAudioPipeline();
      if (spotifyPlayback.active) { void spotifyPlayback.pause().catch(() => {}); spotifyPlayback.stop(); }
      this.currentTrack = track; this.notifyTrackChange(track); this.setBuffering(false);
      this.externalPlayback.play(track);
      this.startExternalClock(0);
      return;
    }
    this.ensureEqualizer();
    spotifyPlayback.activateFromGesture();
    const priorSource=this.preferredSources.get(track.id);
    preferredSource=preferredSource??getPreferredSource(track.id);
    if(preferredSource==='telegram')preferredSource='auto';
    if(preferredSource==='auto')this.preferredSources.delete(track.id);
    else if(preferredSource)this.preferredSources.set(track.id,preferredSource);
    if (this.currentTrack?.id === track.id && (this.audio.src||spotifyPlayback.active) && (preferredSource===undefined||priorSource===this.preferredSources.get(track.id)) && (!this.audio.src || (new URL(this.audio.src,window.location.href).searchParams.get('recording')||undefined)===getRecording(track.id,preferredSource))) {
      this.resume();
      return;
    }

    if (!this.crossfadeAdvance) this.cancelCrossfade();
    // Increment session ID to immediately invalidate all past callbacks/promises
    const sessionId = ++this.playSessionId;
    this.userWantsPlayback = true;
    this.cuedPosition = 0;
    this.currentTrack = track;
    this.startedTrackId = '';
    this.historyLoggedForCurrent = false;
    this.measureTrack(track,sessionId);
    this.recoveryAttempts = 0;

    // Immediately stop and teardown any previous audio stream so it stops playing instantly
    this.stopAudioPipeline();
    if(spotifyPlayback.active){void spotifyPlayback.pause().catch(()=>{});spotifyPlayback.stop();}

    // Update UI immediately
    this.notifyTrackChange(track);
    this.setBuffering(true);

    const selectedSource = this.preferredSources.get(track.id);
    // A downloaded track plays from this device — offline, instantly and without spending traffic.
    if (isDownloaded(track.id) && (!selectedSource || selectedSource === 'auto')) {
      const offlineUrl = await offlineAudioUrl(track.id);
      if (sessionId !== this.playSessionId) return;
      if (offlineUrl) {
        this.audio.src = offlineUrl;
        this.currentPlaybackInfo = { available: true, type: 'progressive', url: offlineUrl, expiresAt: Date.now() + 86400000, mimeType: 'audio/mp4' };
        this.currentTrack = { ...track, audioSource: 'offline' };
        this.notifyTrackChange(this.currentTrack);
        this.setupMediaSession(track);
        try {
          await this.audio.play();
          if (sessionId !== this.playSessionId || !this.userWantsPlayback) return;
          this.setBuffering(false);
          this.notifyStateChange(true, false);
          this.prefetchNextTrack();
          return;
        } catch (error) {
          if (sessionId !== this.playSessionId || (error as Error)?.name === 'AbortError') return;
          if ((error as Error)?.name === 'NotAllowedError') {
            this.setBuffering(false); this.notifyStateChange(false, false);
            this.notifyError('AUTOPLAY_BLOCKED', tr('Нажмите «Воспроизвести» для запуска', 'Press Play to start'));
            return;
          }
          this.stopAudioPipeline(); this.setBuffering(true); // a broken copy: fall back to the network below
        }
      }
    }
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
          this.notifyError('AUTOPLAY_BLOCKED', tr('Нажмите «Воспроизвести» для запуска', 'Press Play to start'));
          return;
        }
        this.stopAudioPipeline();
        this.setBuffering(true);
      }
    }

    // Automatic Spotify Connect may choose a different device on a phone.
    // Keep automatic mobile playback local; explicit Spotify still uses it.
    // Community unreleased uploads only exist as our stored file: never look them up on Spotify.
    const unreleased = track.source === 'unreleased';
    const hasPersonal = unreleased ? false : !selectedSource ? await apiClient.request<{audio:unknown}>(`/content/tracks/${encodeURIComponent(track.id)}/personal`).then(data=>!!data.audio).catch(()=>false) : selectedSource==='personal';
    if(sessionId!==this.playSessionId)return;
    // Spotify is a catalogue only: its audio cannot be played without a Spotify device, so every
    // track streams through Osk's own resolver (the same on desktop, web, phones and Telegram).
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

    let definitiveMiss = false;
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
            this.notifyError('AUTOPLAY_BLOCKED', tr('Нажмите «Воспроизвести» для запуска', 'Press Play to start'));
            return;
          }
          // play() failed (e.g. format issue) — try next attempt
          if (attempt < maxPolls - 1) continue;
        }
      }

      // Non-retriable HTTP error (404, 5xx that's not 503)
      if (probeStatus === 404 || (probeStatus >= 500 && probeStatus !== 503)) {
        // 404 is the server's final word that no source exists; assigning the
        // same URL to the audio element would only repeat the wait.
        definitiveMiss = probeStatus === 404;
        break;
      }
    }

    // All retries exhausted — try direct src assignment as last resort
    if (!definitiveMiss && sessionId === this.playSessionId && this.userWantsPlayback) {
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
          this.notifyError('AUTOPLAY_BLOCKED', tr('Нажмите «Воспроизвести» для запуска', 'Press Play to start'));
          return;
        }
      }
    }

    if (sessionId !== this.playSessionId) return;

    this.stopAudioPipeline();
    this.notifyStateChange(false, false);

    const hasNext = queueManager.peekNextTrack() !== null || this.onNeedMoreTracksHandler !== null;
    if (hasNext && this.userWantsPlayback) {
      this.notifyError('SOURCE_UNAVAILABLE', tr('Трек недоступен. Переход к следующему...', 'Track unavailable. Skipping to the next one...'));
      setTimeout(() => {
        if (sessionId === this.playSessionId && this.userWantsPlayback) {
          this.next();
        }
      }, 1200);
    } else {
      this.notifyError('SOURCE_UNAVAILABLE', tr('Не удалось загрузить аудиодорожку', 'Could not load the audio'));
    }
  }

  public prefetchNextTrack(): void {
    try {
      const nextTrack = queueManager.peekNextTrack();
      if (nextTrack && nextTrack.id) {
        // With «ИИ-микс» the server also downloads and beat-analyses both tracks now, so the transition
        // minutes later is planned from real analyses instead of falling back to a plain fade.
        const mix = this.mixActive();
        apiClient.prefetchTrack(nextTrack.id, mix).catch(() => {});
        if (mix && this.currentTrack) apiClient.prefetchTrack(this.currentTrack.id, true).catch(() => {});
      }
    } catch {
      // Non-blocking prefetch
    }
  }

  public async playCollection(tracks: Track[], startIndex: number = 0, preferredSource?: string): Promise<void> {
    if (tracks.length === 0) return;
    if (preferredSource === 'telegram') preferredSource = 'auto';
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
    this.cancelCrossfade();
    if (this.externalOn()) { this.stopExternalClock(); this.notifyStateChange(false, false); return; }
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
    if (this.externalPlayback?.active()) {
      // A sent track resumes the clock; with nothing sent yet the chat is where the music is.
      if (this.currentTrack && !this.ext.running) { this.startExternalClock(this.externalTime() >= (this.currentTrack.duration || Infinity) ? 0 : this.ext.offset); return; }
      this.externalPlayback.resume(); return;
    }
    this.ensureEqualizer();
    if (!this.currentTrack) return;
    this.userWantsPlayback = true;
    const sessionId = ++this.playSessionId;

    if(spotifyPlayback.active){spotifyPlayback.activateFromGesture();void spotifyPlayback.resume().then(()=>{if(sessionId===this.playSessionId)this.notifyStateChange(true,false);}).catch(e=>this.notifyError('SOURCE_UNAVAILABLE',(e as Error).message));return;}

    if (!this.audio.src) {
      const track = this.currentTrack, at = this.cuedPosition;
      this.cuedPosition = 0;
      if (at > 2) {
        const seekOnce = () => { if (this.currentTrack?.id === track.id && at < (this.audio.duration || 0) - 2) this.seek(at); };
        this.audio.addEventListener('loadedmetadata', seekOnce, { once: true });
      }
      this.playTrack(track);
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
          this.notifyError('AUTOPLAY_BLOCKED', tr('Нажмите «Воспроизвести» для запуска', 'Press Play to start'));
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

  /** Called when the queue has nothing after the current track. `natural`: the track played to its end;
   * `manual`: the listener pressed «next». A release continuation starts only after a natural end. */
  private onNeedMoreTracksHandler: ((reason: 'natural' | 'manual') => Promise<void | boolean>) | null = null;

  public setOnNeedMoreTracks(handler: ((reason: 'natural' | 'manual') => Promise<void | boolean>) | null): void {
    this.onNeedMoreTracksHandler = handler;
  }

  public async next(reason: 'natural' | 'manual' = 'manual'): Promise<void> {
    if (this.externalPlayback?.active()) { this.externalPlayback.step(1); return; }
    this.lastAdvance = reason; this.advanceAt = Date.now();
    if (this.onNeedMoreTracksHandler && queueManager.peekNextTrack() === null) {
      try {
        await this.onNeedMoreTracksHandler(reason);
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
    if (this.externalPlayback?.active()) { this.externalPlayback.step(-1); return; }
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
    this.cancelCrossfade();
    if (this.externalOn()) {
      const d = this.currentTrack?.duration || 0, target = Math.max(0, d ? Math.min(seconds, d) : seconds);
      this.ext.offset = target; this.ext.startedAt = performance.now();
      this.notifyTimeUpdate(target, d); this.listeners.forEach(l => l.onSeek?.(target, d));
      return;
    }
    if(spotifyPlayback.active){void spotifyPlayback.seek(seconds).catch(()=>{});this.notifyTimeUpdate(seconds,this.currentTrack?.duration||0);return;}
    if (this.audio.duration && !isNaN(this.audio.duration)) {
      const targetTime = Math.max(0, Math.min(seconds, this.audio.duration));
      this.audio.currentTime = targetTime;
      this.nativeSent.at = 0; // the notification's scrubber jumps with the seek
      this.notifyTimeUpdate(targetTime, this.audio.duration);
      this.listeners.forEach((listener) => listener.onSeek?.(targetTime, this.audio.duration));
    }
  }

  /** Position to start from when a track restored after a restart is played for the first time. */
  private cuedPosition = 0;
  /** Shows a track (restored after a restart) as current and paused, without loading audio until «play». */
  public cueTrack(track: Track, position: number): void {
    if (this.currentTrack) return;
    this.currentTrack = track; this.cuedPosition = Math.max(0, position);
    this.notifyTrackChange(track); this.notifyTimeUpdate(this.cuedPosition, track.duration || 0); this.notifyStateChange(false, false);
  }

  /** Set by the sleep timer: called instead of moving to the next track when the current one ends. */
  public stopAfterCurrent: (() => void) | null = null;
  /** Extra gain 0–1 on top of the listener's volume (sleep-timer fade); the volume setting itself stays. */
  private fadeGain = 1;
  public setFadeGain(gain: number): void {
    this.fadeGain = Math.max(0, Math.min(1, gain));
    this.audio.volume = this.isMuted ? 0 : elementVolume(this.volume) * this.fadeGain;
  }

  public setVolume(val: number): void {
    const bounded = Math.max(0, Math.min(1, val));
    this.volume = bounded;
    this.audio.volume = this.isMuted ? 0 : elementVolume(bounded) * this.fadeGain;
    if(spotifyPlayback.active)void spotifyPlayback.volume(this.isMuted?0:elementVolume(bounded)).catch(()=>{});
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    this.audio.volume = this.isMuted ? 0 : elementVolume(this.volume) * this.fadeGain;
    if(spotifyPlayback.active)void spotifyPlayback.volume(this.isMuted?0:elementVolume(this.volume)).catch(()=>{});
    return this.isMuted;
  }

  public toggleShuffle(): boolean {
    return queueManager.toggleShuffle();
  }

  public setRepeatMode(mode: RepeatMode): void {
    queueManager.setRepeatMode(mode);
  }

  public getCurrentTime(): number {
    if (this.externalOn()) return this.externalTime();
    return spotifyPlayback.active ? spotifyPlayback.getCurrentTime() : this.audio.currentTime || 0;
  }

  private smoothClock = { raw: NaN, anchorRaw: 0, anchorAt: 0, out: 0 };
  /**
   * Frame-accurate playback time for animation. WebKit advances
   * audio.currentTime in coarse steps, which made karaoke fills stutter;
   * between steps the time is extrapolated from the last sample. Seeks and
   * stalls snap, small corrections only move forward.
   */
  public getSmoothTime(): number {
    if (this.externalOn()) return this.externalTime();
    const raw = this.getCurrentTime(), now = performance.now(), c = this.smoothClock;
    if (spotifyPlayback.active || this.audio.paused || !this.userWantsPlayback) {
      c.raw = raw; c.anchorRaw = raw; c.anchorAt = now; c.out = raw;
      return raw;
    }
    if (raw !== c.raw) { c.raw = raw; c.anchorRaw = raw; c.anchorAt = now; }
    const estimate = c.anchorRaw + ((now - c.anchorAt) / 1000) * (this.audio.playbackRate || 1);
    c.out = Math.abs(estimate - c.out) > 0.5 ? estimate : Math.max(c.out, Math.min(estimate, raw + 0.35));
    return c.out;
  }

  public getDuration(): number {
    if (this.externalOn()) return this.currentTrack?.duration || 0;
    return spotifyPlayback.active ? this.currentTrack?.duration || 0 : this.audio.duration || 0;
  }

  public getIsPlaying(): boolean {
    if (this.externalOn()) return this.ext.running;
    return spotifyPlayback.active ? spotifyPlayback.isPlaying && this.userWantsPlayback : !this.audio.paused && this.userWantsPlayback;
  }

  public getCurrentTrack(): Track | null {
    return this.currentTrack;
  }

  private attachAudioListeners(el: HTMLAudioElement): void {
    const on = (type: string, handler: (event: Event) => void) => el.addEventListener(type, event => { if (el === this.audio) handler(event); });
    on('timeupdate', () => {
      if (!this.userWantsPlayback) return;
      const cur = this.audio.currentTime;
      const dur = this.audio.duration || 0;
      this.notifyTimeUpdate(cur, dur);
      this.maybeCrossfade(cur, dur);

      // Check playback history threshold rule: >= 30 seconds or >= 50% duration
      if (!this.historyLoggedForCurrent && this.currentTrack) {
        if (cur >= 30 || (dur > 0 && cur >= dur * 0.5)) {
          this.historyLoggedForCurrent = true;
          apiClient.addHistory(this.currentTrack).catch(() => {});
        }
      }
    });

    on('play', () => {
      this.startTimeUpdateTicker();
    });

    on('pause', () => {
      this.stopTimeUpdateTicker();
      // Paused by the system (a call, another app, unplugged headphones), not through pause():
      // follow it so the play button and the lock-screen controls tell the truth.
      if (this.userWantsPlayback && !this.isStopping && this.audio.paused && !this.audio.ended && this.audio.src && this.audio.readyState >= 2) {
        this.userWantsPlayback = false;
        this.notifyStateChange(false, false);
      }
    });

    on('ended', () => { void (async () => {
      this.stopTimeUpdateTicker();
      this.notifyStateChange(false, false);
      this.listeners.forEach(l => l.onEnded?.(this.currentTrack));
      // Sleep timer «until the end of the track»: the music stops here instead of moving on.
      const stop = this.stopAfterCurrent;
      if (stop) { this.stopAfterCurrent = null; this.userWantsPlayback = false; stop(); return; }
      await this.next('natural');
    })(); });

    // «playing» fires on every resume too; listeners get the first one of each track.
    on('playing', () => {
      // The incoming track of a crossfade rises from silence once it really sounds.
      if (this.pendingFadeIn && this.pendingFadeIn.el === el) { const secs = this.pendingFadeIn.secs; this.pendingFadeIn = null; this.rampElement(el, 1, secs); }
      if (this.pendingMix && this.pendingMix.el === el) this.startPendingMix(el);
      const id = this.currentTrack?.id || '';
      if (id && this.startedTrackId !== id) { this.startedTrackId = id; this.listeners.forEach(l => l.onAudioStarted?.(this.currentTrack)); }
    });

    on('waiting', () => {
      if (this.userWantsPlayback) {
        this.setBuffering(true);
      }
    });

    on('canplay', () => {
      this.setBuffering(false);
    });

    on('error', (e) => {
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
      // A dropped connection or an expired upstream link mid-song: ask our stream endpoint again and resume
      // at the same second before giving up on the track.
      const streamUrl = this.currentPlaybackInfo?.url;
      if (streamUrl && streamUrl.startsWith('/api/')) {
        try {
          const resumeAt = this.audio.currentTime || 0;
          this.setBuffering(true);
          await new Promise(r => setTimeout(r, 600 * this.recoveryAttempts));
          if (currentSession !== this.playSessionId || !this.userWantsPlayback) return;
          this.audio.src = `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}retry=${Date.now()}`;
          if (resumeAt > 1) this.audio.addEventListener('loadedmetadata', () => { try { this.audio.currentTime = resumeAt; } catch { /* Seek is best effort. */ } }, { once: true });
          await this.audio.play();
          if (currentSession === this.playSessionId && this.userWantsPlayback) {
            this.setBuffering(false);
            this.notifyStateChange(true, false);
            return;
          }
        } catch (retryErr: any) {
          if (retryErr?.name === 'AbortError' && currentSession !== this.playSessionId) return;
        }
      }
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
        this.notifyError('SOURCE_UNAVAILABLE', tr('Трек недоступен. Переход к следующему...', 'Track unavailable. Skipping to the next one...'));
        setTimeout(() => {
          if (currentSession === this.playSessionId && this.userWantsPlayback) {
            this.next();
          }
        }, 1200);
      } else {
        this.notifyError('SOURCE_UNAVAILABLE', tr('Не удалось воспроизвести трек. Попробуйте другой.', 'Could not play this track. Try another one.'));
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
    this.reportNative();
    const now=Date.now(),last=this.positionReported;
    if ('mediaSession' in navigator && Number.isFinite(dur) && dur > 0 && Number.isFinite(cur) && (now-last.at>=1000||Math.abs(cur-last.time)>1.5||last.duration!==dur)) {
      this.positionReported={at:now,time:cur,duration:dur};
      try { navigator.mediaSession.setPositionState?.({ duration: dur, position: Math.min(dur, Math.max(0,cur)), playbackRate: this.audio.playbackRate }); } catch { /* Platform may not support position state. */ }
    }
    this.listeners.forEach((l) => l.onTimeUpdate?.(cur, dur));
  }

  private notifyStateChange(playing: boolean, buffering: boolean): void {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    if (!buffering) this.reportNative(true);
    this.listeners.forEach((l) => l.onStateChange?.(playing, buffering));
  }

  private notifyTrackChange(track: Track | null): void {
    queueMicrotask(() => this.reportNative(true));
    this.listeners.forEach((l) => l.onTrackChange?.(track));
  }

  private notifyError(type: AudioErrorType, msg: string): void {
    this.listeners.forEach((l) => l.onError?.(type, msg));
  }
}

export const audioManager = AudioManager.getInstance();
