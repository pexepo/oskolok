import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundCloudMapper } from '../server/src/services/SoundCloudMapper.js';

const db = vi.hoisted(() => ({
  userUpsert: vi.fn(), playlistCreate: vi.fn(), playlistFindMany: vi.fn(),
  playlistFindUnique: vi.fn(), playlistUpdate: vi.fn(), profileFindMany: vi.fn(),
  profilePlaylistUpdate: vi.fn(),
}));
vi.mock('../server/src/database/client.js', () => ({ prisma: {
  user: { upsert: db.userUpsert },
  playlist: { create: db.playlistCreate, findMany: db.playlistFindMany, findUnique: db.playlistFindUnique, update: db.playlistUpdate },
  creatorProfile: { findMany: db.profileFindMany },
  profilePlaylist: { updateMany: db.profilePlaylistUpdate },
} }));
import { playlistRepository } from '../server/src/repositories/playlistRepository.js';

const playlist = (user: object = { id: 'telegram:1', name: 'Слушатель Oskolok', username: 'pexepo' }) => ({
  id: 'imported-likes', userId: 'telegram:1', user,
  title: 'Лайки SoundCloud', description: 'Перенесено из soundcloud.com',
  isPublic: false, createdAt: new Date(), updatedAt: new Date(), tracks: [],
});

beforeEach(() => {
  vi.resetAllMocks();
  db.profileFindMany.mockResolvedValue([]);
});

describe('playlist owner identity', () => {
  it('uses the local profile nickname on an imported playlist and returns only public identity fields', async () => {
    db.playlistFindUnique.mockResolvedValue(playlist({ id: 'telegram:1', name: 'Telegram Name', username: 'pexepo', privateSession: 'secret' }));
    db.profileFindMany.mockResolvedValue([{ userId: 'telegram:1', displayName: 'пекселость', telegramSyncError: 'private' }]);

    const result = await playlistRepository.getPlaylistById('imported-likes');

    expect(result?.owner).toEqual({ id: 'telegram:1', name: 'пекселость', username: 'pexepo', source: 'oskolok' });
    expect(db.playlistFindUnique.mock.calls[0][0].include.user.select).toEqual({ id: true, name: true, username: true });
    expect(db.profileFindMany).toHaveBeenCalledWith({
      where: { userId: { in: ['telegram:1'] } }, select: { userId: true, displayName: true },
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|privateSession|telegramSyncError/);
  });

  it('replaces old listener placeholders with the real username in every list entry', async () => {
    db.playlistFindMany.mockResolvedValue([playlist(), { ...playlist(), id: 'another-playlist' }]);
    db.profileFindMany.mockResolvedValue([{ userId: 'telegram:1', displayName: 'Слушатель' }]);

    const result = await playlistRepository.getPlaylistsByUser('telegram:1');

    expect(result.map(item => item.owner?.name)).toEqual(['pexepo', 'pexepo']);
    expect(db.profileFindMany).toHaveBeenCalledTimes(1);
  });

  it('falls back to an account name when no nickname is set and never invents one for legacy users', async () => {
    db.playlistFindUnique.mockResolvedValueOnce(playlist({ name: 'Анна', username: null }));
    expect((await playlistRepository.getPlaylistById('imported-likes'))?.owner).toEqual({ id: 'telegram:1', name: 'Анна', source: 'oskolok' });
    db.playlistFindUnique.mockResolvedValueOnce(playlist({ name: 'Слушатель Oskolok', username: null }));
    expect((await playlistRepository.getPlaylistById('imported-likes'))?.owner).toBeUndefined();
  });

  it('includes the same owner immediately after creating or editing a playlist', async () => {
    db.playlistCreate.mockResolvedValue(playlist());
    db.playlistUpdate.mockResolvedValue(playlist());
    const created = await playlistRepository.createPlaylist('telegram:1', 'Лайки SoundCloud');
    const updated = await playlistRepository.updatePlaylist(created.id, { title: 'Новое имя' });
    expect(created.owner?.name).toBe('pexepo');
    expect(updated.owner).toEqual(created.owner);
  });

  it('preserves the playlist not found response without loading profiles', async () => {
    db.playlistFindUnique.mockResolvedValue(null);
    expect(await playlistRepository.getPlaylistById('missing')).toBeNull();
    expect(db.profileFindMany).not.toHaveBeenCalled();
  });
});

describe('SoundCloud playlist owner', () => {
  const track = { id: 99, title: 'Artist - Song', duration: 100000, user: { id: 2, username: 'Track uploader' } };

  it('uses the playlist owner and preserves the actual nickname independently of track artists', () => {
    const result = SoundCloudMapper.mapPlaylist({ id: 12, title: 'Плейлист', user: { id: 1, username: '  пекселость ★  ' }, tracks: [track] });
    expect(result.owner).toEqual({ id: 'soundcloud:1', name: 'пекселость ★', source: 'soundcloud' });
    expect(result.tracks?.[0].track.artist.name).toBe('Artist');
  });

  it('does not use a track artist as the owner when SoundCloud omits the playlist user', () => {
    const result = SoundCloudMapper.mapPlaylist({ id: 12, title: 'Плейлист', tracks: [track] });
    expect(result.owner).toBeUndefined();
    expect(result.userId).toBe('soundcloud');
  });
});
