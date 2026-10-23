import { useEffect, useRef } from 'react';
import { audioManager } from './AudioManager.js';
import { usePlayerStore } from '../stores/usePlayerStore.js';

/** Smoothed 0..1 levels of what is playing right now. */
export interface AudioLevels {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  /** Short kick envelope: jumps on bass onsets and decays. */
  beat: number;
  /** BAND_COUNT log-spaced bands, low → high. */
  bands: Float32Array;
  /** true when driven by the real analyser, false for the synthetic envelope. */
  live: boolean;
}
export const BAND_COUNT = 8;

type Listener = (levels: AudioLevels) => void;
const listeners = new Set<Listener>();
const levels: AudioLevels = { level: 0, bass: 0, mid: 0, treble: 0, beat: 0, bands: new Float32Array(BAND_COUNT), live: false };
const target = new Float32Array(BAND_COUNT);
let bins: Uint8Array<ArrayBuffer> | null = null;
let frame = 0, last = 0, silentMs = 0, slowBass = 0;
const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Log-spaced bin edges from ~90 Hz up to ~11 kHz for a 512-point FFT at 44.1–48 kHz. */
function edges(count: number) {
  const lo = 1, hi = Math.min(count - 1, 120), out: number[] = [];
  for (let i = 0; i <= BAND_COUNT; i++) out.push(Math.round(lo * Math.pow(hi / lo, i / BAND_COUNT)));
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1;
  return out;
}
let bandEdges: number[] = [];

function readAnalyser(analyser: AnalyserNode): boolean {
  if (!bins || bins.length !== analyser.frequencyBinCount) { bins = new Uint8Array(analyser.frequencyBinCount); bandEdges = edges(bins.length); }
  analyser.getByteFrequencyData(bins);
  let total = 0;
  for (let b = 0; b < BAND_COUNT; b++) {
    let sum = 0; const from = bandEdges[b], to = bandEdges[b + 1];
    for (let i = from; i < to; i++) sum += bins[i];
    const v = sum / Math.max(1, to - from) / 255;
    // Gentle curve so quiet masters still move and loud ones do not pin at 1.
    target[b] = Math.min(1, Math.pow(v, 1.35) * 1.25);
    total += v;
  }
  return total > 0.02;
}

/** Plausible movement from the playback clock for Spotify, tainted media or WebViews without Web Audio. */
function synthesize(t: number) {
  const phase = (t * 2) % 1, kick = Math.exp(-phase * 7);
  for (let b = 0; b < BAND_COUNT; b++) {
    const k = b / (BAND_COUNT - 1);
    const drift = .5 + .5 * Math.sin(t * (1.1 + k * 2.3) + b * 1.7);
    target[b] = Math.min(1, (1 - k) * (.28 + kick * .5) + k * (.16 + drift * .22) + Math.sin(t * 3.1 + b) * .04);
  }
}

function tick(now: number) {
  const dt = last ? Math.min(now - last, 100) : 16; last = now;
  const playing = usePlayerStore.getState().isPlaying && !document.hidden;
  let live = false;
  if (playing) {
    const analyser = audioManager.getAnalyser();
    if (analyser && readAnalyser(analyser)) { silentMs = 0; live = true; }
    // Short silences (gaps, quiet intros) just settle; an analyser that stays silent
    // (tainted media, muted route) or no analyser at all hands over to the envelope.
    else if (!analyser || (silentMs += dt) > 1500) synthesize(audioManager.getSmoothTime());
  } else { target.fill(0); silentMs = 0; }

  const attack = 1 - Math.pow(.5, dt / 28), release = 1 - Math.pow(.5, dt / 120);
  let sum = 0;
  for (let b = 0; b < BAND_COUNT; b++) {
    const cur = levels.bands[b], to = target[b];
    levels.bands[b] = cur + (to - cur) * (to > cur ? attack : release);
    sum += levels.bands[b];
  }
  const B = levels.bands;
  levels.bass = (B[0] + B[1] + B[2]) / 3;
  levels.mid = (B[3] + B[4] + B[5]) / 3;
  levels.treble = (B[6] + B[7]) / 2;
  levels.level = sum / BAND_COUNT;
  levels.live = live;
  slowBass += (levels.bass - slowBass) * (1 - Math.pow(.5, dt / 450));
  const onset = Math.max(0, Math.min(1, (levels.bass - slowBass) * 4.5));
  levels.beat = Math.max(onset, levels.beat * Math.pow(.5, dt / 140));

  listeners.forEach(fn => fn(levels));
  frame = (playing || levels.level > .003 || levels.beat > .003) && listeners.size ? requestAnimationFrame(tick) : 0;
  if (!frame) { last = 0; levels.bands.fill(0); levels.level = levels.bass = levels.mid = levels.treble = levels.beat = 0; listeners.forEach(fn => fn(levels)); }
}

function wake() {
  // Economy mode: visualisers stay still rather than spend a frame loop.
  if (frame || !listeners.size || reduced?.matches || document.documentElement.dataset.perf === 'lite') return;
  last = 0; frame = requestAnimationFrame(tick);
}

usePlayerStore.subscribe((state, prev) => { if (state.isPlaying !== prev.isPlaying) wake(); });
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);

export function subscribeAudioLevels(fn: Listener): () => void {
  listeners.add(fn);
  wake();
  return () => {
    listeners.delete(fn);
    if (!listeners.size && frame) { cancelAnimationFrame(frame); frame = 0; last = 0; }
  };
}

/** Calls onFrame with live levels on every animation frame while music plays (and once at rest). */
export function useAudioLevels(onFrame: Listener, enabled = true) {
  const ref = useRef(onFrame);
  ref.current = onFrame;
  useEffect(() => enabled ? subscribeAudioLevels(l => ref.current(l)) : undefined, [enabled]);
}
