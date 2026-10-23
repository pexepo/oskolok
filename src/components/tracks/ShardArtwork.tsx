import React from 'react';
import { ArtworkImage } from '../common/ArtworkImage.js';

// The mask paths stay as shape names so existing callers keep working.
export const SHARD_MASKS = [
  '/shards/shard_tl.png',
  '/shards/shard_tr.png',
  '/shards/shard_bl.png',
  '/shards/shard_br.png',
  '/shards/shard_depth_left.png',
  '/shards/shard_depth_right.png',
];

type Pt = readonly [number, number];
type Shape = { aspect: number; points: readonly Pt[]; core: Pt };

/**
 * Clean crystal silhouettes in a 0–100 box. The outline (clip-path) and the
 * facet lines are built from the same vertices, so every facet meets the edge
 * exactly where the outline turns — no ragged rims or loose chips.
 */
const SHAPES: Record<string, Shape> = {
  '/shards/shard_tl.png': { aspect: 188 / 161, core: [54, 46], points: [[2, 32], [36, 4], [68, 0], [100, 46], [70, 98], [26, 90], [0, 62]] },
  '/shards/shard_tr.png': { aspect: 169 / 182, core: [48, 44], points: [[0, 20], [44, 0], [96, 14], [100, 68], [60, 100], [8, 84]] },
  '/shards/shard_bl.png': { aspect: 187 / 159, core: [50, 52], points: [[6, 6], [58, 0], [100, 30], [90, 86], [40, 100], [0, 60]] },
  '/shards/shard_br.png': { aspect: 168 / 161, core: [62, 56], points: [[58, 0], [100, 6], [96, 100], [38, 96], [0, 70], [26, 28]] },
  '/shards/shard_depth_left.png': { aspect: 140 / 200, core: [50, 46], points: [[22, 0], [100, 12], [84, 100], [0, 86], [6, 30]] },
  '/shards/shard_depth_right.png': { aspect: 154 / 175, core: [50, 52], points: [[0, 8], [76, 0], [100, 88], [16, 100]] },
};
const SHAPE_LIST = SHARD_MASKS.map(key => SHAPES[key]);

function shapeFor(mask: string | undefined, index: number): Shape {
  if (mask && SHAPES[mask]) return SHAPES[mask];
  if (mask) {
    // Unknown (decorative) masks still get a stable, clean silhouette.
    let hash = 0;
    for (const char of mask) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return SHAPE_LIST[Math.abs(hash) % SHAPE_LIST.length];
  }
  return SHAPE_LIST[index % 4];
}

const clipOf = (shape: Shape) => `polygon(${shape.points.map(([x, y]) => `${x}% ${y}%`).join(',')})`;

/** Triangles from the core to each edge, alternately lit and shaded. */
function Facets({ shape }: { shape: Shape }) {
  const [cx, cy] = shape.core, pts = shape.points;
  return <svg className="shard-facets" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    {pts.map(([x, y], i) => {
      const [nx, ny] = pts[(i + 1) % pts.length];
      return <polygon key={i} className={`shard-facet shard-facet--${i % 3}`} points={`${cx},${cy} ${x},${y} ${nx},${ny}`} />;
    })}
    {pts.map(([x, y], i) => <line key={`l${i}`} className="shard-ridge" x1={cx} y1={cy} x2={x} y2={y} vectorEffect="non-scaling-stroke" />)}
    <polygon className="shard-rim" points={pts.map(p => p.join(',')).join(' ')} vectorEffect="non-scaling-stroke" />
  </svg>;
}

/**
 * natural: keep the crystal's own proportions instead of a square tile.
 * tone: CSS background painted instead of a photo (generated collections).
 * holo: holographic foil; off by default for small list thumbnails.
 * portrait: artist photo — hero glow plus a specular glint that sweeps on hover.
 */
type Props = {
  src?: string; alt: string; index?: number; small?: boolean; mask?: string; className?: string;
  natural?: boolean; tone?: string; holo?: boolean; portrait?: boolean;
};

/**
 * A cover sealed in clear crystal: the photo, a cool tint, a diagonal glass
 * sheen with a hard cut, the crystal's facets, and an iridescent foil that
 * shifts with the pointer.
 */
export function ShardArtwork({ src, alt, index = 0, small = false, mask, className = '', natural = false, tone, holo = !small, portrait = false }: Props) {
  // Tiles cycle through the four broad crystals, then their mirror images;
  // the narrow depth shards are kept for explicit masks only.
  const shape = shapeFor(mask, index);
  const mirrored = !mask && Math.floor(index / 4) % 2 === 1;
  const style = {
    '--shard-clip': clipOf(shape),
    '--holo-shift': `${(index * 37) % 100}%`,
    aspectRatio: natural ? shape.aspect : undefined,
  } as React.CSSProperties;
  return <div className={`shard-artwork ${small ? 'shard-artwork--small' : ''} ${mirrored ? 'shard-artwork--mirror' : ''} ${holo ? 'shard-artwork--holo' : ''} ${portrait ? 'shard-artwork--portrait' : ''} ${className}`} style={style}>
    <div className="shard-body">
      {tone
        ? <i className="shard-photo shard-tone" style={{ background: tone }} role="img" aria-label={alt} />
        : <ArtworkImage src={src} alt={alt} className="shard-photo" />}
      <i className="shard-tint" />
      <i className="shard-sheen" />
      <Facets shape={shape} />
      {holo && <i className="shard-holo" />}
      {holo && <i className="shard-glare" />}
      {portrait && <i className="shard-glint" />}
    </div>
  </div>;
}
