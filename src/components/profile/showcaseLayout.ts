/** A showcase tile's span in grid cells and the visible area of its picture (see SHOWCASE_LAYOUT on the server). */
export type TileLayout = { w: number; h: number; fx: number; fy: number; z: number };

const PRESETS: Record<string, [number, number]> = { s: [1, 1], m: [2, 2], l: [3, 3], wide: [3, 2], tall: [2, 3] };
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function parseLayout(size: string | undefined): TileLayout {
  const preset = PRESETS[size || 'm'];
  if (preset) return { w: preset[0], h: preset[1], fx: 50, fy: 50, z: 1 };
  const m = /^g(\d)x(\d)(?:;f(\d+),(\d+))?(?:;z([\d.]+))?$/.exec(size || '');
  if (!m) return { w: 2, h: 2, fx: 50, fy: 50, z: 1 };
  return { w: clamp(+m[1], 1, 6), h: clamp(+m[2], 1, 6), fx: clamp(+(m[3] ?? 50), 0, 100), fy: clamp(+(m[4] ?? 50), 0, 100), z: clamp(+(m[5] ?? 1), 1, 3) };
}

export function formatLayout(l: TileLayout): string {
  const w = clamp(Math.round(l.w), 1, 6), h = clamp(Math.round(l.h), 1, 6);
  const fx = clamp(Math.round(l.fx), 0, 100), fy = clamp(Math.round(l.fy), 0, 100), z = clamp(Math.round(l.z * 100) / 100, 1, 3);
  return `g${w}x${h}${fx !== 50 || fy !== 50 ? `;f${fx},${fy}` : ''}${z !== 1 ? `;z${z}` : ''}`;
}
