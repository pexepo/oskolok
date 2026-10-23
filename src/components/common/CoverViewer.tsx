import React from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { X, ZoomIn, ZoomOut, ExternalLink } from 'lucide-react';
import { useTranslation } from '../../stores/useLanguageStore.js';

/** The largest rendition each CDN serves for the same artwork URL. */
export function bestArtwork(url?: string): string | undefined {
  if (!url) return url;
  return url
    .replace(/(dzcdn\.net\/images\/(?:cover|artist)\/[0-9a-f]+\/)\d+x\d+/, '$11900x1900')     // Deezer
    .replace(/-(?:large|t\d+x\d+|crop)\.(jpg|png)/, '-original.$1')                           // SoundCloud
    .replace(/\/(?:hq|mq|sd)default\.jpg/, '/maxresdefault.jpg')                               // YouTube
    .replace(/\/\d+x\d+(bb|cc|-\d+)?\.(jpg|png|webp)$/, '/3000x3000bb.$2')                     // Apple
    .replace(/(images\.genius\.com\/[0-9a-f]+)\.\d+x\d+x\d+/, '$1.1000x1000x1');               // Genius
}

type State = { src?: string; preview?: string; title?: string; open: (src: string, title?: string) => void; close: () => void };
export const useCoverViewer = create<State>(set => ({ open: (src, title) => set({ src: bestArtwork(src), preview: src, title }), close: () => set({ src: undefined, preview: undefined, title: undefined }) }));
export const openCover = (src?: string, title?: string) => { if (src) useCoverViewer.getState().open(src, title); };

/** Full-screen artwork: the shown thumbnail appears at once, the best-quality file replaces it
 * when loaded (falls back to the thumbnail if the CDN has no larger one). Wheel / pinch / double
 * click zoom, drag to pan, Esc or backdrop to close. */
export function CoverViewer() {
  const t = useTranslation(), { src, preview, title, close } = useCoverViewer();
  const [shown, setShown] = React.useState<string>(), [scale, setScale] = React.useState(1), [pan, setPan] = React.useState({ x: 0, y: 0 });
  const drag = React.useRef<{ x: number; y: number; px: number; py: number } | null>(null), pinch = React.useRef<number | null>(null), pointers = React.useRef(new Map<number, { x: number; y: number }>());
  React.useEffect(() => {
    if (!src) return;
    setShown(preview); setScale(1); setPan({ x: 0, y: 0 });
    const img = new Image(); img.referrerPolicy = 'no-referrer';
    img.onload = () => setShown(src); img.src = src;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } if (e.key === '+' || e.key === '=') setScale(s => Math.min(6, s * 1.25)); if (e.key === '-') setScale(s => Math.max(1, s / 1.25)); };
    window.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey, true); document.body.style.overflow = overflow; img.onload = null; };
  }, [src, preview, close]);
  React.useEffect(() => { if (scale === 1) setPan({ x: 0, y: 0 }); }, [scale]);
  if (!src) return null;
  const zoomBy = (k: number) => setScale(s => Math.max(1, Math.min(6, s * k)));
  return createPortal(<div className="cover-viewer" role="dialog" aria-modal="true" aria-label={title || t('Обложка', 'Cover')} onClick={close}>
    <div className="cover-viewer-bar" onClick={e => e.stopPropagation()}>
      <span>{title}</span>
      <button onClick={() => zoomBy(1 / 1.4)} disabled={scale <= 1} aria-label={t('Уменьшить', 'Zoom out')}><ZoomOut size={18} /></button>
      <button onClick={() => zoomBy(1.4)} disabled={scale >= 6} aria-label={t('Увеличить', 'Zoom in')}><ZoomIn size={18} /></button>
      <a href={shown} target="_blank" rel="noopener noreferrer" aria-label={t('Открыть оригинал', 'Open original')}><ExternalLink size={18} /></a>
      <button onClick={close} aria-label={t('Закрыть', 'Close')}><X size={20} /></button>
    </div>
    <img src={shown} alt={title || ''} referrerPolicy="no-referrer" draggable={false}
      className={scale > 1 ? 'is-zoomed' : ''}
      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
      onClick={e => e.stopPropagation()}
      onDoubleClick={() => setScale(s => s > 1 ? 1 : 2.5)}
      onWheel={e => zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)}
      onPointerDown={e => { (e.target as Element).setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; }}
      onPointerMove={e => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const pts = [...pointers.current.values()];
        if (pts.length === 2) { const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); if (pinch.current) setScale(s => Math.max(1, Math.min(6, s * d / pinch.current!))); pinch.current = d; return; }
        if (drag.current && scale > 1) setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
      }}
      onPointerUp={e => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; drag.current = null; }}
      onPointerCancel={e => { pointers.current.delete(e.pointerId); pinch.current = null; drag.current = null; }} />
  </div>, document.body);
}

/** Corner affordance for covers whose click already navigates (release cards, search hits). */
export function ZoomCoverButton({ src, title }: { src?: string; title?: string }) {
  const t = useTranslation();
  if (!src) return null;
  return <button type="button" className="artwork-zoom-btn" aria-label={t('Открыть обложку', 'Open cover')} title={t('Открыть обложку', 'Open cover')}
    onClick={e => { e.preventDefault(); e.stopPropagation(); openCover(src, title); }}><ZoomIn size={15} /></button>;
}
