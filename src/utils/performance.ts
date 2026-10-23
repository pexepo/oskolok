// How much visual effect this device can afford. «auto» reads the hardware once and, if needed, a short frame-rate
// sample; the chosen level is an attribute on <html>, so CSS and components switch effects off by the same switch.
import { create } from 'zustand';

export type PerfMode = 'auto' | 'full' | 'balanced' | 'lite';
export type PerfLevel = Exclude<PerfMode, 'auto'>;
const MODE_KEY = 'oskolok_perf_mode', ADVICE_KEY = 'oskolok_perf_advice';

export interface DeviceInfo { memory?: number; cores?: number; saveData: boolean; reducedMotion: boolean; phone: boolean }
export function readDevice(): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    memory: nav.deviceMemory, cores: nav.hardwareConcurrency || undefined,
    saveData: !!nav.connection?.saveData,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    phone: matchMedia('(pointer: coarse)').matches,
  };
}
/** Level suggested by the hardware alone. */
export function levelFor(d: DeviceInfo): PerfLevel {
  if (d.saveData || (d.memory !== undefined && d.memory <= 2) || (d.cores !== undefined && d.cores <= 2)) return 'lite';
  // Phones: stacked backdrop blurs and floating shards cost more than they give on a small screen (iOS hides memory, so cores alone looked «full»).
  if (d.reducedMotion || d.phone) return 'balanced';
  return 'full';
}
const order: PerfLevel[] = ['lite', 'balanced', 'full'];
export const lower = (a: PerfLevel, b: PerfLevel): PerfLevel => order[Math.min(order.indexOf(a), order.indexOf(b))];

const savedMode = (): PerfMode => { try { const v = localStorage.getItem(MODE_KEY); return v === 'full' || v === 'balanced' || v === 'lite' ? v : 'auto'; } catch { return 'auto'; } };

interface PerfState { mode: PerfMode; level: PerfLevel; detected: PerfLevel; measuredFps?: number; advice: PerfLevel | null; setMode(mode: PerfMode): void; dismissAdvice(): void }
export const usePerformance = create<PerfState>((set, get) => ({
  mode: 'auto', level: 'full', detected: 'full', advice: null,
  setMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode); localStorage.setItem(ADVICE_KEY, 'shown'); } catch { /* private mode */ }
    const level = mode === 'auto' ? get().detected : mode;
    apply(level); set({ mode, level, advice: null });
  },
  dismissAdvice() { try { localStorage.setItem(ADVICE_KEY, 'shown'); } catch { /* private mode */ } set({ advice: null }); },
}));

function apply(level: PerfLevel) { document.documentElement.dataset.perf = level; }
export const perfLevel = () => usePerformance.getState().level;

/** Median frame time over ~1.5 s of idle frames. */
function sampleFps(): Promise<number> {
  return new Promise(resolve => {
    const times: number[] = []; let last = 0;
    const tick = (now: number) => {
      if (last) times.push(now - last);
      last = now;
      if (times.length < 90 && !document.hidden) requestAnimationFrame(tick);
      else { const sorted = times.sort((a, b) => a - b); resolve(sorted.length ? 1000 / sorted[Math.floor(sorted.length / 2)] : 60); }
    };
    requestAnimationFrame(tick);
  });
}

/** Run once before the first render. */
export function initPerformance() {
  const mode = savedMode(), detected = levelFor(readDevice());
  const level = mode === 'auto' ? detected : mode;
  apply(level);
  usePerformance.setState({ mode, detected, level });
  // After the first screen settles, check how the device really copes; a struggling one gets one suggestion.
  setTimeout(() => void sampleFps().then(fps => {
    const measured: PerfLevel = fps < 30 ? 'lite' : fps < 45 ? 'balanced' : 'full';
    const best = lower(detected, measured), state = usePerformance.getState();
    let shown = false; try { shown = localStorage.getItem(ADVICE_KEY) === 'shown'; } catch { /* private mode */ }
    usePerformance.setState({ detected: best, measuredFps: Math.round(fps) });
    if (state.mode === 'auto') { apply(best); usePerformance.setState({ level: best }); }
    // Advice only when the frame rate is worse than the hardware promised; a phone's lighter default is no news.
    if (!shown && best !== detected && best !== 'full' && state.mode !== 'lite' && (state.mode === 'auto' || state.mode === 'full')) usePerformance.setState({ advice: best });
  }), 4000);
}
