import {Router,type Request,type Response,type NextFunction} from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import {createReadStream,statSync} from 'node:fs';
import {env} from '../config/env.js';
import {prisma} from '../database/client.js';
import {logger} from '../utils/logger.js';
import {validateTelegramInitData} from '../services/telegramAuth.js';
import {hashToken} from '../services/telegramSession.js';
import {checkBetaAccess} from '../services/telegramBeta.js';
import {
 applicationsForTelegramUser,BetaError,checkFormToken,createApplication,findByStatusToken,isBetaOpen,issueFormToken,
 publicView,reissueVerifyToken,TEXT_LIMITS,validateApplication,verifyStartParam,
} from '../services/betaApplications.js';
import {desktopUpdate,findDownloadableRelease,privateReleaseFile,releaseCatalog,signedDownloadPath,verifyDownloadSignature} from '../services/releases.js';

const fail=(res:Response,status:number,code:string,message:string,fields?:Record<string,string>)=>res.status(status).json({error:{code,message,...(fields?{fields}:{})}});
const GENERIC='Не удалось отправить заявку. Обнови страницу и попробуй ещё раз.';
const limited=(windowMs:number,limit:number,reason:string)=>rateLimit({windowMs,limit,standardHeaders:'draft-7',legacyHeaders:false,handler:(_req,res)=>{
 logger.warn({event:'beta.suspicious',reason},'Beta endpoint rate limited');
 fail(res,429,'TOO_MANY_REQUESTS','Слишком много попыток. Подожди немного и попробуй снова.');
}});
const botLink=(verifyToken:string)=>`https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${verifyStartParam(verifyToken)}`;
const readCookie=(req:Request,name:string)=>String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1);
/** The signed-in Telegram account (site cookie or Mini App signature), if any. Never a typed username. */
async function sessionUser(req:Request):Promise<{userId:string;username?:string|null}|null>{
 const auth=req.get('Authorization');
 if(auth?.startsWith('tma ')){
  try{const u=validateTelegramInitData(auth.slice(4),env.TELEGRAM_BOT_TOKEN);return {userId:`telegram:${u.id}`,username:u.username};}catch{return null;}
 }
 const token=readCookie(req,'oskolok_session');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
 const session=await prisma.webSession.findUnique({where:{tokenHash:hashToken(token)}});
 if(!session||session.expiresAt<=new Date())return null;
 const user=await prisma.user.findUnique({where:{id:session.userId},select:{id:true,username:true}});
 return user?{userId:user.id,username:user.username}:null;
}
const tokenFrom=(req:Request)=>typeof req.body?.statusToken==='string'?req.body.statusToken.trim():'';
const noStore=(res:Response)=>res.setHeader('Cache-Control','no-store');

/** Public site routes: mounted before the Telegram identity gate. */
export const sitePublicRoutes=Router();
const smallJson=express.json({limit:'16kb'});

sitePublicRoutes.get('/beta',async(_req,res,next)=>{
 try{noStore(res);res.json({data:{open:await isBetaOpen(),formToken:issueFormToken(),botUsername:env.TELEGRAM_BOT_USERNAME,channelUrl:'https://t.me/oskolokch',limits:TEXT_LIMITS}});}catch(e){next(e);}
});

sitePublicRoutes.post('/beta/applications',limited(15*60000,6,'ip_limit'),smallJson,async(req,res,next)=>{
 try{
  noStore(res);
  const body=req.body&&typeof req.body==='object'?req.body:{};
  // Honeypot and form ticket share one neutral answer: the page never learns which check failed.
  if(typeof body.website==='string'&&body.website.trim()){logger.warn({event:'beta.suspicious',reason:'honeypot'},'Beta honeypot filled');fail(res,400,'SUBMIT_FAILED',GENERIC);return;}
  const ticket=checkFormToken(body.formToken);
  if(ticket!=='ok'){logger.warn({event:'beta.suspicious',reason:`form_${ticket}`},'Beta form ticket rejected');fail(res,400,'SUBMIT_FAILED',ticket==='expired'?'Страница была открыта слишком долго. Обнови её и отправь заявку снова.':GENERIC);return;}
  if(!await isBetaOpen()){fail(res,403,'BETA_CLOSED','Набор на бета-тестирование временно закрыт.');return;}
  const checked=validateApplication(body);
  if('fields' in checked){fail(res,400,'INVALID_APPLICATION','Проверь поля формы.',checked.fields);return;}
  const created=await createApplication(checked.value,{ip:req.ip||req.socket.remoteAddress||'',userAgent:String(req.get('User-Agent')||'')});
  res.status(201).json({data:{number:created.number,statusToken:created.statusToken,verifyUrl:botLink(created.verifyToken),verifyExpiresAt:created.verifyExpiresAt.toISOString()}});
 }catch(e){if(e instanceof BetaError){fail(res,e.status,e.code,e.message,e.fields);return;}next(e);}
});

