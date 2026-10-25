import { Request, Response, NextFunction } from 'express';
import {readCustomization} from '../services/profileCustomization.js';
import {rolesForUser} from '../services/roles.js';
import {publicRewards} from '../services/rewards.js';
import { prisma } from '../database/client.js';
import {listShowcase,showcaseCount,showcaseMedia} from '../services/profileShowcase.js';

const FALLBACK_NAME = 'Слушатель';
const spicyId = (id: string) => /^spicy:\d{5,30}$/.test(id);
const normalizeUserId = (id: string) => /^\d{5,30}$/.test(id) ? `telegram:${id}` : id;
const LISTENING_WINDOW = 90000;
type AuthorLyric = { id: string; trackId: string; trackTitle: string; artistName: string; updatedAt: Date; roles?: string[] };

/** Every Spicy Lyrics credit ever recorded for this contributor, one row per track (uploader and maker merged). */
async function spicyLyrics(userId: string) {
  const credits = await prisma.spicyLyricsCredit.findMany({ where: { contributorId: userId }, orderBy: { seenAt: 'desc' } });
  const byTrack = new Map<string, AuthorLyric>();
  for (const c of credits) {
    const row = byTrack.get(c.trackId);
    if (row) { if (!row.roles!.includes(c.role)) row.roles!.push(c.role); continue; }
    byTrack.set(c.trackId, { id: c.id, trackId: c.trackId, trackTitle: c.trackTitle, artistName: c.artistName, updatedAt: c.seenAt, roles: [c.role] });
  }
  return { author: credits[0], items: [...byTrack.values()] };
}

async function loadSpicyProfile(userId: string) {
  const { author, items } = await spicyLyrics(userId);
  if (!author) return null;
  return { userId, username: null, displayName: author.name, avatarUrl: author.avatarUrl, bannerUrl: '', bio: 'Зарегистрирован на Spicy Lyrics.', externalSource: 'Spicy Lyrics', externalUrl: author.profileUrl, currentTrack: null, showcase: [], contributions: items, textsCount: items.length, musicCount: 0 };
}

async function loadIdentity(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const profile = await prisma.creatorProfile.findUnique({ where: { userId } });
  return {
    user, profile,
    displayName: profile?.displayName || user.name || FALLBACK_NAME,
    avatarUrl: profile?.avatarUrl || user.avatarUrl || '',
    bannerUrl: profile?.bannerUrl || '',
    bio: profile?.bio || '',
    customization: readCustomization(profile),
  };
}
/** Customisation and roles as shown to other people: hidden sections stay hidden server-side. */
async function publicExtras(userId: string, identity: NonNullable<Awaited<ReturnType<typeof loadIdentity>>>) {
  const c = identity.customization;
  return { customization: { accentColor: c.accentColor, theme: c.theme, pronouns: c.pronouns, location: c.location, status: c.status, socialLinks: c.socialLinks, visibility: c.visibility }, roles: await rolesForUser(userId).catch(() => []), rewards: await publicRewards(userId).catch(() => ({ medals: [], achievements: [], achievementsUnlocked: 0 })) };
}

/** Listening and likes on the tracks this author wrote lyrics for, other people only. */
async function lyricTrackStats(trackIds: string[], authorId: string) {
  if (!trackIds.length) return { plays: 0, listeners: 0, likes: 0 };
  const where = { trackId: { in: trackIds }, userId: { not: authorId } };
  const [plays, listeners, likes] = await Promise.all([
    prisma.historyItem.count({ where }),
    prisma.historyItem.groupBy({ by: ['userId'], where }).then(rows => rows.length),
    prisma.likedTrack.count({ where }),
  ]);
  return { plays, listeners, likes };
}

const nowPlaying = (profile: { playbackSeenAt: Date | null; currentTrackData: string | null } | null) => {
  if (!profile?.playbackSeenAt || Date.now() - profile.playbackSeenAt.getTime() >= LISTENING_WINDOW || !profile.currentTrackData) return null;
  try { return JSON.parse(profile.currentTrackData); } catch { return null; }
};
const pageParams = (req: Request) => ({ offset: Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0), limit: Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? '30'), 10) || 30)) });
const lyricRow = (c: AuthorLyric) => ({ id: c.id, trackId: c.trackId, trackTitle: c.trackTitle, artistName: c.artistName, updatedAt: c.updatedAt.toISOString(), ...(c.roles ? { roles: c.roles } : {}) });
const notFoundSpicy = (res: Response) => res.status(404).json({ error: { message: 'Автор Spicy Lyrics пока не найден в каталоге Осколка.' } });
const notFoundUser = (res: Response) => res.status(404).json({ error: { message: 'Пользователь не найден.' } });

