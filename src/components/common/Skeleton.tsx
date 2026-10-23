import React from 'react';
import UniqueLoading from '../ui/morph-loading.js';
import { tr } from '../../stores/useLanguageStore.js';

/* Loading surfaces: the skeleton repeats the final geometry (so nothing jumps when data arrives) and the
   main loading animation sits one layer above it. Both follow one `loading` flag. A short delay keeps
   fast answers from flashing anything; reduced motion (and the economy effects mode) keeps the skeleton static. */

/** True only once `active` has lasted `delay` ms — a fast answer never shows a loader at all. */
export function useDelayedFlag(active: boolean, delay = 160): boolean {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    if (!active) { setShown(false); return; }
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  return shown;
}

export function SkeletonRows({ rows = 6, cover = true }: { rows?: number; cover?: boolean }) {
  return <div className="sk-rows" aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="sk-row">
      {cover && <span className="sk-block sk-cover" />}
      <span className="sk-lines"><span className="sk-block sk-line" style={{ width: `${62 - (i % 3) * 9}%` }} /><span className="sk-block sk-line sk-line--sub" style={{ width: `${38 - (i % 2) * 8}%` }} /></span>
      <span className="sk-block sk-time" />
    </div>)}
  </div>;
}

export function SkeletonCards({ count = 4, round = false }: { count?: number; round?: boolean }) {
  return <div className="sk-cards" aria-hidden="true">
    {Array.from({ length: count }, (_, i) => <div key={i} className="sk-card">
      <span className={`sk-block sk-art${round ? ' sk-art--round' : ''}`} />
      <span className="sk-block sk-line" style={{ width: '70%' }} />
      <span className="sk-block sk-line sk-line--sub" style={{ width: '48%' }} />
    </div>)}
  </div>;
}

/**
 * Layers: background → skeleton → loading animation → (the page's own controls stay outside this block).
 * `loading` false renders the children; nothing else decides when the indicators go away.
 */
export function LoadingSurface({ loading, skeleton, label, children, className = '' }: { loading: boolean; skeleton: React.ReactNode; label?: string; children?: React.ReactNode; className?: string }) {
  const shown = useDelayedFlag(loading);
  if (!loading) return <>{children}</>;
  return <div className={`loading-surface ${className}`} aria-busy="true" aria-live="polite">
    <div className={`loading-surface-skeleton${shown ? ' is-shown' : ''}`}>{skeleton}</div>
    {shown && <div className="loading-surface-indicator"><UniqueLoading size="md" label={label || tr('Загрузка', 'Loading')} />{label && <span>{label}</span>}</div>}
  </div>;
}

/** A page that is still loading: header block (cover + title lines) and track rows, the loader above them. */
export function PageSkeleton({ label, rows = 8, hero = true }: { label?: string; rows?: number; hero?: boolean }) {
  return <LoadingSurface loading label={label} className="page-skeleton" skeleton={<div className="sk-page">
    {hero && <div className="sk-hero"><span className="sk-block sk-hero-art" /><span className="sk-lines"><span className="sk-block sk-line" style={{ width: 90 }} /><span className="sk-block sk-hero-title" /><span className="sk-block sk-line sk-line--sub" style={{ width: '40%' }} /></span></div>}
    <SkeletonRows rows={rows} />
  </div>} />;
}
