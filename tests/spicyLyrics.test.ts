import { describe, expect, it } from 'vitest';
import { mapSpicyLyrics } from '../server/src/services/SpicyLyricsService.js';

const spotifyId = '1QV6tiMFM6fSOKOGLMHYYg';
const contributor = (id: string, username: string) => ({ id, username, url: `https://spicylyrics.org/uid/${id}` });

describe('Spicy Lyrics response mapping', () => {
  it('keeps syllable timing, background vocals and both community credits', () => {
    const result = mapSpicyLyrics({
      id: spotifyId, source: 'spicy_lyrics', Type: 'Syllable', EndTime: 120,
      UploadAttribution: { Uploader: contributor('790942393255329803', 'spikerko'), Maker: contributor('816650334255579137', 'gc') },
      Content: [{ Type: 'Vocal', Lead: { StartTime: 7, EndTime: 9, Syllables: [
        { Text: 'Hel', StartTime: 7, EndTime: 7.5, IsPartOfWord: true },
        { Text: 'lo', StartTime: 7.5, EndTime: 8 },
        { Text: 'you', StartTime: 8, EndTime: 9 },
      ] }, Background: [{ StartTime: 7.5, EndTime: 8.5, Syllables: [{ Text: 'oh', StartTime: 7.5, EndTime: 8.5 }] }] }],
    }, 'spotify:' + spotifyId, spotifyId);
    expect(result?.syncedLyrics?.[0].text).toBe('Hello you');
    expect(result?.syncedLyrics?.[0].words?.[0].joinNext).toBe(true);
    expect(result?.syncedLyrics?.[0].background?.[0].role).toBe('background');
    expect(result?.attribution?.uploader?.id).toBe('spicy:790942393255329803');
    expect(result?.attribution?.maker?.url).toBe('https://spicylyrics.org/uid/816650334255579137');
  });

  it('maps line and static formats from commercial sources without creator credits', () => {
    const line = mapSpicyLyrics({ id: spotifyId, source: 'apple_music', Type: 'Line', Content: [{ Type: 'Vocal', Text: 'A line', StartTime: 1, EndTime: 4 }] }, 't', spotifyId);
    const plain = mapSpicyLyrics({ id: spotifyId, source: 'spotify', Type: 'Static', Lines: [{ Text: 'First' }, { Text: 'Second' }] }, 't', spotifyId);
    expect(line?.syncedLyrics?.[0]).toMatchObject({ time: 1, end: 4, text: 'A line' });
    expect(line?.provider).toBe('Apple Music');
    expect(line?.attribution).toBeUndefined();
    expect(plain?.plainLyrics).toBe('First\nSecond');
    expect(plain?.isSynced).toBe(false);
  });

  it('rejects another track and uncredited community syncs', () => {
    expect(mapSpicyLyrics({ id: 'other', source: 'spotify', Type: 'Static', Lines: [{ Text: 'Wrong' }] }, 't', spotifyId)).toBeNull();
    expect(mapSpicyLyrics({ id: spotifyId, source: 'spicy_lyrics', Type: 'Static', Lines: [{ Text: 'Missing credit' }] }, 't', spotifyId)).toBeNull();
  });
});
