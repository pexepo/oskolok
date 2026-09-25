import { prisma } from '../database/client.js';
import { Track } from '../types/index.js';

async function ensureUserExists(userId: string) {
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      name: 'Слушатель Oskolok',
    },
  });
}

export class LikedRepository {
  public async addLikedTrack(userId: string, track: Track): Promise<Track> {
    await ensureUserExists(userId);

    await prisma.likedTrack.upsert({
      where: {
        userId_trackId: {
          userId,
          trackId: track.id,
        },
      },
      update: {
        trackData: JSON.stringify(track),
      },
      create: {
        userId,
        trackId: track.id,
        trackData: JSON.stringify(track),
      },
    });

    return track;
  }

  public async removeLikedTrack(userId: string, trackId: string): Promise<void> {
    await ensureUserExists(userId);

    await prisma.likedTrack.deleteMany({
      where: {
        userId,
        trackId,
      },
    });
  }

  public async getLikedTracks(userId: string): Promise<Track[]> {
    await ensureUserExists(userId);

    const items = await prisma.likedTrack.findMany({
      where: { userId },
      orderBy: { addedAt: 'desc' },
    });

    return items.map((item) => JSON.parse(item.trackData) as Track);
  }

  public async isLiked(userId: string, trackId: string): Promise<boolean> {
    await ensureUserExists(userId);

    const count = await prisma.likedTrack.count({
      where: {
        userId,
        trackId,
      },
    });
    return count > 0;
  }
}

export const likedRepository = new LikedRepository();
