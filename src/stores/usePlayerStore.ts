import { create } from 'zustand';
import { Track, RepeatMode } from '../types/index.js';
import { audioManager } from '../audio/AudioManager.js';
import { queueManager, QueueState } from '../audio/QueueManager.js';
import { useToastStore } from './useToastStore.js';
import { apiClient, ApiError } from '../api/apiClient.js';
import {useTelegramStore} from '../telegram/runtime.js';
import {trackEvent} from '../telemetry/events.js';

import { tr } from './useLanguageStore.js';
import {useLibraryStore} from './useLibraryStore.js';
import {WaveSettings,WaveOptionInput,loadWaveSettings,saveWaveSettings,normalizeWaveSettings,fetchWaveBatch,fetchReleaseContinuation,recordWaveSkip,sendWaveFeedback,waveSession,emptyWaveMessage,releaseSeedOf,continuationAllowed,autoplayEnabled,queueSeedOf,type ReleaseSeed,type WaveBlend} from './waveSettings.js';
/** Furthest point reached in the current track — tells a skip from a listen. */
let waveProgress={id:'',max:0,dur:0};
/** A shared listening session (Jam) takes over what is queued; returns true when it handled the track. */
export const queueHooks: { add?: (track: Track, mode: 'end' | 'next' | 'now') => boolean; shared?: () => boolean } = {};
let waveSettingsTimer:ReturnType<typeof setTimeout>|undefined;
/* Endless wave: one refill at a time, every answer tagged with the session it was asked for, so a
   late answer never lands in a newer wave (settings changed, wave stopped, another user). */
let waveGeneration=0;
let refillInFlight:Promise<boolean>|null=null;
let waveRetryTimer:ReturnType<typeof setTimeout>|undefined,waveRetries=0;
/** The queue ran out while the wave was waiting for music: play as soon as a refill lands. */
let waveAwaitingTracks=false;
/** Played tracks kept behind the cursor in long sessions (memory stays flat). */
// Small batches, refilled early: like Yandex «Моя волна», the stream turns after every few tracks instead of every twenty.
const WAVE_HISTORY_KEEP=40,WAVE_REFILL_AT=4,WAVE_BATCH=12;
let continuation:{seed:ReleaseSeed;promise:Promise<Track[]>|null;autoplay?:boolean}|null=null;
/** Autoplay continuation for any queue that is not one release (playlist, liked, search, a single track). */
const autoplayFor=(tracks:Track[])=>{const seed=autoplayEnabled()?queueSeedOf(tracks):null;return seed?{seed,promise:null,autoplay:true}:null;};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let lastPublished:string|null|undefined;
let lastHeartbeat=0;
let lastPublicationWarning=0;
let publicationQueue:Promise<unknown>=Promise.resolve();
const playbackSession=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():String(Date.now());
function publishPlayback(track:Track|null,playing:boolean,force=false){
  if(!useTelegramStore.getState().user)return;
  const id=playing?track?.id||null:null;
  if(!force&&lastPublished===id)return;
  lastPublished=id;lastHeartbeat=Date.now();
  publicationQueue=publicationQueue.catch(()=>{}).then(()=>apiClient.request('/profile/now-playing',{method:'PUT',body:JSON.stringify({trackId:id,sessionId:playbackSession,heartbeat:force})})).catch((error:unknown)=>{
    if(lastPublished===id)lastPublished=undefined;
    if(Date.now()-lastPublicationWarning>30000){
      lastPublicationWarning=Date.now();
      useToastStore.getState().addToast(error instanceof Error?`${tr('Не удалось обновить трек в профиле', 'Could not update the profile track')}: ${error.message}`:'Не удалось обновить трек в профиле.', 'warning');
    }
  });
}
if(typeof window!=='undefined'){
  setInterval(()=>{const s=usePlayerStore.getState();if(s.isPlaying&&Date.now()-lastHeartbeat>25000)publishPlayback(s.currentTrack,true,true);},30000);
  window.addEventListener('pagehide',()=>{void apiClient.request('/profile/now-playing',{method:'PUT',body:JSON.stringify({trackId:null,sessionId:playbackSession}),keepalive:true}).catch(()=>{});});
}

interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  queueState: QueueState;

  // View UI Panels
  isFullPlayerOpen: boolean;
  isQueueOpen: boolean;
  isLyricsOpen: boolean;

  // My Wave State
  isWaveActive: boolean;
  isStartingWave: boolean;
  isFetchingMoreWave: boolean;
  waveOptions: WaveOptionInput | null;
  /** Persisted «Моя волна» settings (panel); presets from collections don't overwrite them. */
  waveSettings: WaveSettings;
  /** settings — the Резонанс panel; release — the continuation after a release ended. */
  waveKind: 'settings' | 'release' | null;
  /** waiting: no connection or catalogue answer, retrying; empty: the filters leave nothing to play. */
  waveStatus: 'idle' | 'starting' | 'ready' | 'waiting' | 'empty';
  waveMessage: string | null;
  /** The release whose continuation is prepared (null when the queue is not one release). */
  releaseSeed: ReleaseSeed | null;
  /** Where the current queue came from (release:<id>, playlist:<id>, search, mix:<id>, radio, wave, continuation…). */
  playContext: string;

  // Actions
  playTrack: (track: Track, preferredSource?: string) => Promise<void>;
  playCollection: (tracks: Track[], startIndex?: number, preferredSource?: string, context?: string) => Promise<void>;
  playNow: (track: Track) => Promise<void>;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  closeTrack: () => void;
  pause: () => void;
  resume: () => void;
  togglePlay: () => Promise<void> | void;
  /** `blend`: «Волна на двоих» with a friend — both tastes, alternating. */
  startMyWave: (options?: WaveOptionInput, blend?: WaveBlend) => Promise<void>;
  /** The friend of the running «Волна на двоих». */
  waveBlend: WaveBlend | null;
  loadMoreWaveTracks: () => Promise<void>;
  /** Swap the not-yet-played wave tail for a batch that reflects fresh feedback. */
  refreshWaveQueue: () => Promise<void>;
  setWaveSettings: (patch: Partial<WaveSettings>) => void;
  stopWave: () => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (seconds: number) => void;
  setVolume: (val: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  removeFromQueue: (index: number) => void;
  /** Puts back the queue of the last session (paused, at its second); false when something already plays. */
  restoreSession: (tracks: Track[], index: number, position: number) => boolean;
  clearQueue: () => void;

  setFullPlayerOpen: (open: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  setLyricsOpen: (open: boolean) => void;
  isSettingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  // A skip drops the same artist from the upcoming wave tail; two in a row re-steer the whole tail.
  const onWaveSkip=(track:Track)=>{
    recordWaveSkip(track);
    waveSession.skipStreak++;
    const artist=track.artist.name.toLowerCase(),q=queueManager.getState();
    for(let i=q.playbackQueue.length-1;i>q.currentIndex;i--){const t=q.playbackQueue[i];if(waveSession.issued.has(t.id)&&t.artist.name.toLowerCase()===artist)queueManager.removeFromQueue(i);}
    if(waveSession.skipStreak>=2){waveSession.skipStreak=0;setTimeout(()=>{void get().refreshWaveQueue();},0);}
  };

  // Subscribe audioManager events to sync Zustand store
  audioManager.subscribe({
    onTimeUpdate: (cur, dur) => {
      const playingId=get().currentTrack?.id;
      if(playingId){if(waveProgress.id!==playingId)waveProgress={id:playingId,max:0,dur:0};waveProgress.max=Math.max(waveProgress.max,cur);if(dur>0)waveProgress.dur=dur;}
      set({ currentTime: cur, duration: dur });
    },
    onStateChange: (playing, buffering) => {
      set({ isPlaying: playing, isBuffering: buffering });
      if(!buffering)publishPlayback(get().currentTrack,playing);
    },
    onTrackChange: (track) => {
      if(get().currentTrack?.id!==track?.id&&get().isPlaying)publishPlayback(null,false);
      const qState = queueManager.getState();
      const previous=get().currentTrack,previousIndex=get().queueState.currentIndex;
      if(get().isWaveActive&&track&&previous&&previous.id!==track.id){
        // Moving forward before half the track (or 30 s) after it actually started is a skip.
        const progress=waveProgress.id===previous.id?waveProgress:{max:0,dur:0},total=progress.dur||previous.duration||0;
        if(qState.currentIndex===previousIndex+1&&total>0&&progress.max>.5&&progress.max<Math.min(30,total*.5)){onWaveSkip(previous);sendWaveFeedback(previous,'skip',progress.max);}
        else if(progress.max>=Math.min(30,total*.5)){waveSession.skipStreak=0;if(progress.max>=total*.8)waveSession.noteFinished(previous);sendWaveFeedback(previous,'trackFinished',progress.max);}
      }
      if(get().isWaveActive&&track){waveSession.notePlayed(track);queueManager.trimPlayed(WAVE_HISTORY_KEEP);if(previous?.id!==track.id)sendWaveFeedback(track,'trackStarted');}
      set({
        currentTrack: track,
        queueState: queueManager.getState(),
      });

      // Refill ahead of time, so the next batch is there before the queue runs out.
      if (get().isWaveActive) {
        const q = queueManager.getState(), remaining = q.playbackQueue.length - (q.currentIndex + 1);
        if (remaining <= WAVE_REFILL_AT) void get().loadMoreWaveTracks();
      } else if (continuation && track) {
        // Prepare (never start) the continuation while the release's last track plays.
        const q = queueManager.getState();
        if (q.currentIndex === q.playbackQueue.length - 1 && (continuation.autoplay || continuation.seed.trackIds.includes(track.id)) && !continuation.promise) {
          // Autoplay follows what was actually listened to, including tracks added to the queue later.
          if (continuation.autoplay) continuation.seed = queueSeedOf(q.playbackQueue.slice(0, q.currentIndex + 1)) || continuation.seed;
          continuation.promise = fetchReleaseContinuation(continuation.seed, q.playbackQueue.map(t => t.id)).catch(() => [] as Track[]);
        }
      }
    },
    onError: (type, message) => {
      if (type === 'AUTOPLAY_BLOCKED') {
        useToastStore.getState().addToast('Нажмите «Воспроизвести» для запуска', 'info');
      } else {
        useToastStore.getState().addToast(message, 'warning');
      }
    },
  });

  // The queue has nothing after the current track.
  audioManager.setOnNeedMoreTracks(async (reason) => {
    // A shared queue (Jam) ends where it ends for everyone: no wave refill, no autoplay on one device only.
    if (queueHooks.shared?.()) return;
    if (get().isWaveActive) {
      const added = await refillWave();
      if (!added) waveAwaitingTracks = true;
      return;
    }
    // A release continues with music built on it — only after its last track played to the end,
    // never on a manual skip, never while «repeat» is on (then the queue simply loops).
    if (!continuation) return;
    // Autoplay also answers «next» on the last track (like Spotify); a release continues only after its natural end.
    const allowed = continuation.autoplay ? queueManager.getState().repeatMode === 'off' : continuationAllowed(reason, queueManager.getState().repeatMode);
    if (!allowed) { if (reason === 'manual') continuation = null; return; }
    if (continuation.autoplay && !continuation.promise) { const q = queueManager.getState(); continuation.seed = queueSeedOf(q.playbackQueue.slice(0, q.currentIndex + 1)) || continuation.seed; }
    const prepared = continuation, gen = ++waveGeneration;
    continuation = null;
    set({ waveStatus: 'starting', waveMessage: null });
    let tracks = await (prepared.promise || fetchReleaseContinuation(prepared.seed, queueManager.getState().playbackQueue.map(t => t.id)).catch(() => [] as Track[]));
    if (!tracks.length) { await sleep(1500); tracks = await fetchReleaseContinuation(prepared.seed, queueManager.getState().playbackQueue.map(t => t.id)).catch(() => [] as Track[]); }
    if (gen !== waveGeneration) return;
    if (!tracks.length) { set({ waveStatus: 'waiting', waveMessage: tr('Не удалось подобрать продолжение. Проверьте связь и нажмите «Далее».', 'Could not prepare what plays next. Check your connection and press Next.') }); return; }
    waveSession.reset(); waveSession.noteIssued(tracks);
    set({ isWaveActive: true, waveKind: 'release', waveStatus: 'ready', releaseSeed: prepared.seed, playContext: `continuation:${prepared.seed.releaseId}` });
    if (prepared.autoplay) useToastStore.getState().addToast(tr('Очередь закончилась — дальше похожая музыка', 'The queue ended — similar music follows'), 'info', 3000);
    queueManager.appendTracks(tracks);
    set({ queueState: queueManager.getState() });
  });

  /** One refill at a time; stale answers (another session) are dropped; temporary failures retry with backoff. */
  const refillWave = (): Promise<boolean> => {
    if (refillInFlight) return refillInFlight;
    const gen = waveGeneration;
    refillInFlight = (async () => {
      set({ isFetchingMoreWave: true });
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (gen !== waveGeneration || !get().isWaveActive) return false;
          try {
            const queue = queueManager.getState().playbackQueue, exclude = queue.slice(-120).map(t => t.id);
            const seed = get().releaseSeed;
            const batch = get().waveKind === 'release' && seed
              ? { tracks: await fetchReleaseContinuation(seed, exclude), status: 'ok' as const, reason: undefined }
              : await fetchWaveBatch(normalizeWaveSettings(get().waveOptions || get().waveSettings), WAVE_BATCH, exclude, get().waveBlend?.publicId);
            if (gen !== waveGeneration || !get().isWaveActive) return false;
            const known = new Set(queueManager.getState().playbackQueue.map(t => t.id));
            const fresh = batch.tracks.filter(t => !known.has(t.id));
            if (fresh.length) {
              queueManager.appendTracks(fresh);
              waveRetries = 0;
              set({ queueState: queueManager.getState(), waveStatus: 'ready', waveMessage: null });
              if (waveAwaitingTracks) { waveAwaitingTracks = false; void audioManager.next(); }
              return true;
            }
            // The filters leave nothing: say so instead of pretending the music ended.
            if (batch.status === 'empty' && batch.reason !== 'unavailable') {
              const message = emptyWaveMessage(batch.reason, tr);
              if (get().waveStatus !== 'empty') useToastStore.getState().addToast(tr(`Резонанс: подходящая музыка заканчивается. ${message}`, `Resonance is running out of matching music. ${message}`), 'warning', 6000);
              set({ waveStatus: 'empty', waveMessage: message });
              return false;
            }
          } catch { /* Network or server error: retry below. */ }
          await sleep([1500, 4000, 9000][attempt]);
        }
        if (gen === waveGeneration && get().isWaveActive) { if (get().waveStatus !== 'waiting') useToastStore.getState().addToast(tr('Резонанс ждёт связь с каталогом и продолжит сам.', 'Resonance is waiting for the catalogue and will continue by itself.'), 'warning', 5000); set({ waveStatus: 'waiting', waveMessage: tr('Нет ответа от каталога. Резонанс продолжит, как только связь вернётся.', 'The catalogue is not answering. Resonance will continue once the connection is back.') }); scheduleWaveRetry(gen); }
        return false;
      } finally {
        refillInFlight = null;
        set({ isFetchingMoreWave: false });
      }
    })();
    return refillInFlight;
  };
  /** Bounded retries after a failed refill: on reconnect, or after 15 s, 30 s … up to six times. */
  const scheduleWaveRetry = (gen: number) => {
    if (waveRetryTimer || waveRetries >= 6) return;
    waveRetries++;
    const run = () => { clearTimeout(waveRetryTimer); waveRetryTimer = undefined; window.removeEventListener('online', run); if (gen === waveGeneration && get().isWaveActive) void refillWave(); };
    waveRetryTimer = setTimeout(run, Math.min(90_000, 15_000 * waveRetries));
    window.addEventListener('online', run, { once: true });
  };

  /** Any explicit choice of other music ends the wave session; late answers for it are dropped. */
  const leaveWave = () => {
    waveGeneration++; waveAwaitingTracks = false;
    clearTimeout(waveSettingsTimer); clearTimeout(waveRetryTimer); waveRetryTimer = undefined;
    set({ isWaveActive: false, waveKind: null, waveOptions: null, waveStatus: 'idle', waveMessage: null, waveBlend: null });
  };

  return {
    currentTrack: null,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    volume: 0.6,
    isMuted: false,
    shuffle: false,
    repeatMode: 'off',
    queueState: queueManager.getState(),

    isFullPlayerOpen: false,
    isQueueOpen: false,
    isLyricsOpen: false,
    isSettingsOpen: false,

    isWaveActive: false,
    isStartingWave: false,
    isFetchingMoreWave: false,
    waveOptions: null,
    waveSettings: loadWaveSettings(),
    waveKind: null,
    waveStatus: 'idle',
    waveMessage: null,
    releaseSeed: null,
    playContext: '',
    waveBlend: null,

    playTrack: async (track, preferredSource) => {
      leaveWave(); continuation = autoplayFor([track]);
      set({ playContext: 'track' });
      await audioManager.playTrack(track, preferredSource);
      set({ queueState: queueManager.getState() });
    },

    playCollection: async (tracks, startIndex = 0, preferredSource, context) => {
      leaveWave();
      // A release (one album, EP or single) gets a continuation after its natural end; anything else does not.
      const seed = context === 'no-continuation' ? null : releaseSeedOf(tracks);
      continuation = seed ? { seed, promise: null } : context === 'no-continuation' ? null : autoplayFor(tracks);
      set({ releaseSeed: seed, playContext: context && context !== 'no-continuation' ? context : seed ? `release:${seed.releaseId}` : 'collection' });
      await audioManager.playCollection(tracks, startIndex, preferredSource);
      set({ queueState: queueManager.getState() });
    },

    restoreSession: (tracks, index, position) => {
      if (get().currentTrack || !tracks[index]) return false;
      queueManager.setQueue(tracks, index);
      continuation = autoplayFor(tracks);
      audioManager.cueTrack(tracks[index], position);
      set({ queueState: queueManager.getState(), playContext: 'restored' });
      return true;
    },

    playNow: async (track) => {
      if (queueHooks.add?.(track, 'now')) return;
      leaveWave(); continuation = autoplayFor([...queueManager.getState().playbackQueue, track]);
      await audioManager.playNow(track);
      set({ queueState: queueManager.getState() });
      useToastStore.getState().addToast('Воспроизводится сейчас', 'success');
    },

    playNext: (track) => {
      if (queueHooks.add?.(track, 'next')) return;
      audioManager.playNextTrackInQueue(track);
      trackEvent('queue_add', track, 'queue', get().playContext, { to: (queueManager.getState().currentIndex + 1) });
      set({ queueState: queueManager.getState() });
      useToastStore.getState().addToast('Добавлено "Играть следующим"', 'info');
    },

    addToQueue: (track) => {
      if (queueHooks.add?.(track, 'end')) return;
      audioManager.addToQueue(track);
      trackEvent('queue_add', track, 'queue', get().playContext, { to: queueManager.getState().playbackQueue.length - 1 });
      set({ queueState: queueManager.getState() });
      useToastStore.getState().addToast('Добавлено в очередь', 'info');
    },

    closeTrack: () => {
      leaveWave(); continuation = null;
      set({isFullPlayerOpen:false,isQueueOpen:false});
      audioManager.closeTrack();
    },

    pause: () => {
      audioManager.pause();
    },

    resume: () => {
      audioManager.resume();
    },

    startMyWave: async (options, blend) => {
      const state = get();
      if (state.isStartingWave) return;
      const gen = ++waveGeneration;
      continuation = null;
      set({ isStartingWave: true, waveStatus: 'starting', waveMessage: null });
      try {
        // A preset is a one-off wave; no options = the saved panel settings.
        const settings = options ? normalizeWaveSettings(options, state.waveSettings) : state.waveSettings;
        waveSession.reset();
        let batch: Awaited<ReturnType<typeof fetchWaveBatch>> | null = null;
        for (let attempt = 0; attempt < 3 && !batch; attempt++) {
          try { batch = await fetchWaveBatch(settings, WAVE_BATCH, [], blend?.publicId); }
          catch (e) {
            // Not friends (any more): retrying will not help.
            if (e instanceof ApiError && e.status === 403) { set({ waveStatus: 'idle', waveMessage: null }); useToastStore.getState().addToast(e.message, 'warning'); return; }
            if (attempt < 2) await sleep([1200, 3500][attempt]);
          }
          if (gen !== waveGeneration) return;
        }
        if (!batch) { set({ waveStatus: 'waiting', waveMessage: tr('Каталог не отвечает. Проверьте связь и попробуйте ещё раз.', 'The catalogue is not answering. Check your connection and try again.') }); useToastStore.getState().addToast(get().waveMessage!, 'warning'); return; }
        if (!batch.tracks.length) {
          // Strict filters are never loosened silently: explain and leave the current music alone.
          const message = emptyWaveMessage(batch.reason, tr);
          set({ waveStatus: 'empty', waveMessage: message });
          useToastStore.getState().addToast(message, 'warning', 5000);
          return;
        }
        set({ isWaveActive: true, waveKind: 'settings', waveOptions: options ? { ...settings } : null, releaseSeed: null, waveStatus: 'ready', waveMessage: null, playContext: blend ? `wave:blend:${blend.publicId}` : 'wave', waveBlend: blend ? (batch.blend || blend) : null });
        waveAwaitingTracks = false; waveRetries = 0;
        apiClient.prefetchTrack(batch.tracks[0].id).catch(() => {});
        await audioManager.playCollection(batch.tracks, 0);
        set({ queueState: queueManager.getState() });
        if (batch.repeating) useToastStore.getState().addToast(tr('Подходящие треки коллекции закончились — повторяем самые давние.', 'Matching collection tracks ran out — replaying the oldest.'), 'info', 3500);
        else if (blend) useToastStore.getState().addToast(tr(`Волна на двоих: вы и ${get().waveBlend?.name || blend.name}`, `Wave for two: you and ${get().waveBlend?.name || blend.name}`), 'success', 2500);
        else useToastStore.getState().addToast(tr('«Резонанс» включён', 'Resonance is on'), 'success', 2000);
      } finally {
        set({ isStartingWave: false });
      }
    },

    loadMoreWaveTracks: async () => { await refillWave(); },

    refreshWaveQueue: async () => {
      const state = get();
      if (!state.isWaveActive || state.waveKind !== 'settings') return;
      // Swap the not-yet-played wave tail (keeping the very next track, which may be prefetched, and anything queued by hand).
      const q = queueManager.getState(), next = q.playbackQueue[q.currentIndex + 1]?.id;
      queueManager.dropUpcoming(t => t.id !== next && waveSession.issued.has(t.id));
      set({ queueState: queueManager.getState() });
      await refillWave();
    },

    setWaveSettings: (patch) => {
      const settings = normalizeWaveSettings({ ...get().waveSettings, ...patch, perLanguage: { ...get().waveSettings.perLanguage, ...(patch.perLanguage || {}) } }, get().waveSettings);
      saveWaveSettings(settings);
      set({ waveSettings: settings, waveOptions: null, waveStatus: get().waveStatus === 'empty' ? 'idle' : get().waveStatus, waveMessage: get().waveStatus === 'empty' ? null : get().waveMessage });
      // A running wave follows the new settings once the user stops clicking: the current track keeps playing,
      // only the upcoming wave tracks are replaced; answers for the old settings are discarded.
      if (!get().isWaveActive || get().waveKind !== 'settings') return;
      waveGeneration++;
      clearTimeout(waveSettingsTimer);
      waveSettingsTimer = setTimeout(() => {
        if (!get().isWaveActive) return;
        waveSession.batch = 0;
        queueManager.dropUpcoming(t => waveSession.issued.has(t.id));
        set({ queueState: queueManager.getState() });
        void refillWave();
      }, 700);
    },

    stopWave: () => {
      leaveWave();
    },

    togglePlay: async () => {
      const { currentTrack } = get();
      if (!currentTrack) {
        // When no track is active, automatically start My Wave!
        await get().startMyWave();
        return;
      }
      audioManager.togglePlay();
    },

    next: async () => {
      if (get().isWaveActive) {
        const qState = queueManager.getState();
        const remaining = qState.playbackQueue.length - (qState.currentIndex + 1);
        if (remaining <= 3) void refillWave();
      }
      await audioManager.next('manual');
      set({ queueState: queueManager.getState() });
    },

    previous: async () => {
      await audioManager.previous();
      set({ queueState: queueManager.getState() });
    },

    seek: (seconds) => {
      audioManager.seek(seconds);
    },

    setVolume: (val) => {
      audioManager.setVolume(val);
      set({ volume: val });
    },

    toggleMute: () => {
      const muted = audioManager.toggleMute();
      set({ isMuted: muted });
    },

    toggleShuffle: () => {
      const shuf = audioManager.toggleShuffle();
      set({ shuffle: shuf, queueState: queueManager.getState() });
      useToastStore.getState().addToast(shuf ? tr('Перемешивание включено', 'Shuffle on') : tr('Перемешивание выключено', 'Shuffle off'), 'info');
    },

    setRepeatMode: (mode) => {
      audioManager.setRepeatMode(mode);
      set({ repeatMode: mode, queueState: queueManager.getState() });
      const labels: Record<RepeatMode, string> = {
        off: tr('Повтор выключен', 'Repeat off'),
        all: tr('Повтор всех треков', 'Repeat all'),
        one: tr('Повтор одного трека', 'Repeat one'),
      };
      useToastStore.getState().addToast(labels[mode], 'info');
    },

    removeFromQueue: (index) => {
      trackEvent('queue_remove', queueManager.getState().playbackQueue[index], 'queue', get().playContext, { from: index });
      queueManager.removeFromQueue(index);
      set({ queueState: queueManager.getState() });
    },

    clearQueue: () => {
      queueManager.clearQueue();
      set({ queueState: queueManager.getState() });
    },

    setFullPlayerOpen: (open) => set({ isFullPlayerOpen: open }),
    setQueueOpen: (open) => set({ isQueueOpen: open, isLyricsOpen: open ? false : get().isLyricsOpen }),
    setLyricsOpen: (open) => set({ isLyricsOpen: open, isQueueOpen: open ? false : get().isQueueOpen }),
    setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  };
});

// A like during the wave re-steers the upcoming tail toward that track's neighbours.
useLibraryStore.subscribe((library, previous) => {
  const player = usePlayerStore.getState(), track = player.currentTrack;
  if (!player.isWaveActive || !track || library.likedTrackIds === previous.likedTrackIds) return;
  if (library.likedTrackIds.has(track.id) && !previous.likedTrackIds.has(track.id)) {
    waveSession.noteLiked(track);
    sendWaveFeedback(track, 'like');
    waveSession.skipStreak = 0;
    void player.refreshWaveQueue();
  }
});

// Development builds only: lets QA scripts inspect the queue and wave state from the console.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __oskolokPlayer?: typeof usePlayerStore }).__oskolokPlayer = usePlayerStore;
