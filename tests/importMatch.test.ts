import { describe, expect, it } from 'vitest';
import { matchScore, pickMatch } from '../server/src/services/importMatch.js';
import type { Track } from '../server/src/types/index.js';

const track = (artist: string, title: string, id = title): Track => ({ id, source: 'deezer', sourceId: id, title, artist: { id: 'a', source: 'deezer', sourceId: 'a', name: artist }, duration: 200, access: 'playable' } as Track);

describe('playlist import matching', () => {
  it('accepts the same song spelled differently', () => {
    expect(pickMatch('Oxxxymiron, Markul', 'Последний звонок (feat. Markul)', [track('Oxxxymiron & Markul', 'Последний звонок')]).track).not.toBeNull();
    expect(pickMatch('The Beatles', 'Let It Be - Remastered 2009', [track('The Beatles', 'Let It Be')]).track).not.toBeNull();
  });
  it('does not take a remix or another artist for the original', () => {
    expect(pickMatch('Slava Marlow', 'Ты горишь как огонь', [track('Slava Marlow', 'Ты горишь как огонь (Remix)')]).track).toBeNull();
    expect(pickMatch('Lida', 'Двигаться', [track('Someone Else', 'Двигаться')]).track).toBeNull();
  });
  it('ranks the closest candidate first for a low-accuracy pick', () => {
    const ranked = pickMatch('pyrokinesis', 'Днями-ночами', [track('Other', 'Днём и ночью', 'x'), track('pyrokinesis', 'днями ночами (prod.)', 'y')]).ranked;
    expect(ranked[0].id).toBe('y');
    expect(matchScore('pyrokinesis', 'Днями-ночами', track('Other', 'Днём и ночью'))).toBe(0);
  });
});
