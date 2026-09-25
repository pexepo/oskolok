import { create } from 'zustand';
import { Track, RepeatMode } from '../types/index.js';
import { audioManager } from '../audio/AudioManager.js';
import { queueManager, QueueState } from '../audio/QueueManager.js';
import { useToastStore } from './useToastStore.js';
import { apiClient } from '../api/apiClient.js';
import {useTelegramStore} from '../telegram/runtime.js';

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
      useToastStore.getState().addToast(error instanceof Error?`Не удалось обновить трек в профиле: ${error.message}`:'Не удалось обновить трек в профиле.', 'warning');
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
  waveOptions: { mood?: string; character?: string; language?: string } | null;

  // Actions
  playTrack: (track: Track, preferredSource?: string) => Promise<void>;
  playCollection: (tracks: Track[], startIndex?: number, preferredSource?: string) => Promise<void>;
  playNow: (track: Track) => Promise<void>;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  pause: () => void;
  resume: () => void;
  togglePlay: () => Promise<void> | void;
  startMyWave: (options?: { mood?: string; character?: string; language?: string }) => Promise<void>;
  loadMoreWaveTracks: () => Promise<void>;
  stopWave: () => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (seconds: number) => void;
  setVolume: (val: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;

  setFullPlayerOpen: (open: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  setLyricsOpen: (open: boolean) => void;
  isSettingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  // Subscribe audioManager events to sync Zustand store
  audioManager.subscribe({
    onTimeUpdate: (cur, dur) => {
      set({ currentTime: cur, duration: dur });
    },
    onStateChange: (playing, buffering) => {
      set({ isPlaying: playing, isBuffering: buffering });
      if(!buffering)publishPlayback(get().currentTrack,playing);
    },
    onTrackChange: (track) => {
      if(get().currentTrack?.id!==track?.id&&get().isPlaying)publishPlayback(null,false);
      const qState = queueManager.getState();
      set({
        currentTrack: track,
        queueState: qState,
      });

      // If My Wave is active and we are near the end of queue, auto-load more tracks
      if (get().isWaveActive) {
        const remaining = qState.playbackQueue.length - (qState.currentIndex + 1);
        if (remaining <= 5) {
          get().loadMoreWaveTracks().catch(() => {});
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

  // Connect AudioManager request for more tracks when hitting end of queue
  audioManager.setOnNeedMoreTracks(async () => {
    if (get().isWaveActive) {
      await get().loadMoreWaveTracks();
    }
  });

  return {
    currentTrack: null,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
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

    playTrack: async (track, preferredSource) => {
      set({ isWaveActive: false, waveOptions: null });
      await audioManager.playTrack(track, preferredSource);
      set({ queueState: queueManager.getState() });
    },

    playCollection: async (tracks, startIndex = 0, preferredSource) => {
      set({ isWaveActive: false, waveOptions: null });
      await audioManager.playCollection(tracks, startIndex, preferredSource);
      set({ queueState: queueManager.getState() });
    },

    playNow: async (track) => {
      set({ isWaveActive: false, waveOptions: null });
      await audioManager.playNow(track);
      set({ queueState: queueManager.getState() });
      useToastStore.getState().addToast('Воспроизводится сейчас', 'success');
    },

    playNext: (track) => {
      audioManager.playNextTrackInQueue(track);
      set({ queueState: queueManager.getState() });
      useToastStore.getState().addToast('Добавлено "Играть следующим"', 'info');
    },

    addToQueue: (track) => {
      audioManager.addToQueue(track);
      set({ queueState: queueManager.getState() });
      useToastStore.getState().addToast('Добавлено в очередь', 'info');
    },

    pause: () => {
      audioManager.pause();
    },

    resume: () => {
      audioManager.resume();
    },

    startMyWave: async (options) => {
      const state = get();
      if (state.isStartingWave) return;
      set({ isStartingWave: true });

      try {
        const mood = options?.mood || 'energetic';
        const character = options?.character || 'popular';
        const language = options?.language || 'all';
        set({ waveOptions: { mood, character, language } });

        let tracks = await apiClient.getRecommendations({ limit: 25, mood, character, language });
        if (!tracks || tracks.length === 0) {
          const fallback = await apiClient.search('top hits chart', 1, 25);
          tracks = fallback.tracks;
        }

        if (tracks && tracks.length > 0) {
          set({ isWaveActive: true });
          if (tracks[0]?.id) apiClient.prefetchTrack(tracks[0].id).catch(() => {});
          if (tracks[1]?.id) apiClient.prefetchTrack(tracks[1].id).catch(() => {});

          await audioManager.playCollection(tracks, 0);
          set({ queueState: queueManager.getState() });
          useToastStore.getState().addToast('«Моя волна» включена', 'success', 2000);
        } else {
          useToastStore.getState().addToast('Не удалось загрузить Мою волну', 'warning');
        }
      } catch {
        useToastStore.getState().addToast('Не удалось запустить Мою волну', 'error');
      } finally {
        set({ isStartingWave: false });
      }
    },

    loadMoreWaveTracks: async () => {
      const state = get();
      if (!state.isWaveActive || state.isFetchingMoreWave) return;
      set({ isFetchingMoreWave: true });

      try {
        const currentQ = queueManager.getState().playbackQueue;
        const recentIds = currentQ.slice(-50).map((t) => t.id);
        const options = state.waveOptions || { mood: 'energetic', character: 'popular', language: 'all' };

        const newTracks = await apiClient.getRecommendations({
          limit: 20,
          mood: options.mood,
          character: options.character,
          language: options.language,
          excludeTrackIds: recentIds,
        });

        if (newTracks && newTracks.length > 0) {
          queueManager.appendTracks(newTracks);
          set({ queueState: queueManager.getState() });
        }
      } catch (err) {
        console.warn('Failed to load more wave tracks:', err);
      } finally {
        set({ isFetchingMoreWave: false });
      }
    },

    stopWave: () => {
      set({ isWaveActive: false, waveOptions: null });
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
        if (remaining <= 3) {
          get().loadMoreWaveTracks().catch(() => {});
        }
      }
      await audioManager.next();
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
      useToastStore.getState().addToast(shuf ? 'Перемешивание включено' : 'Перемешивание выключено', 'info');
    },

    setRepeatMode: (mode) => {
      audioManager.setRepeatMode(mode);
      set({ repeatMode: mode, queueState: queueManager.getState() });
      const labels: Record<RepeatMode, string> = {
        off: 'Повтор выключен',
        all: 'Повтор всех треков',
        one: 'Повтор одного трека',
      };
      useToastStore.getState().addToast(labels[mode], 'info');
    },

    removeFromQueue: (index) => {
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
