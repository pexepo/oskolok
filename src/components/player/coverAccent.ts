import type {Rgb} from '../../utils/releasePalette.js';

/** HSL of an sRGB colour in 0–1 channels: hue in degrees, saturation and lightness 0–1. */
export function hsl([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

/**
 * The cover's accent for Интерференция's controls: its most vivid colour (not the near-black or near-white ones),
 * lifted so it reads on the dark backdrop. A grey cover gives a near-white accent and an almost desaturated tint.
 * `sat` scales the blue shard icons' saturation after their hue is turned to `hue`.
 */
export function coverAccent(palette: readonly Rgb[]): {color: string; hue: number; sat: number} {
  let best: [number, number, number] = [217, 0, .7], score = -1;
  for (const rgb of palette) {
    const [h, s, l] = hsl(rgb);
    const value = s * (1 - Math.abs(l - .55) * 1.4);
    if (value > score) { score = value; best = [h, s, l]; }
  }
  const [h, s] = best, vivid = s * Math.max(0, score) > .04 ? s : 0;
  const light = .72, chroma = Math.min(.85, vivid) * (1 - Math.abs(2 * light - 1));
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1)), m = light - chroma / 2;
  const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  return {color: `rgb(${to255(r)} ${to255(g)} ${to255(b)})`, hue: Math.round(h), sat: Math.round(Math.min(1.3, Math.max(.08, vivid / .6)) * 100) / 100};
}
