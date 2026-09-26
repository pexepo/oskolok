import {Router} from 'express';
import {z} from 'zod';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {env} from '../config/env.js';
import QRCode from 'qrcode';
import {lyricSubmissionSchema} from '../validation/lyrics.js';
import {trackController} from './trackController.js';
import {isTrustedLocalOrigin,requireTrustedMutation} from '../middleware/trustedOrigin.js';
import {prisma} from '../database/client.js';
import {sessionConfigured,beginLogin,beginPhoneLogin,beginBotLogin,cancelLogin,loginStatus,consumeLogin,submitPhoneCode,submitLoginPassword,hashToken,disconnectSession} from '../services/telegramSession.js';
import {updateNowPlaying,refreshTelegramIntegration,clearNowPlayingOnExit} from '../services/telegramNowPlaying.js';
import {profileTrackWithArtwork} from '../services/profileArtwork.js';
export const cookies=(req:any)=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(s=>s.trim().split('=')));
const route=(fn:any)=>async(req:any,res:any,next:any)=>{try{await fn(req,res);}catch(e){next(e);}};
export const telegramLogin=Router();
telegramLogin.use(requireTrustedMutation);
telegramLogin.post('/start',route(async(req:any,res:any)=>{
  cancelLogin(cookies(req).oskolok_login);
  const id=await beginLogin(res.locals.userId||undefined);
  res.cookie('oskolok_login',id,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:300000,path:'/api/telegram/login'});res.json({data:{ok:true}});
}));
telegramLogin.post('/start-phone',route(async(req:any,res:any)=>{
  const phone=z.string().trim().min(1).max(30).parse(req.body?.phone);
  cancelLogin(cookies(req).oskolok_login);
  try{
    const id=await beginPhoneLogin(res.locals.userId||undefined,phone);
    res.cookie('oskolok_login',id,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:300000,path:'/api/telegram/login'});
    res.json({data:{ok:true}});
  }catch(error){const message=error instanceof Error?error.message:'Не удалось запросить код.';res.status(/Слишком много/.test(message)?429:400).json({error:{message}});}
}));
telegramLogin.post('/start-bot',route(async(req:any,res:any)=>{
  cancelLogin(cookies(req).oskolok_login);
  const origin=req.get('Origin')||`${req.protocol}://${req.get('host')}`;
  const appUrl=new URL(origin);
  if(!['http:','https:'].includes(appUrl.protocol))throw new Error('Неверный адрес приложения.');
  let tunnelUrl='';try{tunnelUrl=readFileSync('/tmp/oskolok-mobile-tunnel-url','utf8').trim();}catch{}
  if(![`${req.protocol}://${req.get('host')}`,env.CORS_ORIGIN,tunnelUrl].includes(appUrl.origin)&&!isTrustedLocalOrigin(req,appUrl.origin)){
    res.status(403).json({error:{message:'Откройте Осколок через кнопку бота.'}});return;
  }
  const id=beginBotLogin(res.locals.userId||undefined,appUrl.origin);
  res.cookie('oskolok_login',id,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:300000,path:'/api/telegram/login'});
  res.json({data:{url:`https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=connect_${id}`}});
}));
telegramLogin.get('/status',route(async(req:any,res:any)=>{
  const id=cookies(req).oskolok_login,l=id?loginStatus(id):undefined;
  res.setHeader('Cache-Control','no-store');
  if(!l){
    if(res.locals.userId&&await prisma.telegramConnection.findUnique({where:{userId:res.locals.userId},select:{userId:true}})){
      res.json({data:{state:'connected',configured:sessionConfigured}});return;
    }
    res.json({data:{state:'idle',configured:sessionConfigured}});return;
  }
  if(res.locals.userId&&((l.expected&&l.expected!==res.locals.userId)||(l.userId&&l.userId!==res.locals.userId))){res.status(403).json({error:{message:'Вход начат для другого аккаунта Telegram.'}});return;}
  if(l.state==='connected'&&l.userId){
    const token=randomBytes(32).toString('hex');await prisma.webSession.create({data:{tokenHash:hashToken(token),userId:l.userId,expiresAt:new Date(Date.now()+30*86400000)}});
    res.cookie('oskolok_session',token,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:30*86400000,path:'/'});consumeLogin(id);
  }
  res.json({data:{state:l.state,method:l.method,configured:sessionConfigured,error:l.error,passwordHint:l.passwordHint,codeViaApp:l.codeViaApp,botUrl:l.method==='bot'?`https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=connect_${id}`:undefined,qr:l.state==='qr'&&l.url?await QRCode.toDataURL(l.url,{width:256,margin:2}):undefined}});
}));
telegramLogin.post('/code',route(async(req:any,res:any)=>{
  const code=z.string().trim().min(1).max(64).parse(req.body?.code);
  try{submitPhoneCode(cookies(req).oskolok_login,code);res.json({data:{ok:true}});}
  catch(error){res.status(409).json({error:{message:error instanceof Error?error.message:'Запросите код заново.'}});}
}));
telegramLogin.post('/password',route(async(req:any,res:any)=>{
  const password=z.string().min(1).max(256).parse(req.body?.password);
  try{submitLoginPassword(cookies(req).oskolok_login,password);res.json({data:{ok:true}});}
  catch(error){res.status(409).json({error:{message:error instanceof Error?error.message:'Начните вход заново.'}});}
}));

