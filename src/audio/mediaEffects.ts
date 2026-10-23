/** Player-wide sound settings: speed (with or without keeping the pitch), pitch in semitones, reverb amount. */
export interface MediaEffects { speed: number; preservePitch: boolean; pitch: number; reverb: number }
/** Quick choices; the media element plays 0.5×–2× in every engine we ship (Chromium, WebKit, Android WebView). */
export const SPEED_PRESETS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 2] as const;
export const DEFAULT_EFFECTS: MediaEffects = { speed: 1, preservePitch: true, pitch: 0, reverb: 0 };
const clamp = (v: unknown, min: number, max: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
export function normalizeEffects(value: unknown): MediaEffects {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<MediaEffects>;
  return {
    speed: Math.round(clamp(v.speed, 0.5, 2, 1) * 100) / 100,
    preservePitch: v.preservePitch !== false,
    pitch: Math.round(clamp(v.pitch, -6, 6, 0)),
    reverb: Math.round(clamp(v.reverb, 0, 1, 0) * 100) / 100,
  };
}
/** Semitones to a playback-rate ratio. */
export const pitchRatio = (semitones: number) => 2 ** (semitones / 12);

/** A synthetic hall: stereo noise with an exponential tail, so no impulse file has to be downloaded. */
export function reverbImpulse(context: BaseAudioContext, seconds = 2.4, decay = 3.2): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds), impulse = context.createBuffer(2, length, context.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return impulse;
}
