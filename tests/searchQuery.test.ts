import { describe, it, expect } from 'vitest';
import { swapKeyboardLayout, tokenMatch, phraseCoverage, levenshtein, namesMatch, foldedCoverage } from '../server/src/services/searchQuery.js';
import { rankTrack, rankArtist } from '../server/src/services/trackRanking.js';
import type { Track, Artist } from '../server/src/types/index.js';

const track = (title: string, artist: string, source = 'spotify'): Track => ({ id: `${source}:${artist}:${title}`, source: source as any, sourceId: title, title, artist: { id: artist, name: artist, source: source as any, sourceId: artist }, duration: 180, access: 'playable' });
const artist = (name: string, followersCount?: number): Artist => ({ id: name, name, source: 'spotify', sourceId: name, followersCount });

describe('search query understanding', () => {
  it('re-reads a query typed in the wrong keyboard layout', () => {
    expect(swapKeyboardLayout('фтвн цфкрщд')).toBe('andy warhol');
    expect(swapKeyboardLayout('ghbdtn')).toBe('привет');
    expect(swapKeyboardLayout('mixed текст')).toBeNull();
  });
  it('tolerates small typos and transliteration', () => {
    expect(levenshtein('warhal', 'warhol')).toBe(1);
    expect(tokenMatch('warhal', 'kai angel andy warhol')).toBeGreaterThan(.7);
    expect(tokenMatch('пирокинезис', 'pyrokinesis')).toBeGreaterThan(.7);
    expect(tokenMatch('xyz', 'kai angel')).toBe(0);
  });
  it('scores partial phrases between 0 and 1', () => {
    expect(phraseCoverage('kai angel', 'kai angel andy warhol')).toBe(1);
    expect(phraseCoverage('kai banana', 'kai angel')).toBe(.5);
  });
});

describe('search ranking', () => {
  it('puts "artist + title" queries on the exact song', () => {
    const exact = track('andy warhol', 'Kai Angel');
    const other = track('andy', 'Someone Warhol');
    expect(rankTrack(exact, 'kai angel andy warhol')).toBeGreaterThan(rankTrack(other, 'kai angel andy warhol'));
  });
  it('finds a song despite a typo', () => {
    expect(rankTrack(track('phantasmagoria', 'mzlff'), 'phantasmagorya')).toBeGreaterThan(rankTrack(track('Fantasy', 'Other'), 'phantasmagorya'));
  });
  it('keeps unrelated artists out of the artist row', () => {
    expect(rankArtist(artist('Kai Angel', 1000), 'kai angel')).toBeGreaterThan(0);
    expect(rankArtist(artist('Angel Haze'), 'kai angel andy warhol')).toBe(0);
  });
  it('lets the catalogue order break ties', () => {
    const a = track('Song', 'Artist');
    expect(rankTrack(a, 'song', 40)).toBeGreaterThan(rankTrack(a, 'song', 0));
  });
});

describe('source matching across scripts', () => {
  it('treats Latin catalogue names and Cyrillic channels as the same artist', () => {
    expect(namesMatch('Slava KPSS', 'Слава КПСС')).toBe(true);
    expect(namesMatch('Skryptonite', 'Скриптонит')).toBe(true);
    expect(namesMatch('Boulevard Depo', 'Бульвар Депо')).toBe(true);
    expect(namesMatch('Oxxxymiron', 'oxxxymironofficial')).toBe(true);
  });
  it('still rejects unrelated uploaders', () => {
    expect(namesMatch('Slava KPSS', 'NEURAL TRACKS')).toBe(false);
    expect(namesMatch('Imagine Dragons', 'Dragon Force')).toBe(false);
    expect(namesMatch('Oxxxymiron', 'ALEX KOSTYCHEV')).toBe(false);
  });
  it('compares titles folded', () => {
    expect(foldedCoverage('Ozhogi (feat. IC3PEAK)', 'Ожоги')).toBe(1);
    expect(foldedCoverage('Где нас нет', 'Где нас нет')).toBe(1);
  });
});
