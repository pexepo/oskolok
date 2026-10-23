import React, { useEffect, useRef } from 'react';
import { useThemeStore } from '../../stores/useThemeStore.js';

// Deterministic PRNG so the sky does not reshuffle on every resize.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Thin four-point flare, the same motif as the twinkling DOM sparkles. */
function flare(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rgb: string, alpha: number) {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 0.9);
  halo.addColorStop(0, `rgba(${rgb},${alpha})`);
  halo.addColorStop(0.18, `rgba(${rgb},${alpha * 0.35})`);
  halo.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(x - size, y - size, size * 2, size * 2);
  for (const [dx, dy, len] of [[1, 0, size * 2.4], [0, 1, size * 1.6]] as const) {
    const g = ctx.createLinearGradient(x - dx * len, y - dy * len, x + dx * len, y + dy * len);
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(0.5, `rgba(${rgb},${alpha})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    if (dx) ctx.fillRect(x - len, y - 0.6, len * 2, 1.2);
    else ctx.fillRect(x - 0.6, y - len, 1.2, len * 2);
  }
}

/** Soft marbled ribbon (the swirling ink at the corners of the reference art). */
function ribbon(ctx: CanvasRenderingContext2D, pts: number[], rgb: string, width: number, alpha: number) {
  for (let pass = 0; pass < 6; pass++) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    ctx.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]);
    ctx.strokeStyle = `rgba(${rgb},${alpha * (pass + 1) / 6})`;
    ctx.lineWidth = width * (1 - pass / 6.5);
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function paintSky(canvas: HTMLCanvasElement, dark: boolean) {
  const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.5 : 2);
  const w = window.innerWidth, h = Math.max(window.innerHeight, window.screen?.height || 0);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const rand = mulberry32(0x05c010c);

  // Two broad ink washes stay at the outer corners only; the bright edge
  // ribbons are replaced by the constellation threads below.
  const ink = dark ? '70,130,255' : '86,140,214';
  const ice = dark ? '160,215,255' : '120,170,230';
  const a = dark ? 0.045 : 0.03;
  ribbon(ctx, [-w * .05, h * .18, w * .14, h * .02, w * .22, h * .3, w * .02, h * .46], ink, 140, a);
  ribbon(ctx, [w * 1.05, h * .74, w * .9, h * .66, w * .82, h * .96, w * .64, h * 1.04], ink, 150, a);

  // Dust: many faint points, a few brighter ones with a halo.
  const count = Math.round((w * h) / (dark ? 3200 : 5200));
  for (let i = 0; i < count; i++) {
    const x = rand() * w, y = rand() * h, r = rand();
    const size = r < 0.93 ? 0.35 + rand() * 0.5 : 0.9 + rand() * 0.7;
    const alpha = dark ? 0.14 + rand() * (r < 0.93 ? 0.36 : 0.6) : 0.1 + rand() * 0.22;
    ctx.fillStyle = `rgba(${rand() < 0.3 ? ice : dark ? '235,242,255' : '60,100,160'},${alpha})`;
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    if (size > 1.2 && dark) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, size * 6);
      g.addColorStop(0, `rgba(${ice},${alpha * 0.3})`); g.addColorStop(1, `rgba(${ice},0)`);
      ctx.fillStyle = g; ctx.fillRect(x - size * 6, y - size * 6, size * 12, size * 12);
    }
  }

  // Constellation threads: short chains of linked stars, kept clear of the
  // centre column where the wordmark and the play button live.
  ctx.lineWidth = 0.7;
  for (let c = 0; c < 4; c++) {
    const left = c % 2 === 0;
    let x = w * (left ? 0.04 + rand() * 0.24 : 0.72 + rand() * 0.24), y = h * (0.1 + rand() * 0.78);
    const points: Array<[number, number]> = [[x, y]];
    for (let s = 0; s < 3 + Math.floor(rand() * 2); s++) {
      x = Math.min(w * (left ? 0.34 : 0.98), Math.max(w * (left ? 0.02 : 0.66), x + (rand() - 0.5) * 200));
      y += (rand() - 0.3) * 110;
      points.push([x, y]);
    }
    const thread = ctx.createLinearGradient(points[0][0], points[0][1], x, y);
    thread.addColorStop(0, `rgba(${ice},${dark ? 0.08 : 0.06})`);
    thread.addColorStop(0.5, `rgba(${ice},${dark ? 0.24 : 0.16})`);
    thread.addColorStop(1, `rgba(${ice},${dark ? 0.08 : 0.06})`);
    ctx.strokeStyle = thread;
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (const [px, py] of points.slice(1)) ctx.lineTo(px, py);
    ctx.stroke();
    for (const [px, py] of points) flare(ctx, px, py, 3 + rand() * 3, dark ? '230,242,255' : '70,120,190', dark ? 0.55 : 0.35);
  }

  // Static flares; the animated ones live in the DOM.
  for (let i = 0; i < 7; i++) flare(ctx, rand() * w, rand() * h, 4 + rand() * 6, dark ? '225,240,255' : '80,130,200', dark ? 0.6 : 0.35);
}

// Twinkling sparkles: transform + opacity only, so they stay on the compositor.
const SPARKS = [
  { x: 8, y: 22, s: 30, d: 0 }, { x: 91, y: 14, s: 24, d: -1.6 }, { x: 80, y: 80, s: 32, d: -3.1 },
  { x: 14, y: 72, s: 20, d: -2.2 }, { x: 68, y: 9, s: 16, d: -4.4 },
];

/**
 * Liquid-glass backdrop behind the shards: three drifting colour pools (CSS,
 * transform-only), stars, constellation threads and flares painted once into
 * a canvas, a few twinkling CSS sparkles,
 * and a frosted grain on top. Nothing here repaints per frame.
 */
export const StarfieldBackdrop: React.FC<{ className?: string }> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDark = useThemeStore(s => s.isDark);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let last = { w: window.innerWidth, h: window.innerHeight };
    let timer = 0;
    const draw = () => paintSky(canvas, isDark);
    // Paint once the first frame is out so the sky never delays the UI.
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: object) => number);
    const handle = ric ? ric(draw, { timeout: 400 }) : window.setTimeout(draw, 60);
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Mobile browser chrome changes height constantly; only repaint on real resizes.
        const w = window.innerWidth, h = window.innerHeight;
        if (Math.abs(w - last.w) < 80 && Math.abs(h - last.h) < 180) return;
        last = { w, h };
        draw();
      }, 220);
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
      if (ric) (window as any).cancelIdleCallback?.(handle); else window.clearTimeout(handle);
    };
  }, [isDark]);

  return <div className={`starfield ${className}`} aria-hidden="true">
    <i className="liquid-blob liquid-blob--a" />
    <i className="liquid-blob liquid-blob--b" />
    <i className="liquid-blob liquid-blob--c" />
    <canvas ref={canvasRef} className="starfield-canvas" />
    {SPARKS.map((p, i) => <i key={i} className="starfield-spark" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, animationDelay: `${p.d}s` }} />)}
    <i className="starfield-frost" />
  </div>;
};
