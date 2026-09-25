import { prisma } from '../database/client.js';
import { Playlist, PlaylistTrackItem, Track } from '../types/index.js';

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

export class PlaylistRepository {
  public async createPlaylist(
    userId: string,
    title: string,
    description?: string,
    artworkUrl?: string,
    tracks?: Track[]
  ): Promise<Playlist> {
    await ensureUserExists(userId);

    const seen = new Set<string>();
    const uniqueTracks = (tracks || []).filter((t) => {
      if (!t || !t.id) return false;
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    const playlist = await prisma.playlist.create({
      data: {
        userId,
        title,
        description,
        artworkUrl,
        tracks:
          uniqueTracks.length > 0
            ? {
                create: uniqueTracks.map((t, idx) => ({
                  trackId: t.id,
                  trackData: JSON.stringify(t),
                  position: idx,
                })),
              }
            : undefined,
      },
      include: {
        tracks: {
          orderBy: { position: 'asc' },
        },
      },
    });

    return this.mapToDomain(playlist);
  }

  public async getPlaylistsByUser(userId: string): Promise<Playlist[]> {
    await ensureUserExists(userId);

    const playlists = await prisma.playlist.findMany({
      where: { userId },
      include: {
        tracks: {
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return playlists.map((p) => this.mapToDomain(p));
  }

  public async getPlaylistById(id: string): Promise<Playlist | null> {
    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        tracks: {
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!playlist) return null;
    return this.mapToDomain(playlist);
  }

  public async updatePlaylist(
    id: string,
    data: { title?: string; description?: string; artworkUrl?: string }
  ): Promise<Playlist> {
    const updated = await prisma.playlist.update({
      where: { id },
      data,
      include: {
        tracks: {
          orderBy: { position: 'asc' },
        },
      },
    });

    return this.mapToDomain(updated);
  }

  public async deletePlaylist(id: string): Promise<void> {
    await prisma.playlist.delete({
      where: { id },
    });
  }

  public async addTrackToPlaylist(playlistId: string, track: Track): Promise<Playlist> {
    const count = await prisma.playlistTrack.count({
      where: { playlistId },
    });

    await prisma.playlistTrack.upsert({
      where: {
        playlistId_trackId: {
          playlistId,
          trackId: track.id,
        },
      },
      update: {
        trackData: JSON.stringify(track),
      },
      create: {
        playlistId,
        trackId: track.id,
        trackData: JSON.stringify(track),
        position: count,
      },
    });

    const updated = await this.getPlaylistById(playlistId);
    if (!updated) throw new Error('Playlist not found after track addition');
    return updated;
  }

  public async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<Playlist> {
    await prisma.playlistTrack.deleteMany({
      where: {
        playlistId,
        trackId,
      },
    });

    // Normalize positions sequentially
    const remainingTracks = await prisma.playlistTrack.findMany({
      where: { playlistId },
      orderBy: { position: 'asc' },
    });

    await prisma.$transaction(
      remainingTracks.map((t, idx) =>
        prisma.playlistTrack.update({
          where: { id: t.id },
          data: { position: idx },
        })
      )
    );

    const updated = await this.getPlaylistById(playlistId);
    if (!updated) throw new Error('Playlist not found');
    return updated;
  }

  public async reorderTracks(playlistId: string, trackIds: string[]): Promise<Playlist> {
    await prisma.$transaction(async (tx) => {
      const currentTracks = await tx.playlistTrack.findMany({
        where: { playlistId },
      });

      const trackMap = new Map(currentTracks.map((t) => [t.trackId, t]));

      for (let newPos = 0; newPos < trackIds.length; newPos++) {
        const tId = trackIds[newPos];
        const existingTrack = trackMap.get(tId);
        if (existingTrack) {
          await tx.playlistTrack.update({
            where: { id: existingTrack.id },
            data: { position: newPos },
          });
        }
      }
    });

    const updated = await this.getPlaylistById(playlistId);
    if (!updated) throw new Error('Playlist not found after reordering');
    return updated;
  }

  private mapToDomain(dbPlaylist: any): Playlist {
    const tracks: PlaylistTrackItem[] = (dbPlaylist.tracks || []).map((pt: any) => ({
      id: pt.id,
      playlistId: pt.playlistId,
      trackId: pt.trackId,
      position: pt.position,
      addedAt: pt.addedAt.toISOString(),
      track: JSON.parse(pt.trackData) as Track,
    }));

    return {
      id: dbPlaylist.id,
      userId: dbPlaylist.userId,
      title: dbPlaylist.title,
      description: dbPlaylist.description || undefined,
      artworkUrl: dbPlaylist.artworkUrl || undefined,
      createdAt: dbPlaylist.createdAt.toISOString(),
      updatedAt: dbPlaylist.updatedAt.toISOString(),
      trackCount: tracks.length,
      tracks,
    };
  }
}

export const playlistRepository = new PlaylistRepository();
