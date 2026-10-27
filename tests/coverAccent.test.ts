import {describe, expect, it} from 'vitest';
import {coverAccent, hsl} from '../src/components/player/coverAccent.js';

describe('Интерференция accent from the cover', () => {
  it('reads HSL', () => {
    expect(hsl([1, 0, 0])).toEqual([0, 1, .5]);
    expect(hsl([.5, .5, .5])[1]).toBe(0);
  });
  it('picks the vivid colour over near-black and near-white, lifted for a dark backdrop', () => {
    const accent = coverAccent([[.02, .02, .03], [.9, .2, .5], [.97, .97, .97], [.3, .3, .32]]);
    expect(accent.hue).toBeGreaterThan(320);
    expect(accent.sat).toBeGreaterThan(1);
    expect(accent.color).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
  });
  it('turns a grey cover into a near-white, almost desaturated accent', () => {
    const accent = coverAccent([[.1, .1, .1], [.5, .5, .5], [.8, .8, .8], [.95, .95, .95]]);
    expect(accent.sat).toBeLessThan(.2);
    expect(accent.color).toBe('rgb(184 184 184)');
  });
});
