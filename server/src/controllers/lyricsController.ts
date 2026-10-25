import { Request, Response, NextFunction } from 'express';
import {translateLines,TranslationError} from '../services/TranslationService.js';
import { lyricsService } from '../services/LyricsService.js';
import {prisma} from '../database/client.js';
import {timingOffsetFor} from '../services/userContent.js';
import {geniusAnnotations} from '../services/GeniusAnnotationService.js';
import {logger} from '../utils/logger.js';
import type {LyricLine} from '../types/index.js';

function storedLines(value: string | null | undefined): LyricLine[] | null {
  try {
    const lines: unknown = JSON.parse(value || 'null');
    return Array.isArray(lines) && lines.length && lines.every(line => line && typeof line.text === 'string' && Number.isFinite(line.time)) ? lines : null;
  } catch { return null; }
}

async function optionalContent<T>(query: Promise<T>, trackId: string): Promise<T | null> {
  return query.catch(err => { logger.warn({ err, trackId }, 'Lyrics customisation unavailable; using catalogue'); return null; });
}

export class LyricsController {
  public getLyrics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const trackId = req.params.trackId;
      const [personal,shared,contribution]=await Promise.all([
        res.locals.userId?optionalContent(prisma.personalTrack.findUnique({where:{userId_trackId:{userId:res.locals.userId,trackId}}}),trackId):null,
        optionalContent(prisma.sharedTrackOverride.findUnique({where:{trackId}}),trackId),
        optionalContent(prisma.lyricContribution.findFirst({where:{trackId},orderBy:{updatedAt:'desc'}}),trackId),
      ]);
      const timingOffset=timingOffsetFor(personal,shared,req.query.source);
      const personalLines=storedLines(personal?.lyricsData);
      if(personalLines){res.json({data:{trackId,isSynced:true,syncedLyrics:personalLines,provider:'Ваш файл',timingOffset,personal:true}});return;}
      const contributionLines=storedLines(contribution?.lyricsData);
      if(contribution&&contributionLines){
        const [user,profile]=await Promise.all([
          optionalContent(prisma.user.findUnique({where:{id:contribution.userId}}),trackId),
          optionalContent(prisma.creatorProfile.findUnique({where:{userId:contribution.userId}}),trackId),
        ]);
        const author=user?{
          id:contribution.userId,
          username:user.username||null,
          displayName:profile?.displayName||user.name||'Слушатель',
          avatarUrl:profile?.avatarUrl||user.avatarUrl||'',
          credit:contribution.credit,
        }:undefined;
        res.json({data:{trackId,timingOffset,isSynced:true,syncedLyrics:contributionLines,provider:`Осколок · ${contribution.credit}`,authorId:contribution.userId,...(author?{author}:{})}});
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
            timingOffset,
            isSynced: false,
            provider: 'none',
            plainLyrics: null,
            syncedLyrics: null,
            message: 'Lyrics unavailable for this track',
          },
        });
        return;
      }
      res.json({ data: {...lyrics,timingOffset} });
    } catch (err) {
      next(err);
    }
  };

  /** Genius referents for the song; the client matches fragments to its own lines. */
  public translate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({data:await translateLines(req.body?.lines,req.body?.target)});
    } catch (err) {
      if(err instanceof TranslationError){res.status(400).json({error:{code:'TRANSLATION_INVALID',message:err.message}});return;}
      next(err);
    }
  };

  public getAnnotations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const trackName=String(req.query.trackName||'').slice(0,300),artistName=String(req.query.artistName||'').slice(0,300);
      if(!trackName.trim()||!artistName.trim()){res.json({data:{song:null,referents:[]}});return;}
      const data=await geniusAnnotations(artistName,trackName);
      // A failed lookup says nothing about the song: it must not be remembered as "no annotations".
      res.set('Cache-Control',data.transient?'no-store':data.song?'private, max-age=3600':'private, max-age=300');
      res.json({data});
    } catch (err) {
      next(err);
    }
  };
}

export const lyricsController = new LyricsController();