sitePublicRoutes.post('/beta/status',limited(15*60000,60,'status_limit'),smallJson,async(req,res,next)=>{
 try{
  noStore(res);
  const app=await findByStatusToken(tokenFrom(req));
  if(!app){fail(res,404,'APPLICATION_NOT_FOUND','Заявка не найдена. Проверь ссылку на статус или войди через Telegram.');return;}
  res.json({data:{application:publicView(app)}});
 }catch(e){next(e);}
});

sitePublicRoutes.post('/beta/status/verify-link',limited(15*60000,10,'verify_link_limit'),smallJson,async(req,res,next)=>{
 try{
  noStore(res);
  const {verifyToken,verifyExpiresAt}=await reissueVerifyToken(tokenFrom(req));
  res.json({data:{verifyUrl:botLink(verifyToken),verifyExpiresAt:verifyExpiresAt.toISOString()}});
 }catch(e){if(e instanceof BetaError){fail(res,e.status,e.code,e.message);return;}next(e);}
});

/** Applications confirmed by the signed-in Telegram account, plus whether that account already has beta access. */
sitePublicRoutes.get('/beta/mine',async(req,res,next)=>{
 try{
  noStore(res);
  const user=await sessionUser(req);
  if(!user){res.json({data:{signedIn:false,applications:[],betaAllowed:false}});return;}
  const [apps,betaAllowed]=await Promise.all([applicationsForTelegramUser(user.userId),checkBetaAccess(user.userId,user.username)]);
  res.json({data:{signedIn:true,betaAllowed,applications:apps.filter(a=>a.status!=='duplicate').map(a=>publicView(a))}});
 }catch(e){next(e);}
});

/** Desktop shell asks whether a newer build of its variant exists (over-the-air updates). */
sitePublicRoutes.get('/desktop-update',async(req,res,next)=>{
 try{
  const q=req.query as Record<string,unknown>,str=(v:unknown)=>typeof v==='string'?v.slice(0,40):'';
  res.setHeader('Cache-Control','no-cache');
  res.json({data:await desktopUpdate(str(q.platform),str(q.variant),str(q.version))});
 }catch(e){next(e);}
});
sitePublicRoutes.get('/releases',async(req,res,next)=>{
 try{
  const user=await sessionUser(req).catch(()=>null);
  const betaAllowed=user?await checkBetaAccess(user.userId,user.username):false;
  res.setHeader('Cache-Control','no-cache');
  res.json({data:{platforms:await releaseCatalog(),betaAllowed,signedIn:!!user}});
 }catch(e){next(e);}
});

/** The signature is the authorisation here: issued only to beta testers, valid ten minutes. */
sitePublicRoutes.get('/releases/:id/file',async(req:Request,res:Response,next:NextFunction)=>{
 try{
  if(!verifyDownloadSignature(req.params.id,req.query as Record<string,unknown>)){fail(res,403,'LINK_EXPIRED','Ссылка на загрузку устарела. Получи новую на странице загрузок.');return;}
  const release=await findDownloadableRelease(req.params.id);
  const file=release&&release.storage==='private'?privateReleaseFile(release):null;
  let size=0;
  try{if(file)size=statSync(file).size;}catch{/* Missing file is reported below. */}
  if(!release||!file||!size){fail(res,404,'FILE_NOT_FOUND','Файл сборки недоступен.');return;}
  logger.info({event:'release.download',release:release.id,platform:release.platform},'Private build downloaded');
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Content-Type','application/octet-stream');
  res.setHeader('Content-Length',String(size));
  res.setHeader('Content-Disposition',`attachment; filename="${release.fileName}"`);
  res.setHeader('X-Content-Type-Options','nosniff');
  createReadStream(file).on('error',next).pipe(res);
 }catch(e){next(e);}
});

/** Behind userIdentity: only signed-in listeners with beta access get here. */
export const siteProtectedRoutes=Router();
siteProtectedRoutes.post('/releases/:id/link',limited(15*60000,30,'download_link_limit'),async(req,res,next)=>{
 try{
  noStore(res);
  const release=await findDownloadableRelease(req.params.id);
  if(!release){fail(res,404,'RELEASE_NOT_FOUND','Сборка не найдена.');return;}
  if(release.storage!=='private'){res.json({data:{url:`/downloads/${release.fileName}`,expiresAt:null}});return;}
  if(!privateReleaseFile(release)){fail(res,404,'FILE_NOT_FOUND','Файл сборки ещё не загружен на сервер.');return;}
  res.json({data:signedDownloadPath(release.id,res.locals.userId)});
 }catch(e){next(e);}
});