export class PublicProfileController {
  public getPublicProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const userId = normalizeUserId(req.params.id);
      if (spicyId(userId)) {
        const profile = await loadSpicyProfile(userId);
        if (!profile) { notFoundSpicy(res); return; }
        res.json({ data: profile }); return;
      }
      const identity = await loadIdentity(userId);
      if (!identity) { notFoundUser(res); return; }
      const [showcase, contributions] = await Promise.all([
        identity.customization.visibility.showcase ? listShowcase(userId) : Promise.resolve([]),
        identity.customization.visibility.lyrics ? prisma.lyricContribution.findMany({
          where: { userId },
          select: { id: true, trackId: true, trackTitle: true, artistName: true, credit: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
        }) : Promise.resolve([]),
      ]);
      const publicIds=new Set((await prisma.playlist.findMany({where:{userId,isPublic:true},select:{id:true}})).map(p=>p.id));
      res.json({
        data: {
          userId,
          username: identity.user.username || null,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          bannerUrl: identity.bannerUrl,
          bio: identity.bio,
          // A playlist made private later leaves the public showcase.
          showcase: showcase.filter(item => item.kind !== 'playlist' || publicIds.has(item.playlist!.playlistId)),
          currentTrack: identity.customization.visibility.nowPlaying ? nowPlaying(identity.profile) : null,
          contributions,
          textsCount: contributions.length,
          ...await publicExtras(userId, identity),
        },
      });
    } catch (err) {
      next(err);
    }
  };

  /** Data for the author card: identity, activity and real aggregate stats. */
  public getSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const userId = normalizeUserId(req.params.id);
      if (spicyId(userId)) {
        const { author, items } = await spicyLyrics(userId);
        if (!author) { notFoundSpicy(res); return; }
        const stats = await lyricTrackStats(items.map(i => i.trackId), userId);
        res.json({ data: { userId, username: null, displayName: author.name, avatarUrl: author.avatarUrl, bannerUrl: '', bio: '', textsCount: items.length, musicCount: 0, externalSource: 'Spicy Lyrics', externalUrl: author.profileUrl, currentTrack: null, latestLyrics: items[0] ? lyricRow(items[0]) : null, stats } });
        return;
      }
      const identity = await loadIdentity(userId);
      if (!identity) { notFoundUser(res); return; }
      const [trackRows, musicCount, latest] = await Promise.all([
        identity.customization.visibility.lyrics ? prisma.lyricContribution.findMany({ where: { userId }, select: { trackId: true } }) : Promise.resolve([]),
        identity.customization.visibility.showcase ? showcaseCount(userId) : Promise.resolve(0),
        identity.customization.visibility.lyrics ? prisma.lyricContribution.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' }, select: { id: true, trackId: true, trackTitle: true, artistName: true, updatedAt: true } }) : Promise.resolve(null),
      ]);
      const stats = await lyricTrackStats([...new Set(trackRows.map(r => r.trackId))], userId);
      const current = identity.customization.visibility.nowPlaying ? nowPlaying(identity.profile) : null;
      const username = identity.user.username || null;
      res.json({
        data: {
          userId,
          username,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          bannerUrl: identity.bannerUrl,
          bio: identity.bio,
          textsCount: trackRows.length,
          musicCount,
          joinedAt: identity.user.createdAt.toISOString(),
          currentTrack: current ? { id: current.id, title: current.title, artistName: current.artist?.name || '', artworkUrl: current.artworkUrl || '' } : null,
          latestLyrics: latest ? lyricRow(latest) : null,
          stats: identity.customization.visibility.stats ? stats : null,
          ...await publicExtras(userId, identity),
          ...(username && userId.startsWith('telegram:') ? { telegramUrl: `https://t.me/${encodeURIComponent(username)}` } : {}),
        },
      });
    } catch (err) {
      next(err);
    }
  };

  /** A showcase picture or GIF, only while the profile shows its showcase. */
  public getShowcaseMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = normalizeUserId(req.params.id), identity = spicyId(userId) ? null : await loadIdentity(userId);
      const media = identity?.customization.visibility.showcase ? await showcaseMedia(userId, req.params.itemId) : null;
      if (!media) { res.sendStatus(404); return; }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.type(media.mime).sendFile(media.path);
    } catch (err) {
      next(err);
    }
  };

  /** Every lyrics entry by this author straight from the catalogue, paginated (offset/limit). */
  public getLyrics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const userId = normalizeUserId(req.params.id), { offset, limit } = pageParams(req);
      if (spicyId(userId)) {
        const { author, items } = await spicyLyrics(userId);
        if (!author) { notFoundSpicy(res); return; }
        res.json({ data: { items: items.slice(offset, offset + limit).map(lyricRow), total: items.length, offset, limit, hasMore: offset + limit < items.length } });
        return;
      }
      const identity = await loadIdentity(userId);
      if (!identity) { notFoundUser(res); return; }
      if (!identity.customization.visibility.lyrics) {
        res.json({ data: { items: [], total: 0, offset, limit, hasMore: false } }); return;
      }
      const [items, total] = await Promise.all([
        prisma.lyricContribution.findMany({ where: { userId }, select: { id: true, trackId: true, trackTitle: true, artistName: true, updatedAt: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: offset, take: limit }),
        prisma.lyricContribution.count({ where: { userId } }),
      ]);
      res.json({ data: { items: items.map(lyricRow), total, offset, limit, hasMore: offset + items.length < total } });
    } catch (err) {
      next(err);
    }
  };
}

export const publicProfileController = new PublicProfileController();
