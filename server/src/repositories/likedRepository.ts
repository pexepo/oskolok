import { prisma } from '../database/client.js';
import { Track } from '../types/index.js';
import { recordingKey, sameRecording, sourceRank } from '../services/recordingKey.js';

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
  /** Likes of the same recording from another catalogue (Spotify vs SoundCloud copy of one song). */
  private async sameRecordingRows(userId: string, track: Track) {
    const rows = await prisma.likedTrack.findMany({ where: { userId }, select: { id: true, trackId: true, trackData: true } });
    return rows.filter(row => { try { return row.trackId !== track.id && sameRecording(JSON.parse(row.trackData), track); } catch { return false; } });
  }

  public async addLikedTrack(userId: string, track: Track): Promise<Track> {
    await ensureUserExists(userId);
    // The song is already liked through another catalogue: keep one entry, the better-described copy.
    const twins = await this.sameRecordingRows(userId, track);
    if (twins.length) {
      const best = twins.map(row => JSON.parse(row.trackData) as Track).sort((a, b) => sourceRank(a) - sourceRank(b))[0];
      if (sourceRank(best) <= sourceRank(track)) return best;
      await prisma.likedTrack.deleteMany({ where: { id: { in: twins.map(row => row.id) } } });
    }

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
    // Unliking a song unlikes every catalogue copy of it.
    const row = await prisma.likedTrack.findUnique({ where: { userId_trackId: { userId, trackId } } });
    if (row) {
      const twins = await this.sameRecordingRows(userId, JSON.parse(row.trackData) as Track).catch(() => []);
      if (twins.length) await prisma.likedTrack.deleteMany({ where: { id: { in: twins.map(t => t.id) } } });
    }

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

    // Older libraries may hold one song twice (liked once from Spotify, once from SoundCloud):
    // show it once at its most recent position, keep the catalogue copy and drop the extras.
    const kept: Array<{ id: string; track: Track }> = [], extra: string[] = [], byKey = new Map<string, number[]>();
    for (const item of items) {
      let track: Track;
      try { track = JSON.parse(item.trackData) as Track; } catch { continue; }
      const key = recordingKey(track), bucket = key ? byKey.get(key) || [] : [];
      const at = bucket.find(i => sameRecording(kept[i].track, track));
      if (at === undefined) { if (key) byKey.set(key, [...bucket, kept.length]); kept.push({ id: item.id, track }); continue; }
      if (sourceRank(track) < sourceRank(kept[at].track)) { extra.push(kept[at].id); kept[at] = { id: item.id, track }; }
      else extra.push(item.id);
    }
    // Reading a library never deletes a user's likes. Exact catalogue duplicates
    // may be grouped for display; removal remains an explicit unlike action.
    return kept.map(k => k.track);
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
