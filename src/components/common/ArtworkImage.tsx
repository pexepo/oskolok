import React, { useState } from 'react';
import { Music } from 'lucide-react';
import { clsx } from 'clsx';
import { artworkSource, sizedArtwork } from '../../utils/artworkSource.js';
import { openCover } from './CoverViewer.js';

interface ArtworkImageProps {
  src?: string;
  alt: string;
  className?: string;
  iconSize?: number;
  /** Click opens the full-size, zoomable cover. */
  zoomable?: boolean;
}

// One observer per scroll root. Native lazy loading queues every cover that
// was flown past during a fast scroll. Start a cover near the visible area;
// keep the request alive so scrolling and entrance animations cannot cancel it.
type Watch = (visible: boolean) => void;
const observers = new Map<Element | null, { io: IntersectionObserver; watchers: Map<Element, Watch> }>();

function observe(el: Element, onChange: Watch): () => void {
  if (typeof IntersectionObserver === 'undefined') { onChange(true); return () => {}; }
  const root = el.closest('[data-scroll-root]');
  let entry = observers.get(root);
  if (!entry) {
    const watchers = new Map<Element, Watch>();
    const io = new IntersectionObserver(items => {
      for (const item of items) watchers.get(item.target)?.(item.isIntersecting);
    }, { root, rootMargin: '600px 0px' });
    entry = { io, watchers };
    observers.set(root, entry);
  }
  const current = entry;
  current.watchers.set(el, onChange);
  current.io.observe(el);
  return () => {
    current.io.unobserve(el);
    current.watchers.delete(el);
    if (!current.watchers.size) { current.io.disconnect(); observers.delete(root); }
  };
}

// Covers that already finished loading once: on the next mount (route change) they render
// at once, without the pulsing placeholder and fade, so pages don't blink on every visit.
const loadedSrcs = new Set<string>();

export const ArtworkImage: React.FC<ArtworkImageProps> = ({
  src,
  alt,
  className = 'w-12 h-12 rounded-md',
  iconSize = 24,
  zoomable = false,
}) => {
  const [retry, setRetry] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(() => !!src && loadedSrcs.has(src));
  const [near, setNear] = useState(() => !!src && loadedSrcs.has(src));
  const markLoaded = () => { if (src) { loadedSrcs.add(src); if (loadedSrcs.size > 3000) loadedSrcs.delete(loadedSrcs.values().next().value!); } setIsLoaded(true); };
  const boxRef = React.useRef<HTMLDivElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);
  // Rendered size × pixel density, measured before the first paint; rounded up so a resize doesn't refetch.
  const [px, setPx] = useState(0);
  React.useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || px) return;
    const width = Math.max(box.offsetWidth, box.offsetHeight);
    setPx(width ? Math.ceil(width * Math.min(window.devicePixelRatio || 1, 2) / 50) * 50 : 1000);
  });

  const shownSrc = React.useRef(src);
  React.useEffect(() => {
    if (shownSrc.current === src) return;
    shownSrc.current = src;
    setHasError(false); setRetry(0); setIsLoaded(!!src && loadedSrcs.has(src));
  }, [src]);

  React.useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    return observe(box, visible => { if (visible) setNear(true); });
  }, [src, hasError, retry]);

  // A cached image can finish before React attaches onLoad; check it directly.
  React.useLayoutEffect(() => {
    const img = imgRef.current;
    if (!isLoaded && img?.complete && img.naturalWidth > 0) markLoaded();
  });

  React.useEffect(() => {
    if (!hasError || retry >= 2) return;
    const timer = setTimeout(() => { setRetry(n => n + 1); setHasError(false); }, 1000 * (retry + 1));
    return () => clearTimeout(timer);
  }, [hasError, retry]);

  if (!src || (hasError && retry >= 2)) {
    return (
      <div
        className={clsx(
          'artwork-image flex items-center justify-center bg-white/80 dark:bg-slate-900/80 border border-blue-100/90 dark:border-slate-800 text-[#7188a3] dark:text-sky-400/70 shrink-0 select-none',
          className
        )}
        aria-label={alt}
      >
        <Music size={iconSize} />
      </div>
    );
  }

  // Once nearby, keep both cached and unfinished images mounted.
  const mountImage = !hasError && px > 0 && (near || isLoaded);

  return (
    <div ref={boxRef} className={clsx('artwork-image relative overflow-hidden bg-blue-50/50 dark:bg-slate-900/50 shrink-0', zoomable && 'artwork-zoomable', className)}
      {...(zoomable ? { role: 'button', tabIndex: 0, 'aria-label': alt, title: alt, onClick: (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); openCover(src, alt); }, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCover(src, alt); } } } : {})}>
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-50/40 dark:bg-slate-900/40 animate-pulse">
          <Music size={iconSize} className="text-[#7188a3] dark:text-sky-400/50 opacity-50" />
        </div>
      )}
      {mountImage && <img
        key={`${src}:${retry}:${px}`}
        ref={imgRef}
        src={retry === 1 ? sizedArtwork(src, px) : artworkSource(sizedArtwork(src, px))}
        referrerPolicy="no-referrer"
        alt={alt}
        decoding="async"
        onLoad={markLoaded}
        onError={() => setHasError(true)}
        className={clsx(
          'w-full h-full object-cover transition-opacity duration-300',
          isLoaded ? 'opacity-100' : 'opacity-0'
        )}
      />}
    </div>
  );
};
