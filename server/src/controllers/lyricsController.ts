import { Request, Response, NextFunction } from 'express';
import { lyricsService } from '../services/LyricsService.js';
import {prisma} from '../database/client.js';

export class LyricsController {
  public getLyrics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const trackId = req.params.trackId;
      const contribution=await prisma.lyricContribution.findFirst({where:{trackId},orderBy:{updatedAt:'desc'}});
      if(contribution){
        const [user,profile]=await Promise.all([
          prisma.user.findUnique({where:{id:contribution.userId}}),
          prisma.creatorProfile.findUnique({where:{userId:contribution.userId}}),
        ]);
        const author=user?{
          id:contribution.userId,
          username:user.username||null,
          displayName:profile?.displayName||user.name||'Слушатель',
          avatarUrl:profile?.avatarUrl||user.avatarUrl||'',
          credit:contribution.credit,
        }:undefined;
        res.json({data:{trackId,isSynced:true,syncedLyrics:JSON.parse(contribution.lyricsData),provider:`Осколок · ${contribution.credit}`,authorId:contribution.userId,...(author?{author}:{})}});
        return;
      }
      const trackName = (req.query.trackName as string) || '';
      const artistName = (req.query.artistName as string) || '';
      const duration = req.query.duration ? parseInt(req.query.duration as string, 10) : undefined;
      const lyrics = await lyricsService.getLyrics(trackId, trackName, artistName, duration);
      if (!lyrics) {
        res.json({
          data: {
            trackId,
            isSynced: false,
            provider: 'none',
            plainLyrics: null,
            syncedLyrics: null,
            message: 'Lyrics unavailable for this track',
          },
        });
        return;
      }
      res.json({ data: lyrics });
    } catch (err) {
      next(err);
    }
  };
}

export const lyricsController = new LyricsController();
