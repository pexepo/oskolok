import {create} from 'zustand';
import {audioManager} from './AudioManager.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {useToastStore} from '../stores/useToastStore.js';
import {tr} from '../stores/useLanguageStore.js';
import {fadeGainAt} from './retention.js';
export {fadeGainAt,formatRemaining} from './retention.js';

/** Sleep timer: after N minutes the music fades out over the last seconds and pauses, or it stops when the track ends. */
export const SLEEP_PRESETS = [15, 30, 45, 60, 90] as const;
interface SleepState { endsAt: number | null; endOfTrack: boolean; minutes: number | null }
export const useSleepTimer = create<SleepState>(() => ({endsAt: null, endOfTrack: false, minutes: null}));

let ticker: ReturnType<typeof setInterval> | undefined;
function clearRuntime() {
  clearInterval(ticker); ticker = undefined;
  audioManager.setFadeGain(1);
  audioManager.stopAfterCurrent = null;
}
function finish() {
  usePlayerStore.getState().pause();
  clearRuntime();
  useSleepTimer.setState({endsAt: null, endOfTrack: false, minutes: null});
  useToastStore.getState().addToast(tr('Таймер сна: музыка остановлена. Спокойной ночи.', 'Sleep timer: music stopped. Good night.'), 'info', 5000);
}

export function startSleepTimer(minutes: number) {
  clearRuntime();
  const endsAt = Date.now() + minutes * 60_000;
  useSleepTimer.setState({endsAt, endOfTrack: false, minutes});
  ticker = setInterval(() => {
    const remaining = (endsAt - Date.now()) / 1000;
    if (remaining <= 0) { finish(); return; }
    // The fade only runs while music plays; a paused player keeps its volume for the listener's return.
    audioManager.setFadeGain(usePlayerStore.getState().isPlaying ? fadeGainAt(remaining) : 1);
  }, 250);
}
export function startEndOfTrackTimer() {
  clearRuntime();
  useSleepTimer.setState({endsAt: null, endOfTrack: true, minutes: null});
  audioManager.stopAfterCurrent = finish;
}
export function cancelSleepTimer() {
  clearRuntime();
  useSleepTimer.setState({endsAt: null, endOfTrack: false, minutes: null});
}
export const sleepTimerActive = (s: SleepState) => s.endsAt !== null || s.endOfTrack;
