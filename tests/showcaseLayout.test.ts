import { describe, expect, it } from 'vitest';
import { formatLayout, parseLayout } from '../src/components/profile/showcaseLayout.js';
import { SHOWCASE_LAYOUT } from '../server/src/services/profileShowcase.js';

describe('showcase tile layout', () => {
  it('reads the old presets', () => {
    expect(parseLayout('wide')).toEqual({ w: 3, h: 2, fx: 50, fy: 50, z: 1 });
    expect(parseLayout(undefined)).toMatchObject({ w: 2, h: 2 });
  });
  it('round-trips a custom span and frame, and the server accepts it', () => {
    const size = formatLayout({ w: 5, h: 1, fx: 12.4, fy: 100, z: 1.756 });
    expect(size).toBe('g5x1;f12,100;z1.76');
    expect(parseLayout(size)).toEqual({ w: 5, h: 1, fx: 12, fy: 100, z: 1.76 });
    expect(SHOWCASE_LAYOUT.test(size)).toBe(true);
    expect(SHOWCASE_LAYOUT.test(formatLayout({ w: 9, h: 0, fx: -5, fy: 50, z: 7 }))).toBe(true);
  });
  it('rejects anything else', () => {
    for (const bad of ['g7x1', 'g2x2;f101,0', 'g2x2;z4', 'xl', 'g2x2;z1.234']) expect(SHOWCASE_LAYOUT.test(bad)).toBe(false);
  });
});
