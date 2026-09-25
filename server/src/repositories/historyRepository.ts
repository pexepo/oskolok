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

export interface HistoryEntry {
  id: string;
  userId: string;
  trackId: string;
  track: Track;
  playedAt: string;
}

export class HistoryRepository {
  public async addHistoryItem(userId: string, track: Track): Promise<HistoryEntry> {
    await ensureUserExists(userId);

    const recent = await prisma.historyItem.findFirst({
      where: {
        userId,
        trackId: track.id,
      },
      orderBy: { playedAt: 'desc' },
    });

    if (recent) {
      const diffMs = Date.now() - recent.playedAt.getTime();
      if (diffMs < 60000) {
        return {
          id: recent.id,
          userId: recent.userId,
          trackId: recent.trackId,
          track: JSON.parse(recent.trackData) as Track,
          playedAt: recent.playedAt.toISOString(),
        };
      }
    }

    const created = await prisma.historyItem.create({
      data: {
        userId,
        trackId: track.id,
        trackData: JSON.stringify(track),
      },
    });

    return {
      id: created.id,
      userId: created.userId,
      trackId: created.trackId,
      track,
      playedAt: created.playedAt.toISOString(),
    };
  }

  public async getHistory(userId: string, limit: number = 50): Promise<HistoryEntry[]> {
    await ensureUserExists(userId);

    const items = await prisma.historyItem.findMany({
      where: { userId },
      orderBy: { playedAt: 'desc' },
      take: limit,
    });

    return items.map((item) => ({
      id: item.id,
      userId: item.userId,
      trackId: item.trackId,
      track: JSON.parse(item.trackData) as Track,
      playedAt: item.playedAt.toISOString(),
    }));
  }

  public async clearHistory(userId: string): Promise<void> {
    await ensureUserExists(userId);

    await prisma.historyItem.deleteMany({
      where: { userId },
    });
  }
}

export const historyRepository = new HistoryRepository();
