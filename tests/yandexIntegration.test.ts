import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/telegram/runtime.js', () => ({ apiBase: '/api', telegramAuthHeaders: () => ({}), scopedStorageKey: (key: string) => key, useTelegramStore: { setState: vi.fn() } }));
import { parseRotorBatch, parseSearchHint, yandexRef } from '../server/src/services/yandex/yandexApi.js';
import { hintPriors, hintQuery } from '../server/src/services/yandex/yandexSearchHint.js';
import { yandexSeeds } from '../server/src/services/wave/yandexWave.js';
import { normalizeWaveSettings, waveRequest } from '../src/stores/waveSettings.js';

const rotorAnswer = {
  radioSessionId: 'sess-1', batchId: 'batch-1',
  sequence: [
    { type: 'track', liked: false, trackParameters: { hue: 210, energy: 0.4, bpm: 96 }, track: { id: '123', title: 'Кукушка', artists: [{ name: 'Кино' }], albums: [{ id: '77', coverUri: 'avatars.yandex.net/get-music-content/x/%%' }], durationMs: 400000 } },
    { type: 'ad' },
    { type: 'track', track: { id: '124', title: 'Unavailable', artists: [{ name: 'X' }], available: false } },
  ],
};

describe('Yandex rotor answers', () => {
  it('keeps playable tracks with their wave hints', () => {
    const batch = parseRotorBatch(rotorAnswer)!;
    expect(batch.radioSessionId).toBe('sess-1');
    expect(batch.tracks).toHaveLength(1);
    expect(batch.tracks[0]).toMatchObject({ id: '123', albumId: '77', artists: ['Кино'], hue: 210, energy: 0.4 });
    expect(yandexRef(batch.tracks[0])).toBe('123:77');
  });
  it('rejects an answer without a session', () => {
    expect(parseRotorBatch({ sequence: [] })).toBeNull();
  });
});

describe('Резонанс settings → rotor seeds', () => {
  it('maps language, character, scene and mood', () => {
    expect(yandexSeeds({ language: 'ru', subgenre: 'hiphop', mood: 'melancholic', mode: 'niche' }))
      .toEqual(['user:onyourwave', 'settingDiversity:discover', 'settingLanguage:russian', 'genre:rusrap', 'settingMoodEnergy:sad']);
    expect(yandexSeeds({ language: 'all', subgenre: null, mood: null, mode: null })).toEqual(['user:onyourwave']);
  });
  it('leaves what Yandex cannot express to Осколок', () => {
    expect(yandexSeeds({ language: 'ja', subgenre: null, mood: null, mode: null })).toBeNull();
    expect(yandexSeeds({ language: 'en', subgenre: null, mood: null, mode: 'collection' })).toBeNull();
  });
  it('keeps the source choice in saved settings', () => {
    expect(normalizeWaveSettings(null).engine).toBe('yandex');
    const saved = normalizeWaveSettings({ engine: 'oskolok', language: 'ru' });
    expect(waveRequest(saved)).toMatchObject({ engine: 'oskolok', language: 'ru' });
  });
});

describe('search hints', () => {
  const answer = {
    text: 'пирокинезис', misspellCorrected: false,
    best: { type: 'artist', result: { name: 'pyrokinesis' } },
    artists: { results: [{ name: 'pyrokinesis' }] },
    tracks: { results: [{ id: '1', title: 'легендарная пыль', artists: [{ name: 'pyrokinesis' }] }] },
  };
  it('reads the best result as the query', () => {
    const hint = parseSearchHint(answer, 'пирокинезис')!;
    expect(hintQuery(hint)).toBe('pyrokinesis');
    expect(hintQuery(parseSearchHint({ ...answer, misspellCorrected: true, misspellResult: 'земфира искала' }, 'зимфира искала')!)).toBe('земфира искала');
  });
  it('turns Yandex order into priors', () => {
    const hint = parseSearchHint(answer, 'пирокинезис')!;
    const priors = hintPriors(hint, [
      { id: 'dz:1', title: 'легендарная пыль', artist: { name: 'pyrokinesis' } },
      { id: 'dz:2', title: 'другая песня', artist: { name: 'someone' } },
      { id: 'artist:1', title: '', artist: { name: 'Pyrokinesis' } },
    ]);
    expect(priors.get('dz:1')).toBe(40);
    expect(priors.has('dz:2')).toBe(false);
    expect(priors.get('artist:1')).toBe(50);
  });
});

describe('Резонанс v3 freshness and seeds', async () => {
  const { deezerAlbumYear, recencyScore } = await import('../server/src/services/wave/freshness.js');
  const { seedWeights, nameLanguage } = await import('../server/src/services/wave/personalWave.js');
  it('dates Deezer albums by id', () => {
    expect(deezerAlbumYear(103248)).toBe(2012);
    expect(deezerAlbumYear(127_270_232)).toBe(2020);
    expect(deezerAlbumYear(966_968_111)).toBe(2026);
    expect(deezerAlbumYear(2_000_000_000)).toBeUndefined();
    expect(recencyScore(2026, 2026)).toBeGreaterThan(recencyScore(2019, 2026));
    expect(recencyScore(2005, 2026)).toBeLessThan(0);
    expect(recencyScore(undefined)).toBe(0);
  });
  it('weights recent likes above old ones and lets session skips sink an artist', () => {
    const track = (artist: string, i: number) => ({ id: `t${i}`, title: `song ${i}`, artist: { name: artist }, duration: 200, source: 'deezer', sourceId: String(i), access: 'playable' }) as any;
    const likes = [track('New Love', 1), ...Array.from({ length: 60 }, (_, i) => track('Filler', i + 2)), track('Old Love', 99)];
    const w = seedWeights({ likes, library: [], history: [], artists: new Map() }, { liked: [], finished: [], skips: new Map([['skipme', 2]]) });
    expect(w.get('newlove')!.w).toBeGreaterThan(w.get('oldlove')!.w * 2);
    const skipped = seedWeights({ likes: [track('Skip Me', 1)], library: [], history: [], artists: new Map() }, { liked: [], finished: [], skips: new Map([['skipme', 2]]) });
    expect(skipped.get('skipme')!.w).toBeLessThan(0);
  });
  it('reads an artist language from names', () => {
    expect(nameLanguage(['Кино', 'Сплин', 'Би-2', 'Pompeya'])).toBe('ru');
    expect(nameLanguage(['YOASOBI', 'ずっと真夜中でいいのに。', 'ヨルシカ'])).toBe('ja');
    expect(nameLanguage(['Arctic Monkeys', 'The Strokes'])).toBeNull();
  });
});
