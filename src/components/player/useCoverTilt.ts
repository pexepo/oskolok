import React from 'react';

type Orientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
const MAX_X = 3.5, MAX_Y = 4.5;

/**
 * Tidal/Spotify-style cover: it leans toward the pointer and a faint holographic sheen follows it. Phones without a
 * hovering pointer use the gyroscope instead (iOS asks once, on the first tap of the cover). Writes CSS variables on
 * the element (--tilt-x/--tilt-y in deg, --holo-x/--holo-y in %, --holo-o 0–1); motion-reduced users get none of it.
 */
export function useCoverTilt(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0, next: [number, number, number] | null = null;
    const apply = (nx: number, ny: number, on: number) => {
      next = [Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny)), on];
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!next) return;
        const [x, y, o] = next;
        el.style.setProperty('--tilt-x', `${(-y * MAX_X).toFixed(2)}deg`);
        el.style.setProperty('--tilt-y', `${(x * MAX_Y).toFixed(2)}deg`);
        el.style.setProperty('--holo-x', `${(50 + x * 50).toFixed(1)}%`);
        el.style.setProperty('--holo-y', `${(50 + y * 50).toFixed(1)}%`);
        el.style.setProperty('--holo-o', String(o));
      });
    };
    const reset = () => { el.removeAttribute('data-tilting'); apply(0, 0, 0); };
    const cleanups: Array<() => void> = [];
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        el.setAttribute('data-tilting', '');
        apply(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1, 1);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', reset);
      cleanups.push(() => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', reset); });
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      // The way the phone was held at first is "flat"; leaning from there tilts the cover.
      let base: [number, number] | null = null;
      const orient = (e: DeviceOrientationEvent) => {
        if (e.beta == null || e.gamma == null) return;
        if (!base) base = [e.beta, e.gamma];
        base = [base[0] + (e.beta - base[0]) * .01, base[1] + (e.gamma - base[1]) * .01];
        el.setAttribute('data-tilting', '');
        apply((e.gamma - base[1]) / 18, (e.beta - base[0]) / 18, .8);
      };
      const listen = () => { window.addEventListener('deviceorientation', orient); cleanups.push(() => window.removeEventListener('deviceorientation', orient)); };
      const Orient = DeviceOrientationEvent as Orientation;
      if (typeof Orient.requestPermission === 'function') {
        const ask = () => { void Orient.requestPermission!().then(state => { if (state === 'granted') listen(); }).catch(() => {}); };
        el.addEventListener('click', ask, { once: true });
        cleanups.push(() => el.removeEventListener('click', ask));
      } else listen();
    }
    return () => { cancelAnimationFrame(frame); cleanups.forEach(f => f()); reset(); };
  }, [ref, enabled]);
}
