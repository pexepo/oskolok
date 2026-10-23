import { useEffect } from 'react';

const HOVER_HOSTS = '.shard-hover, .recommendation-card, .collection-tile, .release-card, .sg-mix, .sg-preset';

/**
 * One delegated listener drives the holographic foil on every shard: the
 * pointer position inside the hovered shard is written to --hx/--hy (0..1)
 * once per frame. Touch and reduced-motion users keep the static foil.
 */
export function useHoloPointer() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let target: HTMLElement | null = null;
    let x = 0, y = 0;
    const flush = () => {
      frame = 0;
      if (!target) return;
      const r = target.getBoundingClientRect();
      if (!r.width || !r.height) return;
      target.style.setProperty('--hx', Math.min(1, Math.max(0, (x - r.left) / r.width)).toFixed(3));
      target.style.setProperty('--hy', Math.min(1, Math.max(0, (y - r.top) / r.height)).toFixed(3));
    };
    const onMove = (e: PointerEvent) => {
      const node = e.target as Element | null;
      if (!node?.closest) return;
      const host = node.closest<HTMLElement>(HOVER_HOSTS);
      const shard = host?.querySelector<HTMLElement>('.shard-artwork--holo') ?? node.closest<HTMLElement>('.shard-artwork--holo');
      if (!shard) return;
      target = shard; x = e.clientX; y = e.clientY;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
