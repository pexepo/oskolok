import React from 'react';
import { ArtworkImage } from '../common/ArtworkImage.js';
const shapes = [
  'polygon(4% 52%,28% 18%,94% 2%,83% 83%,57% 98%,16% 82%)',
  'polygon(7% 37%,57% 3%,87% 14%,99% 51%,65% 98%,0% 76%)',
  'polygon(1% 52%,40% 8%,74% 0%,99% 70%,59% 100%,13% 85%)',
  'polygon(0% 4%,62% 23%,100% 78%,64% 99%,10% 78%)',
  'polygon(0% 43%,61% 0%,100% 47%,37% 100%,1% 86%)',
  'polygon(0% 14%,49% 0%,89% 27%,100% 68%,69% 99%,20% 79%)',
];
export function ShardArtwork({ src, alt, index = 0, small = false }: { src?: string; alt: string; index?: number; small?: boolean }) {
  return <div className={`shard-artwork ${small ? 'shard-artwork--small' : ''}`}>
    <div className="shard-artwork-cut" style={{ clipPath: shapes[index % shapes.length] }}>
      <ArtworkImage src={src} alt={alt} className="shard-photo" />
      <div className="frosted-glass" /><div className="glass-grain" /><div className="glass-facets" />
    </div>
  </div>;
}
