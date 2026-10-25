import {sourceRank} from '../services/recordingKey.js';
import {deduplicateSearchTracks} from '../services/trackRanking.js';
import { prisma } from '../database/client.js';
import { Playlist, PlaylistOwner, PlaylistTrackItem, Track } from '../types/index.js';

// Only public identity fields belong in playlist responses.
const ownerSelect = { id: true, name: true, username: true } as const;
const realName = (value?: string | null) => {
  const name = value?.trim();
  return name && !/^слушатель(?:\s+oskolok)?$/i.test(name) ? name : undefined;
};

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
    const uniqueTracks = deduplicateSearchTracks((tracks || []).filter((t) => {
      if (!t || !t.id) return false;
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    }));

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
        user: { select: ownerSelect },
        tracks: {
          orderBy: { position: 'asc' },
        },
      },
    });

    return (await this.mapToDomains([playlist]))[0];
  }

  public async getPlaylistsByUser(userId: string): Promise<Playlist[]> {
    await ensureUserExists(userId);

    const playlists = await prisma.playlist.findMany({
      where: { userId },
      include: {
        user: { select: ownerSelect },
        _count:{select:{tracks:true}},
        tracks: {
          take:1,
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return this.mapToDomains(playlists);
  }

  public async getPlaylistById(id: string): Promise<Playlist | null> {
    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        user: { select: ownerSelect },
        tracks: {
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!playlist) return null;
    return (await this.mapToDomains([playlist]))[0];
  }

  public async updatePlaylist(
    id: string,
    data: { title?: string; description?: string; artworkUrl?: string; isPublic?: boolean }
  ): Promise<Playlist> {
    const updated = await prisma.playlist.update({
      where: { id },
      data,
      include: {
        user: { select: ownerSelect },
        tracks: {
          orderBy: { position: 'asc' },
        },
      },
    });

    if (data.isPublic === false) { await prisma.profilePlaylist.deleteMany({where:{playlistId:id}}); await prisma.profileShowcaseItem.deleteMany({where:{kind:'playlist',refId:id}}); }
    else await prisma.profilePlaylist.updateMany({where:{playlistId:id},data:{title:updated.title,artworkUrl:updated.artworkUrl}});
    return (await this.mapToDomains([updated]))[0];
  }

  public async deletePlaylist(id: string): Promise<void> {
    await prisma.playlist.delete({
      where: { id },
    });
  }

  public async addTrackToPlaylist(playlistId: string, track: Track): Promise<Playlist> {
    await this.addTracksToPlaylist(playlistId,[track]);
    const updated=await this.getPlaylistById(playlistId);
    if(!updated)throw new Error('Playlist not found after track addition');
    return updated;
  }

  /** Merge catalogue copies without moving existing songs or folding different editions. */
  /**
   * Import: one confirmed request creates exactly one playlist (a repeated confirmation or a network retry
   * returns the same one), and every further chunk of tracks is applied once, in order. The source order is
   * kept; only the very same track id twice is stored once (shown to the listener before confirming).
   */
  public async importPlaylist(userId: string, input: { requestId: string; title: string; description?: string; isPublic: boolean; artworkUrl?: string; tracks: Track[] }): Promise<{ playlist: Playlist; created: boolean; chunks: number }> {
    await ensureUserExists(userId);
    // The request row is claimed first (primary key): of two simultaneous confirmations only one creates the playlist,
    // the other waits for it and returns the same one.
    try {
      await prisma.playlistImportRequest.create({ data: { requestId: input.requestId, userId, playlistId: '', chunks: 0 } });
    } catch {
      for (let attempt = 0; attempt < 40; attempt++) {
        const existing = await prisma.playlistImportRequest.findUnique({ where: { requestId: input.requestId } });
        if (!existing || existing.userId !== userId) throw Object.assign(new Error('Import request belongs to another user'), { status: 409 });
        if (existing.playlistId) { const playlist = await this.getPlaylistById(existing.playlistId); if (playlist) return { playlist, created: false, chunks: existing.chunks }; }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      throw Object.assign(new Error('Import is still being created, try again'), { status: 409 });
    }
    const seen = new Set<string>(), tracks = input.tracks.filter(t => t?.id && !seen.has(t.id) && !!seen.add(t.id));
    try {
      const created = await prisma.$transaction(async tx => {
        const playlist = await tx.playlist.create({ data: { userId, title: input.title, description: input.description, artworkUrl: input.artworkUrl, isPublic: input.isPublic,
          tracks: tracks.length ? { create: tracks.map((t, position) => ({ trackId: t.id, trackData: JSON.stringify(t), position })) } : undefined } });
        await tx.playlistImportRequest.update({ where: { requestId: input.requestId }, data: { playlistId: playlist.id, chunks: 1 } });
        return playlist;
      });
      return { playlist: (await this.getPlaylistById(created.id))!, created: true, chunks: 1 };
    } catch (error) {
      // Nothing was created: free the request id so the listener's retry can go through.
      await prisma.playlistImportRequest.delete({ where: { requestId: input.requestId } }).catch(() => {});
      throw error;
    }
  }

  /** Chunk `index` (1, 2, …) of an import: applied once; a repeated chunk is a no-op, a gap is refused. */
  public async importChunk(userId: string, requestId: string, index: number, tracks: Track[]): Promise<{ applied: boolean; chunks: number; total: number }> {
    return prisma.$transaction(async tx => {
      const request = await tx.playlistImportRequest.findUnique({ where: { requestId } });
      if (!request || request.userId !== userId) throw Object.assign(new Error('Import not found'), { status: 404 });
      const total = () => tx.playlistTrack.count({ where: { playlistId: request.playlistId } });
      if (index < request.chunks) return { applied: false, chunks: request.chunks, total: await total() };
      if (index > request.chunks) throw Object.assign(new Error('Import chunk out of order'), { status: 409 });
      const present = new Set((await tx.playlistTrack.findMany({ where: { playlistId: request.playlistId }, select: { trackId: true } })).map(r => r.trackId));
      let position = (await tx.playlistTrack.aggregate({ where: { playlistId: request.playlistId }, _max: { position: true } }))._max.position ?? -1;
      for (const t of tracks) {
        if (!t?.id || present.has(t.id)) continue;
        present.add(t.id);
        await tx.playlistTrack.create({ data: { playlistId: request.playlistId, trackId: t.id, trackData: JSON.stringify(t), position: ++position } });
      }
      await tx.playlistImportRequest.update({ where: { requestId }, data: { chunks: index + 1 } });
      return { applied: true, chunks: index + 1, total: await total() };
    });
  }

  public async addTracksToPlaylist(playlistId: string, tracks: Track[]): Promise<{added:number;total:number}> {
    const existing=await prisma.playlistTrack.findMany({where:{playlistId},select:{trackId:true,trackData:true,position:true}});
    const rows=existing.map(row=>{let track:Track|undefined;try{track=JSON.parse(row.trackData);}catch{}return {...row,track};});
    let position=Math.max(-1,...rows.map(row=>row.position))+1,added=0;
    const seen=new Set<string>();
    const unique=deduplicateSearchTracks(tracks.filter(track=>track?.id&&!seen.has(track.id)&&!!seen.add(track.id)));
    const writes=[];
    for(const track of unique){
      const previous=rows.find(row=>row.trackId===track.id||row.track&&deduplicateSearchTracks([row.track,track]).length===1);
      if(previous){
        if(previous.trackId!==track.id&&previous.track&&sourceRank(previous.track)<sourceRank(track))continue;
        writes.push(prisma.playlistTrack.update({where:{playlistId_trackId:{playlistId,trackId:previous.trackId}},data:{trackId:track.id,trackData:JSON.stringify(track)}}));
        previous.trackId=track.id;previous.track=track;
      }else{
        writes.push(prisma.playlistTrack.create({data:{playlistId,trackId:track.id,trackData:JSON.stringify(track),position:position++}}));
        rows.push({trackId:track.id,trackData:JSON.stringify(track),position:position-1,track});added++;
      }
    }
    await prisma.$transaction(writes);
    return {added,total:existing.length+added};
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

  private async mapToDomains(dbPlaylists: any[]): Promise<Playlist[]> {
    const userIds = [...new Set<string>(dbPlaylists.filter(p => p.user).map(p => p.userId))];
    const profiles = userIds.length ? await prisma.creatorProfile.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, displayName: true },
    }) : [];
    const names = new Map(profiles.map(profile => [profile.userId, profile.displayName]));
    return dbPlaylists.map(playlist => {
      const username = playlist.user?.username?.trim() || undefined;
      const name = realName(names.get(playlist.userId)) || username || realName(playlist.user?.name);
      const owner: PlaylistOwner | undefined = name ? {
        id: playlist.userId,
        name,
        ...(username ? { username } : {}),
        source: 'oskolok',
      } : undefined;
      return this.mapToDomain(playlist, owner);
    });
  }

  private mapToDomain(dbPlaylist: any, owner?: PlaylistOwner): Playlist {
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
      isPublic: dbPlaylist.isPublic,
      userId: dbPlaylist.userId,
      owner,
      title: dbPlaylist.title,
      description: dbPlaylist.description || undefined,
      artworkUrl: dbPlaylist.artworkUrl || undefined,
      createdAt: dbPlaylist.createdAt.toISOString(),
      updatedAt: dbPlaylist.updatedAt.toISOString(),
      trackCount: dbPlaylist._count?.tracks??tracks.length,
      tracks,
    };
  }
}

export const playlistRepository = new PlaylistRepository();
