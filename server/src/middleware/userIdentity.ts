import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../database/client.js';
import { validateTelegramInitData } from '../services/telegramAuth.js';
import {checkBetaAccess,BETA_DENIED_MESSAGE} from '../services/telegramBeta.js';
import { createHash } from 'node:crypto';

const readCookie=(req:Request,name:string)=>String(req.headers?.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1);
const isPublicRoute=(req:Request)=>req.path.startsWith('/telegram/login/')||req.path==='/telegram/session'||req.method==='GET'&&(req.path==='/health'||/^\/users\/[^/]+(?:\/(?:summary|lyrics))?$/.test(req.path));

export async function userIdentity(req:Request,res:Response,next:NextFunction){
  res.locals.userId=undefined;
  try{
    const raw=req.get('Authorization');
    if(raw?.startsWith('tma ')){
      let user;
      try{user=validateTelegramInitData(raw.slice(4),env.TELEGRAM_BOT_TOKEN);}catch{
        res.status(401).json({error:{code:'TELEGRAM_AUTH_INVALID',message:'Сессия Telegram истекла или недействительна. Откройте приложение заново через бота.'}});return;
      }
      const id=`telegram:${user.id}`;
      await prisma.user.upsert({where:{id},create:{id,name:[user.first_name,user.last_name].filter(Boolean).join(' '),username:user.username,avatarUrl:user.photo_url},update:{name:[user.first_name,user.last_name].filter(Boolean).join(' '),username:user.username??null,avatarUrl:user.photo_url}});
      res.locals.telegramUser=user;res.locals.userId=id;
    }else{
      const token=readCookie(req,'oskolok_session');
      if(token){
        const session=await prisma.webSession.findUnique({where:{tokenHash:createHash('sha256').update(token).digest('hex')}});
        if(session&&session.expiresAt>new Date()){
          const user=await prisma.user.findUnique({where:{id:session.userId}});
          if(user){res.locals.userId=user.id;res.locals.telegramUser={id:Number(user.id.slice(9)),first_name:user.name,username:user.username,photo_url:user.avatarUrl};}
        }else if(!isPublicRoute(req)){res.status(401).json({error:{code:'TELEGRAM_SESSION_EXPIRED',message:'Сессия истекла. Войдите через Telegram снова.'}});return;}
      }
    }
    if(res.locals.userId){
      res.locals.betaAllowed=await checkBetaAccess(res.locals.userId,res.locals.telegramUser?.username);
      if(res.locals.betaAllowed)await prisma.user.updateMany({where:{id:res.locals.userId,OR:[{lastActiveAt:null},{lastActiveAt:{lt:new Date(Date.now()-300000)}}]},data:{lastActiveAt:new Date()}});
    }
    if(res.locals.betaAllowed){const month=new Date().toISOString().slice(0,7);await prisma.monthlyActivity.upsert({where:{userId_month:{userId:res.locals.userId,month}},create:{userId:res.locals.userId,month},update:{}});}
    if(isPublicRoute(req)){next();return;}
    if(!res.locals.userId){res.status(401).json({error:{code:'TELEGRAM_AUTH_REQUIRED',message:'Войдите в Осколок через Telegram.'}});return;}
    if(!res.locals.betaAllowed){res.status(403).json({error:{code:'BETA_ACCESS_DENIED',message:BETA_DENIED_MESSAGE}});return;}
    next();
  }catch(error){next(error);}
}

export async function ownPlaylist(req:Request,res:Response,next:NextFunction){
  try{
    if(req.method==='GET'&&/^(soundcloud|spotify):/.test(req.params.id)){next();return;}
    const playlist=await prisma.playlist.findUnique({where:{id:req.params.id},select:{userId:true,isPublic:true}});
    if(!playlist||(playlist.userId!==res.locals.userId&&!(req.method==='GET'&&playlist.isPublic))){res.status(404).json({error:{code:'PLAYLIST_NOT_FOUND',message:'Плейлист не найден.'}});return;}
    next();
  }catch(err){next(err);}
}
