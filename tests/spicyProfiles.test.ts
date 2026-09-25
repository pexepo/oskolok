import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ credits: vi.fn() }));
vi.mock('../server/src/database/client.js', () => ({ prisma: { spicyLyricsCredit: { findMany: db.credits } } }));
import { publicProfileController } from '../server/src/controllers/publicProfileController.js';

function response() {
  return { body: undefined as any, code: 200, setHeader() {}, json(payload: any) { this.body = payload; return this; }, status(code: number) { this.code = code; return this; } };
}

describe('external Spicy Lyrics author profile', () => {
  it('links the original author and counts each known track once', async () => {
    const base = { contributorId: 'spicy:790942393255329803', name: 'spikerko', avatarUrl: '', profileUrl: 'https://spicylyrics.org/uid/790942393255329803', trackId: 'spotify:one', trackTitle: 'Song', artistName: 'Artist' };
    db.credits.mockResolvedValue([{ ...base, id: 'uploader:one', role: 'uploader' }, { ...base, id: 'maker:one', role: 'maker' }, { ...base, id: 'uploader:two', trackId: 'spotify:two', trackTitle: 'Next', role: 'uploader' }]);
    const res = response();
    await publicProfileController.getPublicProfile({ params: { id: base.contributorId } } as any, res as any, () => {});
    expect(res.body.data.displayName).toBe('spikerko');
    expect(res.body.data.externalUrl).toBe(base.profileUrl);
    expect(res.body.data.bio).toBe('Зарегистрирован на Spicy Lyrics.');
    expect(res.body.data.textsCount).toBe(2);
    expect(res.body.data.contributions).toHaveLength(2);
  });
});
