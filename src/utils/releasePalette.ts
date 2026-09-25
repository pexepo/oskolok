export type Rgb = readonly [number, number, number];

export const DEFAULT_FLUTED_GLASS_PALETTE: readonly Rgb[] = [
  [2 / 255, 1 / 255, 10 / 255],
  [4 / 255, 5 / 255, 46 / 255],
  [61 / 255, 44 / 255, 141 / 255],
  [145 / 255, 107 / 255, 191 / 255],
];

const luminance = ([red, green, blue]: Rgb) => red * .2126 + green * .7152 + blue * .0722;
const distance = (left: Rgb, right: Rgb) =>
  (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2;

/** Four deterministic colour clusters, ordered from the darkest to the brightest. */
export function clusterReleasePalette(pixels: readonly Rgb[]): Rgb[] {
  if (!pixels.length) return [...DEFAULT_FLUTED_GLASS_PALETTE];
  const ordered = [...pixels].sort((left, right) => luminance(left) - luminance(right));
  const seeds = [.08, .36, .68, .94].map(point => ordered[Math.min(ordered.length - 1, Math.floor(point * ordered.length))]);
  let centers = seeds.map(color => [...color] as [number, number, number]);

  for (let pass = 0; pass < 7; pass++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const pixel of pixels) {
      let nearest = 0, nearestDistance = Infinity;
      centers.forEach((center, index) => {
        const candidate = distance(pixel, center);
        if (candidate < nearestDistance) { nearest = index; nearestDistance = candidate; }
      });
      sums[nearest][0] += pixel[0];
      sums[nearest][1] += pixel[1];
      sums[nearest][2] += pixel[2];
      sums[nearest][3]++;
    }
    centers = centers.map((center, index) => sums[index][3]
      ? [sums[index][0] / sums[index][3], sums[index][1] / sums[index][3], sums[index][2] / sums[index][3]]
      : center);
  }

  return centers.sort((left, right) => luminance(left) - luminance(right));
}

const paletteCache = new Map<string, Promise<Rgb[]>>();

export function paletteFromArtwork(url?: string): Promise<Rgb[]> {
  if (!url || typeof Image === 'undefined') return Promise.resolve([...DEFAULT_FLUTED_GLASS_PALETTE]);
  const cached = paletteCache.get(url);
  if (cached) return cached;

  const request = new Promise<Rgb[]>(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 48; canvas.height = 48;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas 2D is unavailable');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const pixels: Rgb[] = [];
        for (let index = 0; index < data.length; index += 4) {
          if (data[index + 3] < 160) continue;
          pixels.push([data[index] / 255, data[index + 1] / 255, data[index + 2] / 255]);
        }
        resolve(clusterReleasePalette(pixels));
      } catch {
        resolve([...DEFAULT_FLUTED_GLASS_PALETTE]);
      }
    };
    image.onerror = () => resolve([...DEFAULT_FLUTED_GLASS_PALETTE]);
    image.src = url;
  });
  paletteCache.set(url, request);
  return request;
}
