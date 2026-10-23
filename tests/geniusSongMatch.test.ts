import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/src/database/client.js', () => ({ prisma: {} }));
vi.mock('../server/src/config/env.js', () => ({ env: {} }));
import { scoreHit } from '../server/src/services/GeniusAnnotationService.js';

const hit = (artist: string, title: string, primary = artist) => ({ artist_names: artist, primary_artist: { name: primary }, title });

describe('Genius song matching', () => {
  it('accepts a non-Latin song whose Genius title carries an English translation in brackets', () => {
    expect(scoreHit(hit('Мумий Тролль (Mumiy Troll)', 'Утекай (Flow Away)'), 'Мумий Тролль', 'Утекай')).toBeGreaterThanOrEqual(.75);
    expect(scoreHit(hit('ДДТ (DDT)', 'Осенняя (Autumn song)'), 'ДДТ', 'Осенняя')).toBeGreaterThanOrEqual(.75);
  });

  it('keeps the plain original ahead of its remixes and video versions', () => {
    const original = scoreHit(hit('Kendrick Lamar', 'Not Like Us'), 'Kendrick Lamar', 'Not Like Us');
    const remix = scoreHit(hit('Kendrick Lamar', 'Not Like Us (Superbowl LIX Halftime Remix)'), 'Kendrick Lamar', 'Not Like Us');
    const video = scoreHit(hit('Kendrick Lamar', 'Not Like Us (Video Version)'), 'Kendrick Lamar', 'Not Like Us');
    expect(original).toBe(1);
    expect(remix).toBeLessThan(.75);
    expect(video).toBeLessThan(original);
  });

  it('does not take another song that merely shares a word, nor the wrong artist, nor a translation page', () => {
    expect(scoreHit(hit('KARA KROSS (Ft. Мумий Тролль)', 'Время утекай (Time Ukai)'), 'Мумий Тролль', 'Утекай')).toBeLessThan(.75);
    expect(scoreHit(hit('Someone Else', 'Not Like Us'), 'Kendrick Lamar', 'Not Like Us')).toBe(0);
    expect(scoreHit(hit('Genius Russian Translations (Русский перевод)', 'Kendrick Lamar - Not Like Us (Русский перевод)', 'Genius Russian Translations (Русский перевод)'), 'Kendrick Lamar', 'Not Like Us')).toBe(0);
  });
});
