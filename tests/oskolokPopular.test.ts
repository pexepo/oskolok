import { describe, expect, it } from 'vitest';
import { rankListening } from '../server/src/controllers/chartsController.js';

const t = (id: string) => JSON.stringify({ id, title: id, artist: { name: 'A' } });
describe('Популярно в Осколке', () => {
  it('ranks by distinct listeners, then plays; one-listener and broken rows stay out', () => {
    const rows = [
      { trackId: 'x', userId: 'u1', trackData: t('x') }, { trackId: 'x', userId: 'u1', trackData: t('x') }, { trackId: 'x', userId: 'u4', trackData: t('x') }, { trackId: 'solo', userId: 'u1', trackData: t('solo') },
      { trackId: 'y', userId: 'u1', trackData: t('y') }, { trackId: 'y', userId: 'u2', trackData: t('y') },
      { trackId: 'z', userId: 'u3', trackData: '{broken' }, { trackId: 'z', userId: 'u5', trackData: '{broken' },
    ];
    expect(rankListening(rows).map(r => [r.track.id, r.listeners, r.plays])).toEqual([['x', 2, 3], ['y', 2, 2]]);
  });
});
