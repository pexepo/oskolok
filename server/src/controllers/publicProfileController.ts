import { Request, Response, NextFunction } from 'express';
import { prisma } from '../database/client.js';
import {profileTrackWithArtwork} from '../services/profileArtwork.js';

const FALLBACK_NAME = 'Слушатель';
const spicyId = (id: string) => /^spicy:\d{5,30}$/.test(id);
const normalizeUserId = (id: string) => /^\d{5,30}$/.test(id) ? `telegram:${id}` : id;
const activeCreditDate = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

async function loadSpicyProfile(userId: string) {
  const credits = await prisma.spicyLyricsCredit.findMany({ where: { contributorId: userId, seenAt: { gte: activeCreditDate() } }, orderBy: { seenAt: 'desc' } });
  if (!credits.length) return null;
  const author = credits[0];
  const tracks = [...new Map(credits.map(credit => [credit.trackId, { id: credit.id, trackId: credit.trackId, trackTitle: credit.trackTitle, artistName: credit.artistName }])).values()];
  return { userId, username: null, displayName: author.name, avatarUrl: author.avatarUrl, bannerUrl: '', bio: 'Зарегистрирован на Spicy Lyrics.', externalSource: 'Spicy Lyrics', externalUrl: author.profileUrl, currentTrack: null, music: [], playlists: [], contributions: tracks, textsCount: tracks.length, musicCount: 0 };
}

async function loadIdentity(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const profile = await prisma.creatorProfile.findUnique({ where: { userId } });
  return {
    user,
    displayName: profile?.displayName || user.name || FALLBACK_NAME,
    avatarUrl: profile?.avatarUrl || user.avatarUrl || '',
    bannerUrl: profile?.bannerUrl || '',
    bio: profile?.bio || '',
  };
}

export class PublicProfileController {
  public getPublicProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const userId = normalizeUserId(req.params.id);
      if (spicyId(userId)) {
        const profile = await loadSpicyProfile(userId);
        if (!profile) { res.status(404).json({ error: { message: 'Автор Spicy Lyrics пока не найден в каталоге Осколка.' } }); return; }
        res.json({ data: profile }); return;
      }
      const identity = await loadIdentity(userId);
      if (!identity) {
        res.status(404).json({ error: { message: 'Пользователь не найден.' } });
        return;
      }
      const [music, contributions, playlists] = await Promise.all([
        prisma.profileMusic.findMany({ where: { userId }, orderBy: { addedAt: 'desc' } }),
        prisma.lyricContribution.findMany({
          where: { userId },
          select: { id: true, trackId: true, trackTitle: true, artistName: true, credit: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.profilePlaylist.findMany({where:{userId},orderBy:{addedAt:'desc'}}),
      ]);
      res.json({
        data: {
          userId,
          username: identity.user.username || null,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          bannerUrl: identity.bannerUrl,
          bio: identity.bio,
          music: await Promise.all(music.map((item) => profileTrackWithArtwork(item.trackData))),
          playlists: playlists.map(item=>({id:item.id,playlistId:item.playlistId,title:item.title,artworkUrl:item.artworkUrl,tracks:JSON.parse(item.tracksData)})),
          currentTrack:identity.user&&await prisma.creatorProfile.findUnique({where:{userId}}).then(p=>p?.playbackSeenAt&&Date.now()-p.playbackSeenAt.getTime()<90000&&p.currentTrackData?JSON.parse(p.currentTrackData):null),
          contributions,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public getSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const userId = normalizeUserId(req.params.id);
      if (spicyId(userId)) {
        const profile = await loadSpicyProfile(userId);
        if (!profile) { res.status(404).json({ error: { message: 'Автор Spicy Lyrics пока не найден в каталоге Осколка.' } }); return; }
        res.json({ data: profile }); return;
      }
      const identity = await loadIdentity(userId);
      if (!identity) {
        res.status(404).json({ error: { message: 'Пользователь не найден.' } });
        return;
      }
      const [textsCount, musicCount] = await Promise.all([
        prisma.lyricContribution.count({ where: { userId } }),
        prisma.profileMusic.count({ where: { userId } }),
      ]);
      res.json({
        data: {
          userId,
          username: identity.user.username || null,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          bio: identity.bio,
          textsCount,
          musicCount,
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

export const publicProfileController = new PublicProfileController();
