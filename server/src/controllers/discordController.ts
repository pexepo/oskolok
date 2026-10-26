/* Discord account: linked to the Осколок (Telegram) account, then usable to sign in on the site.
   The browser gets a short-lived token from Discord's implicit grant (scope identify) and hands it over once;
   the server checks with Discord that the token was issued to Осколок's own application, reads the user and
   forgets the token. Nothing secret is stored: only the Discord id, name and avatar. */
import {Router,type Request,type Response} from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import {randomBytes} from 'node:crypto';
import {prisma} from '../database/client.js';
import {env} from '../config/env.js';
import {hashToken} from '../services/telegramSession.js';
import {logger} from '../utils/logger.js';

export interface DiscordUser {id:string;username:string;globalName?:string;avatarUrl?:string}
const LINK='discord',INDEX='discord-login';
const indexId=(discordId:string)=>`discord-id:${discordId}`;
const fail=(res:Response,status:number,code:string,message:string)=>res.status(status).json({error:{code,message}});

/** The Discord user behind a token, only if the token belongs to Осколок's application. */
export async function discordUserFromToken(accessToken:string,fetchImpl:typeof fetch=fetch):Promise<DiscordUser|null>{
 if(!/^[A-Za-z0-9._-]{20,200}$/.test(accessToken))return null;
 const response=await fetchImpl('https://discord.com/api/v10/oauth2/@me',{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(8000)}).catch(()=>null);
 if(!response?.ok)return null;
 const data=await response.json().catch(()=>null) as {application?:{id?:string};scopes?:string[];user?:{id?:string;username?:string;global_name?:string|null;avatar?:string|null}}|null;
 const u=data?.user;
 if(String(data?.application?.id||'')!==env.DISCORD_CLIENT_ID||!data?.scopes?.includes('identify')||!u?.id||!u.username)return null;
 return {id:String(u.id),username:String(u.username),globalName:u.global_name||undefined,avatarUrl:u.avatar?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`:undefined};
}

export async function linkedDiscord(userId:string):Promise<DiscordUser|null>{
 const row=await prisma.musicAccountToken.findUnique({where:{userId_provider:{userId,provider:LINK}}}).catch(()=>null);
 try{return row?JSON.parse(row.encryptedData) as DiscordUser:null;}catch{return null;}
}

/** Links a Discord account; returns an error message when it already belongs to someone else. */
async function linkDiscord(userId:string,discord:DiscordUser):Promise<string|null>{
 const taken=await prisma.musicAccountToken.findUnique({where:{id:indexId(discord.id)}});
 if(taken&&taken.userId!==userId)return 'Этот Discord уже привязан к другому аккаунту Осколка.';
 const data=JSON.stringify(discord);
 await prisma.$transaction([
  prisma.musicAccountToken.deleteMany({where:{userId,provider:INDEX}}),
  prisma.musicAccountToken.upsert({where:{userId_provider:{userId,provider:LINK}},create:{id:`${userId}:${LINK}`,userId,provider:LINK,encryptedData:data},update:{encryptedData:data}}),
  prisma.musicAccountToken.create({data:{id:indexId(discord.id),userId,provider:INDEX,encryptedData:'{}'}}),
 ]);
 return null;
}

/* Attempts live on the server, so Discord may send the browser back anywhere (the system browser for the desktop
   app): that browser completes the attempt, and the client that started it picks up the result by polling. */
type Attempt={mode:'link'|'login';userId?:string;expires:number;result?:{ok:boolean;message?:string;userId?:string;linked?:DiscordUser}};
const attempts=new Map<string,Attempt>();
function newAttempt(mode:Attempt['mode'],userId?:string){
 const now=Date.now();for(const [k,a] of attempts)if(a.expires<now)attempts.delete(k);
 const state=`osk-discord-${mode}-${randomBytes(18).toString('hex')}`;
 attempts.set(state,{mode,userId,expires:now+10*60_000});
 return state;
}
const live=(state:unknown)=>{const a=typeof state==='string'?attempts.get(state):undefined;return a&&a.expires>Date.now()?a:undefined;};
async function newSession(res:Response,req:Request,userId:string){
 const token=randomBytes(32).toString('hex');
 await prisma.webSession.create({data:{tokenHash:hashToken(token),userId,expiresAt:new Date(Date.now()+30*86400000)}});
 res.cookie('oskolok_session',token,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:30*86400000,path:'/'});
}

const tokenOf=(req:Request)=>typeof req.body?.accessToken==='string'?req.body.accessToken.trim():'';
const limited=rateLimit({windowMs:15*60000,limit:20,standardHeaders:'draft-7',legacyHeaders:false});

/** Before the identity gate: sign in with an already linked Discord account. */
export const discordPublicRoutes=Router();
discordPublicRoutes.get('/config',(_req,res)=>{res.json({data:{clientId:env.DISCORD_CLIENT_ID}});});
discordPublicRoutes.post('/login',limited,express.json({limit:'4kb'}),async(req,res,next)=>{
 try{
  res.setHeader('Cache-Control','no-store');
  const discord=await discordUserFromToken(tokenOf(req));
  if(!discord){fail(res,401,'DISCORD_TOKEN_INVALID','Discord не подтвердил вход. Попробуйте ещё раз.');return;}
  const row=await prisma.musicAccountToken.findUnique({where:{id:indexId(discord.id)}});
  const user=row?await prisma.user.findUnique({where:{id:row.userId}}):null;
  if(!user){fail(res,404,'DISCORD_NOT_LINKED','Этот Discord ещё не привязан. Войдите через Telegram и подключите Discord в настройках — потом вход через Discord заработает.');return;}
  await newSession(res,req,user.id);
  logger.info({event:'discord.login',userId:user.id},'Signed in with Discord');
  res.json({data:{ok:true}});
 }catch(e){next(e);}
});

discordPublicRoutes.post('/login/start',limited,(_req,res)=>{res.json({data:{state:newAttempt('login')}});});
/** The browser Discord returned to hands over the token for an attempt (any browser: no session needed). */
discordPublicRoutes.post('/complete',limited,express.json({limit:'4kb'}),async(req,res,next)=>{
 try{
  res.setHeader('Cache-Control','no-store');
  const attempt=live(req.body?.state);
  if(!attempt||attempt.result){fail(res,410,'DISCORD_ATTEMPT_EXPIRED','Ссылка устарела. Начните подключение Discord заново.');return;}
  const discord=await discordUserFromToken(tokenOf(req));
  if(!discord){attempt.result={ok:false,message:'Discord не подтвердил вход. Попробуйте ещё раз.'};fail(res,401,'DISCORD_TOKEN_INVALID',attempt.result.message!);return;}
  if(attempt.mode==='link'){
   const taken=await linkDiscord(attempt.userId!,discord);
   attempt.result=taken?{ok:false,message:taken}:{ok:true,linked:discord};
  }else{
   const row=await prisma.musicAccountToken.findUnique({where:{id:indexId(discord.id)}});
   const user=row?await prisma.user.findUnique({where:{id:row.userId}}):null;
   attempt.result=user?{ok:true,userId:user.id,linked:discord}:{ok:false,message:'Этот Discord ещё не привязан. Войдите через Telegram и подключите Discord в настройках — потом вход через Discord заработает.'};
  }
  res.json({data:{mode:attempt.mode,ok:attempt.result.ok,message:attempt.result.message,name:discord.globalName||discord.username}});
 }catch(e){next(e);}
});
/** The client that started an attempt asks for its result; a finished sign-in gets its session here, once. */
discordPublicRoutes.get('/status',async(req,res,next)=>{
 try{
  res.setHeader('Cache-Control','no-store');
  const state=String(req.query.state||''),attempt=live(state);
  if(!attempt){res.json({data:{status:'expired'}});return;}
  if(!attempt.result){res.json({data:{status:'pending'}});return;}
  attempts.delete(state);
  if(attempt.result.ok&&attempt.mode==='login'&&attempt.result.userId){await newSession(res,req,attempt.result.userId);logger.info({event:'discord.login',userId:attempt.result.userId},'Signed in with Discord');}
  res.json({data:{status:attempt.result.ok?'done':'failed',mode:attempt.mode,message:attempt.result.message,linked:attempt.result.linked}});
 }catch(e){next(e);}
});

/** After the identity gate: the signed-in listener links or unlinks their Discord. */
export const discordRoutes=Router();
discordRoutes.get('/discord',async(_req,res,next)=>{try{res.json({data:{clientId:env.DISCORD_CLIENT_ID,linked:await linkedDiscord(res.locals.userId)}});}catch(e){next(e);}});
discordRoutes.post('/discord/link',limited,express.json({limit:'4kb'}),async(req,res,next)=>{
 try{
  const discord=await discordUserFromToken(tokenOf(req));
  if(!discord){fail(res,401,'DISCORD_TOKEN_INVALID','Discord не подтвердил подключение. Попробуйте ещё раз.');return;}
  const taken=await linkDiscord(res.locals.userId as string,discord);
  if(taken){fail(res,409,'DISCORD_TAKEN',taken);return;}
  res.json({data:{linked:discord}});
 }catch(e){next(e);}
});
/** Starts a link that may finish in another browser (the desktop app opens Discord in the system browser). */
discordRoutes.post('/discord/link/start',limited,(_req,res)=>{res.json({data:{state:newAttempt('link',res.locals.userId as string)}});});
discordRoutes.delete('/discord/link',async(_req,res,next)=>{
 try{const userId=res.locals.userId as string;await prisma.musicAccountToken.deleteMany({where:{userId,provider:{in:[LINK,INDEX]}}});res.json({data:{linked:null}});}catch(e){next(e);}
});
