import {Router} from 'express';
import {z} from 'zod';
import {getPlayback,saveClientPlayback,startTelegramPlayback,stepPlayback,stopTelegramPlayback} from '../services/telegramPlayback.js';

const route=(fn:(req:any,res:any)=>Promise<void>)=>(req:any,res:any,next:any)=>{fn(req,res).catch(next);};
const track=z.object({id:z.string().min(1).max(200),title:z.string().max(500)}).passthrough();
const queue=z.array(track).max(2000).optional();
const user=(res:any)=>{const id=res.locals.userId;if(typeof id!=='string'||!/^telegram:\d+$/.test(id)){res.status(401).json({error:{code:'TELEGRAM_REQUIRED',message:'Откройте Осколок через Telegram.'}});return null;}return id;};

/** Серверная сессия воспроизведения (восстановление после закрытия Mini App) и режим «источник Telegram». */
export const playbackSessionRoutes=Router();
playbackSessionRoutes.get('/session',route(async(_req,res)=>{
  const userId=user(res);if(!userId)return;
  res.setHeader('Cache-Control','no-store');
  res.json({data:await getPlayback(userId)});
}));
playbackSessionRoutes.put('/session',route(async(req,res)=>{
  const userId=user(res);if(!userId)return;
  const body=z.object({queue,queueHash:z.string().max(100),index:z.number().int().min(0).max(5000),position:z.number().min(0).max(86400),isPlaying:z.boolean(),clientSessionId:z.string().max(100).optional()}).parse(req.body);
  res.json({data:await saveClientPlayback(userId,body as never)});
}));
playbackSessionRoutes.post('/telegram/play',route(async(req,res)=>{
  const userId=user(res);if(!userId)return;
  const body=z.object({queue,queueHash:z.string().max(100),index:z.number().int().min(0).max(5000),position:z.number().min(0).max(86400).optional()}).parse(req.body);
  res.json({data:await startTelegramPlayback(userId,body as never)});
}));
playbackSessionRoutes.post('/telegram/step',route(async(req,res)=>{
  const userId=user(res);if(!userId)return;
  const {delta}=z.object({delta:z.number().int().min(-50).max(50)}).parse(req.body);
  const result=await stepPlayback(userId,delta);
  res.json({data:result?.state||null});
}));
playbackSessionRoutes.post('/telegram/stop',route(async(_req,res)=>{
  const userId=user(res);if(!userId)return;
  await stopTelegramPlayback(userId);res.json({data:{ok:true}});
}));