const image=z.string().max(1200000).refine(v=>!v||/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)||/^https:\/\//.test(v));
export const profileRoutes=Router();
profileRoutes.use(requireTrustedMutation);
profileRoutes.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
profileRoutes.get('/',route(async(_req:any,res:any)=>{
  const userId=res.locals.userId,user=await prisma.user.findUnique({where:{id:userId}});
  const profile=await prisma.creatorProfile.findUnique({where:{userId}});
  const contributions=await prisma.lyricContribution.findMany({where:{userId},select:{id:true,trackId:true,trackTitle:true,artistName:true,credit:true,updatedAt:true},orderBy:{updatedAt:'desc'}});
  const submissions=await prisma.lyricSubmission.findMany({where:{userId},select:{id:true,trackId:true,trackTitle:true,artistName:true,credit:true,status:true,reviewNote:true,createdAt:true},orderBy:{createdAt:'desc'}});
  const music=await prisma.profileMusic.findMany({where:{userId},orderBy:{addedAt:'desc'}});
  const playlists=await prisma.profilePlaylist.findMany({where:{userId},orderBy:{addedAt:'desc'}});
  res.json({data:{userId,username:user?.username||null,telegramAvatarUrl:user?.avatarUrl||'',music:await Promise.all(music.map(m=>profileTrackWithArtwork(m.trackData))),playlists:playlists.map(p=>({id:p.id,playlistId:p.playlistId,title:p.title,artworkUrl:p.artworkUrl,tracks:JSON.parse(p.tracksData)})),currentTrack:profile?.playbackSeenAt&&Date.now()-profile.playbackSeenAt.getTime()<90000&&profile.currentTrackData?JSON.parse(profile.currentTrackData):null,telegramFullIntegration:profile?.telegramFullIntegration??true,telegramSyncError:profile?.telegramSyncError||null,submissions,displayName:profile?.displayName||user?.name||'Слушатель',avatarUrl:profile?.avatarUrl||user?.avatarUrl||'',bannerUrl:profile?.bannerUrl||'',bio:profile?.bio||'',contributions,telegramConnected:!!await prisma.telegramConnection.findUnique({where:{userId}}),telegramConfigured:sessionConfigured}});
}));
profileRoutes.patch('/',route(async(req:any,res:any)=>{const data=z.object({displayName:z.string().trim().min(1).max(80),bio:z.string().max(500),avatarUrl:image.optional(),bannerUrl:image.optional()}).parse(req.body);res.json({data:await prisma.creatorProfile.upsert({where:{userId:res.locals.userId},create:{userId:res.locals.userId,...data},update:data})});}));
profileRoutes.delete('/telegram',route(async(_req:any,res:any)=>{await clearNowPlayingOnExit(res.locals.userId);await disconnectSession(res.locals.userId);res.clearCookie('oskolok_session',{path:'/'});res.json({data:{ok:true}});}));
profileRoutes.post('/lyrics',route(async(req:any,res:any)=>{
  const data=lyricSubmissionSchema.parse(req.body);
  const {lines,...meta}=data,userId=res.locals.userId;
  const pending=await prisma.lyricSubmission.count({where:{userId,status:'pending'}});
  if(pending>=20){res.status(429).json({error:{message:'У вас уже 20 заявок на проверке. Дождитесь решения.'}});return;}
  const submission=await prisma.lyricSubmission.create({data:{userId,...meta,lyricsData:JSON.stringify(lines)}});
  res.status(201).json({data:{id:submission.id,status:submission.status}});
}));
profileRoutes.delete('/lyrics/:id',route(async(req:any,res:any)=>{
  const result=await prisma.lyricSubmission.deleteMany({where:{id:req.params.id,userId:res.locals.userId,status:'pending'}});
  if(!result.count){res.status(409).json({error:{message:'Можно отозвать только свою заявку, ожидающую проверки.'}});return;}
  res.json({data:{ok:true}});
}));
profileRoutes.post('/music',route(async(req:any,res:any)=>{
  const {trackId}=z.object({trackId:z.string().min(1).max(200)}).parse(req.body);
  const track=await trackController.resolveTrack(trackId);
  if(!track){res.status(404).json({error:{message:'Трек не найден.'}});return;}
  const userId=res.locals.userId;
  await prisma.profileMusic.upsert({where:{userId_trackId:{userId,trackId}},create:{userId,trackId,trackData:JSON.stringify(track)},update:{trackData:JSON.stringify(track)}});
  res.json({data:{ok:true}});
}));
profileRoutes.delete('/music/:trackId',route(async(req:any,res:any)=>{
  await prisma.profileMusic.deleteMany({where:{userId:res.locals.userId,trackId:req.params.trackId}});
  res.json({data:{ok:true}});
}));
profileRoutes.patch('/telegram-integration',route(async(req:any,res:any)=>{
  const enabled=z.object({enabled:z.boolean()}).parse(req.body).enabled,userId=res.locals.userId;
  await prisma.creatorProfile.upsert({where:{userId},create:{userId,displayName:'Слушатель',telegramFullIntegration:enabled},update:{telegramFullIntegration:enabled}});
  await refreshTelegramIntegration(userId);
  res.json({data:{enabled}});
}));
profileRoutes.put('/now-playing',route(async(req:any,res:any)=>{
  const {trackId,sessionId,heartbeat}=z.object({trackId:z.string().max(200).nullable(),sessionId:z.string().max(100).optional(),heartbeat:z.boolean().optional()}).parse(req.body);
  if(trackId&&!heartbeat&&!await trackController.resolveTrack(trackId)){res.status(404).json({error:{message:'Трек не найден.'}});return;}
  await updateNowPlaying(res.locals.userId,trackId,sessionId,heartbeat);
  res.json({data:{ok:true}});
}));
profileRoutes.post('/playlists',route(async(req:any,res:any)=>{
  const {playlistId}=z.object({playlistId:z.string().min(1).max(200)}).parse(req.body),userId=res.locals.userId;
  const playlist=await prisma.playlist.findFirst({where:{id:playlistId,userId},include:{tracks:{orderBy:{position:'asc'}}}});
  if(!playlist){res.status(404).json({error:{message:'Плейлист не найден.'}});return;}
  const snapshot=playlist.tracks.map(t=>JSON.parse(t.trackData));
  const artworkUrl=playlist.artworkUrl||snapshot.find(t=>t.artworkUrl)?.artworkUrl||null;
  await prisma.profilePlaylist.upsert({where:{userId_playlistId:{userId,playlistId}},create:{userId,playlistId,title:playlist.title,artworkUrl,tracksData:JSON.stringify(snapshot)},update:{title:playlist.title,artworkUrl,tracksData:JSON.stringify(snapshot)}});
  res.json({data:{ok:true}});
}));
profileRoutes.delete('/playlists/:playlistId',route(async(req:any,res:any)=>{
  await prisma.profilePlaylist.deleteMany({where:{userId:res.locals.userId,playlistId:req.params.playlistId}});
  res.json({data:{ok:true}});
}));
profileRoutes.post('/logout',route(async(req:any,res:any)=>{
  await clearNowPlayingOnExit(res.locals.userId);
  const token=cookies(req).oskolok_session;
  if(token)await prisma.webSession.deleteMany({where:{tokenHash:hashToken(token)}});
  res.clearCookie('oskolok_session',{path:'/'});res.json({data:{ok:true}});
}));
