import React from 'react';
import { useAudioLevels, type AudioLevels } from '../../audio/audioLevels.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';

// viewBox 400×48, baseline y=24. The line runs from x=10 to x=390.
const X0 = 10, X1 = 390, POINTS = 64, MID = 24;
const f = (n: number) => n.toFixed(1);

/** The resting heartbeat as smooth bumps (dip, peak, dip, settle) so it can blend into the live wave. */
const BUMPS: Array<[x: number, height: number, width: number]> = [[170, 6, 7], [190, -24, 8], [213, 25, 8], [234, -12, 7], [251, 5, 6]];
const heart = (x: number) => BUMPS.reduce((y, [cx, h, w]) => y + h * Math.exp(-((x - cx) ** 2) / (2 * w * w)), 0);

/** Four travelling components, low → high; all drift the same way so the line flows instead of wriggling. */
const PARTIALS: Array<[cycles: number, weight: number, speed: number]> = [[1.6, 1, .8], [2.7, .62, 1.25], [4.3, .38, 1.9], [6.8, .22, 2.7]];

function catmullRom(points: Array<[number, number]>) {
  let d = `M ${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    d += ` C ${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)}, ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

type State = { amp: number; parts: number[]; heart: number; phase: number[]; last: number };

function buildPath(s: State) {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < POINTS; i++) {
    const u = i / (POINTS - 1), x = X0 + (X1 - X0) * u;
    // Hann-like window: silent at both ends, fullest in the middle.
    const win = Math.pow(Math.sin(Math.PI * u), 1.6);
    let wave = 0;
    PARTIALS.forEach(([cycles, weight], k) => { wave += weight * s.parts[k] * Math.sin(2 * Math.PI * cycles * u - s.phase[k]); });
    points.push([x, MID + s.heart * heart(x) + win * s.amp * 21 * wave]);
  }
  return catmullRom(points);
}

const IDLE_D = buildPath({ amp: 0, parts: [0, 0, 0, 0], heart: 1, phase: [0, 0, 0, 0], last: 0 });

/** Home hero line: the original heartbeat at rest; while music plays it eases into a calm
 * waveform whose height follows the loudness and whose texture follows the spectrum. */
export function CenterPulseWave({ isPlaying, isDark, emphasized }: { isPlaying: boolean; isDark: boolean; emphasized: boolean }) {
  const pathRef = React.useRef<SVGPathElement>(null);
  const state = React.useRef<State>({ amp: 0, parts: [0, 0, 0, 0], heart: 1, phase: [0, 0, 0, 0], last: 0 });

  useAudioLevels((l: AudioLevels) => {
    const s = state.current, path = pathRef.current, now = performance.now();
    const dt = s.last ? Math.min(.1, (now - s.last) / 1000) : 1 / 60; s.last = now;
    const playing = usePlayerStore.getState().isPlaying;
    // Loudness drives height: quick to rise, slow to fall, so it breathes rather than flickers.
    const target = Math.min(1, l.level * 1.9 + l.bass * .5 + l.beat * .18);
    s.amp += (target - s.amp) * (1 - Math.exp(-dt / (target > s.amp ? .07 : .32)));
    const B = l.bands;
    [(B[0] + B[1]) / 2, (B[2] + B[3]) / 2, (B[4] + B[5]) / 2, (B[6] + B[7]) / 2].forEach((v, k) => { s.parts[k] += (Math.min(1, v * 1.4) - s.parts[k]) * (1 - Math.exp(-dt / .18)); });
    PARTIALS.forEach(([, , speed], k) => { s.phase[k] += dt * speed * (.6 + s.amp * .8); });
    s.heart += ((playing ? 0 : 1) - s.heart) * (1 - Math.exp(-dt / .35));
    if (l.level === 0 && l.beat === 0 && !playing) { s.amp = 0; s.parts.fill(0); s.heart = 1; s.last = 0; }
    if (!path) return;
    path.setAttribute('d', buildPath(s));
    const glow = Math.min(1, s.amp);
    path.setAttribute('stroke-width', f((isDark ? 1.5 : 1.3) + glow * .5));
    path.style.filter = isDark ? `drop-shadow(0 0 ${f(6 + glow * 4)}px rgba(56,189,248,${(.6 + glow * .25).toFixed(2)})) drop-shadow(0 0 ${f(14 + glow * 6)}px rgba(37,99,235,.45))` : `drop-shadow(0 0 ${f(glow * 4)}px rgba(37,99,235,${(glow * .35).toFixed(2)}))`;
  });

  return <svg viewBox="0 0 400 48" className="original-center-wave w-full h-12 overflow-visible pointer-events-none" aria-hidden="true">
    <defs>
      <linearGradient id="centerPulseGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity="0.0" />
        <stop offset="25%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity={isDark ? '0.6' : '0.35'} />
        <stop offset="50%" stopColor={isDark ? '#60a5fa' : '#1d4ed8'} stopOpacity={isDark ? '1.0' : '0.85'} />
        <stop offset="75%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity={isDark ? '0.6' : '0.35'} />
        <stop offset="100%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity="0.0" />
      </linearGradient>
    </defs>
    <path ref={pathRef} d={IDLE_D} fill="none" stroke="url(#centerPulseGrad)" strokeLinecap="round" strokeLinejoin="round"
      strokeWidth={emphasized || isPlaying ? (isDark ? 1.9 : 1.6) : (isDark ? 1.5 : 1.3)}
      style={{ filter: isDark ? 'drop-shadow(0 0 8px rgba(56,189,248,0.85)) drop-shadow(0 0 16px rgba(37,99,235,0.6))' : undefined, transition: 'stroke-width .4s ease' }} />
  </svg>;
}
