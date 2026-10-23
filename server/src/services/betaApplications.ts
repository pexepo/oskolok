import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {Prisma} from '@prisma/client';
import {prisma} from '../database/client.js';
import {logger} from '../utils/logger.js';

/** Platforms an applicant may ask for. Order is the order shown on the site and in the bot. */
export const BETA_PLATFORMS=['windows','macos','linux','android','ios','web'] as const;
export type BetaPlatform=typeof BETA_PLATFORMS[number];
export const PLATFORM_LABELS:Record<BetaPlatform,string>={windows:'Windows',macos:'macOS',linux:'Linux',android:'Android',ios:'iOS',web:'Web'};
export type BetaStatus='pending'|'approved'|'rejected'|'duplicate';
export const STATUS_LABELS:Record<BetaStatus,string>={pending:'Ожидает решения',approved:'Одобрена',rejected:'Отклонена',duplicate:'Повтор заявки'};
export const TEXT_LIMITS={min:10,max:1000};
export const VERIFY_TTL_MS=30*60*1000;
const FORM_MIN_AGE_MS=3000,FORM_MAX_AGE_MS=6*3600*1000;

export class BetaError extends Error{
 constructor(public status:number,public code:string,message:string,public fields?:Record<string,string>){super(message);this.name='BetaError';}
}

const privateDir=()=>path.resolve(process.env.OSKOLOK_PRIVATE_DIR||'server/data/private');
const secrets=new Map<string,Buffer>();
/** A random per-server key kept next to the other private state; never derived from the bot token. */
export function siteSecret(name:string):Buffer{
 const cached=secrets.get(name);if(cached)return cached;
 const dir=privateDir(),file=path.join(dir,`${name}.key`);
 mkdirSync(dir,{recursive:true,mode:0o700});
 let key:Buffer;
 if(existsSync(file))key=Buffer.from(readFileSync(file,'utf8').trim(),'hex');
 else{key=randomBytes(32);writeFileSync(file,key.toString('hex'),{mode:0o600,flag:'wx'});}
 if(key.length<32)throw new Error(`${name}.key is too short`);
 secrets.set(name,key);return key;
}
export const hashSecret=(value:string)=>createHash('sha256').update(value).digest('hex');
const token=(bytes=24)=>randomBytes(bytes).toString('base64url');

/** Accepts "@Name", "name", "t.me/name" or "https://t.me/name"; returns the lowercase username or null. */
export function normalizeTelegramUsername(input:unknown):string|null{
 if(typeof input!=='string')return null;
 let value=input.normalize('NFKC').trim().replace(/\s+/g,'');
 value=value.replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i,'').replace(/^@+/,'').replace(/[/?#].*$/,'');
 value=value.toLowerCase();
 // Telegram: latin letters, digits, underscore; starts with a letter, no trailing or doubled underscore.
 // Four-letter names exist (Fragment collectibles), the regular minimum is five.
 if(!/^[a-z][a-z0-9_]{3,31}$/.test(value)||value.endsWith('_')||value.includes('__'))return null;
 return value;
}

/** Stores plain text: no markup is interpreted anywhere (React escapes, the bot sends entities). */
export function cleanText(input:unknown):string{
 if(typeof input!=='string')return '';
 return input.normalize('NFC')
  .replace(/\r\n?/g,'\n')
  // Control characters, bidi overrides and zero-width tricks are dropped; newlines stay.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,'')
  .replace(/\t/g,' ')
  .replace(/[ \u00A0]{2,}/g,' ')
  .replace(/\n{3,}/g,'\n\n')
  .trim();
}

export type ApplicationInput={telegramUsername:string;purpose:string;about:string;platforms:BetaPlatform[]};
export function validateApplication(body:unknown):{value:ApplicationInput}|{fields:Record<string,string>}{
 const raw=(body&&typeof body==='object'?body:{}) as Record<string,unknown>;
 const fields:Record<string,string>={};
 const username=normalizeTelegramUsername(raw.telegramUsername);
 if(!String(raw.telegramUsername??'').trim())fields.telegramUsername='Укажи Telegram username.';
 else if(!username)fields.telegramUsername='Username — от 5 до 32 латинских букв, цифр и _, начинается с буквы.';
 const purpose=cleanText(raw.purpose),about=cleanText(raw.about);
 for(const [key,value,label] of [['purpose',purpose,'Расскажи, зачем тебе бета'],['about',about,'Расскажи немного о себе']] as const){
  if(!value)fields[key]=`${label}.`;
  else if([...value].length<TEXT_LIMITS.min)fields[key]=`Напиши чуть подробнее — хотя бы ${TEXT_LIMITS.min} символов.`;
  else if([...value].length>TEXT_LIMITS.max)fields[key]=`Не больше ${TEXT_LIMITS.max} символов.`;
 }
 const list=Array.isArray(raw.platforms)?raw.platforms:[];
 const platforms=[...new Set(list.filter((p):p is BetaPlatform=>typeof p==='string'&&(BETA_PLATFORMS as readonly string[]).includes(p)))];
 if(list.length>BETA_PLATFORMS.length||platforms.length!==list.length)fields.platforms='Выбери платформы из списка.';
 if(raw.consent!==true)fields.consent='Нужно согласие на обработку данных заявки.';
 if(Object.keys(fields).length)return {fields};
 return {value:{telegramUsername:username!,purpose,about,platforms:BETA_PLATFORMS.filter(p=>platforms.includes(p))}};
}

/* ── Anti-spam ────────────────────────────────────────────────────────────── */

/** A signed, single-use form ticket: proves the form was loaded from the site a few seconds before submitting. */
export function issueFormToken(now=Date.now()):string{
 const body=`${now.toString(36)}.${token(12)}`;
 return `${body}.${createHmac('sha256',siteSecret('site-form')).update(body).digest('base64url')}`;
}
const usedForms=new Map<string,number>();
export function checkFormToken(value:unknown,now=Date.now()):'ok'|'invalid'|'early'|'expired'|'reused'{
 if(typeof value!=='string'||value.length>120)return 'invalid';
 const [issued,nonce,signature]=value.split('.');
 if(!issued||!nonce||!signature)return 'invalid';
 const expected=createHmac('sha256',siteSecret('site-form')).update(`${issued}.${nonce}`).digest();
 const given=Buffer.from(signature,'base64url');
 if(given.length!==expected.length||!timingSafeEqual(given,expected))return 'invalid';
 const age=now-parseInt(issued,36);
 if(!Number.isFinite(age)||age<FORM_MIN_AGE_MS)return 'early';
 if(age>FORM_MAX_AGE_MS)return 'expired';
 for(const [k,at] of usedForms)if(now-at>FORM_MAX_AGE_MS)usedForms.delete(k);
 if(usedForms.has(nonce))return 'reused';
 usedForms.set(nonce,now);
 return 'ok';
}
/** IP + User-Agent, keyed with a server secret: counts repeat senders without storing their address. */
export const sourceHash=(ip:string,userAgent:string)=>createHmac('sha256',siteSecret('site-source')).update(`${ip}\n${userAgent.slice(0,300)}`).digest('hex').slice(0,40);

export const LIMITS={perSourceDay:4,perUsernameDay:3,unverifiedPerHour:120};
const suspicious=(reason:string,extra:Record<string,unknown>={})=>logger.warn({event:'beta.suspicious',reason,...extra},'Suspicious beta application');

/* ── Settings ─────────────────────────────────────────────────────────────── */

export async function isBetaOpen():Promise<boolean>{
 const row=await prisma.siteSetting.findUnique({where:{key:'beta.open'}});
 return row?row.value!=='false':true;
}
export async function setBetaOpen(open:boolean,actor:string):Promise<boolean>{
 const before=await isBetaOpen();
 await prisma.siteSetting.upsert({where:{key:'beta.open'},create:{key:'beta.open',value:String(open),updatedBy:actor},update:{value:String(open),updatedBy:actor}});
 logger.info({event:'beta.recruitment',open,actor},'Beta recruitment switched');
 return before!==open;
}

/* ── Applications ─────────────────────────────────────────────────────────── */

type Tx=Prisma.TransactionClient;
const event=(tx:Tx,applicationId:number,type:string,actor='',data:Record<string,unknown>={})=>tx.betaApplicationEvent.create({data:{applicationId,type,actor,data:JSON.stringify(data)}});
export const displayNumber=(id:number)=>`#${String(id).padStart(6,'0')}`;
export const verifyStartParam=(verifyToken:string)=>`beta_${verifyToken}`;

export type CreatedApplication={id:number;number:string;statusToken:string;verifyToken:string;verifyExpiresAt:Date};
export async function createApplication(input:ApplicationInput,source:{ip:string;userAgent:string},now=new Date()):Promise<CreatedApplication>{
 if(!await isBetaOpen())throw new BetaError(403,'BETA_CLOSED','Набор на бета-тестирование временно закрыт.');
 const src=sourceHash(source.ip,source.userAgent),day=new Date(now.getTime()-86400000),hour=new Date(now.getTime()-3600000);
 const [bySource,byUsername,unverified]=await Promise.all([
  prisma.betaApplication.count({where:{sourceHash:src,createdAt:{gte:day}}}),
  prisma.betaApplication.count({where:{telegramUsername:input.telegramUsername,telegramUserId:null,createdAt:{gte:day}}}),
  prisma.betaApplication.count({where:{telegramUserId:null,createdAt:{gte:hour}}}),
 ]);
 if(bySource>=LIMITS.perSourceDay||byUsername>=LIMITS.perUsernameDay||unverified>=LIMITS.unverifiedPerHour){
  suspicious(bySource>=LIMITS.perSourceDay?'source_limit':byUsername>=LIMITS.perUsernameDay?'username_limit':'global_unverified_limit',{source:src.slice(0,12)});
  throw new BetaError(429,'TOO_MANY_APPLICATIONS','Слишком много заявок за короткое время. Попробуй позже или проверь статус уже отправленной заявки.');
 }
 const statusToken=token(24),verifyToken=token(24),verifyExpiresAt=new Date(now.getTime()+VERIFY_TTL_MS);
 const created=await prisma.$transaction(async tx=>{
  const row=await tx.betaApplication.create({data:{telegramUsername:input.telegramUsername,purpose:input.purpose,about:input.about,platforms:JSON.stringify(input.platforms),statusTokenHash:hashSecret(statusToken),verifyTokenHash:hashSecret(verifyToken),verifyExpiresAt,sourceHash:src}});
  await event(tx,row.id,'created','site',{platforms:input.platforms});
  return row;
 });
 logger.info({event:'beta.application.created',id:created.id},'Beta application created');
 return {id:created.id,number:displayNumber(created.id),statusToken,verifyToken,verifyExpiresAt};
}

/** A new one-time confirmation link; the previous one stops working. Only for applications still waiting for Telegram. */
export async function reissueVerifyToken(statusToken:string,now=new Date()):Promise<{verifyToken:string;verifyExpiresAt:Date}>{
 const app=await findByStatusToken(statusToken);
 if(!app)throw new BetaError(404,'APPLICATION_NOT_FOUND','Заявка не найдена. Проверь ссылку на статус.');
 if(app.telegramUserId||app.status!=='pending')throw new BetaError(409,'ALREADY_VERIFIED','Telegram для этой заявки уже подтверждён.');
 const verifyToken=token(24),verifyExpiresAt=new Date(now.getTime()+VERIFY_TTL_MS);
 const updated=await prisma.betaApplication.updateMany({where:{id:app.id,telegramUserId:null,status:'pending'},data:{verifyTokenHash:hashSecret(verifyToken),verifyExpiresAt}});
 if(!updated.count)throw new BetaError(409,'ALREADY_VERIFIED','Telegram для этой заявки уже подтверждён.');
 return {verifyToken,verifyExpiresAt};
}

type BetaApplicationRow=Awaited<ReturnType<typeof prisma.betaApplication.findUniqueOrThrow>>;
export type VerifyResult=
 |{kind:'verified';application:BetaApplicationRow}
 |{kind:'duplicate';existing:BetaApplicationRow}
 |{kind:'expired'}|{kind:'invalid'};

/** Binds the Telegram account that opened the bot link. The link is the proof, the typed username never is. */
export async function verifyApplication(verifyToken:string,user:{id:number;username?:string|null},now=new Date()):Promise<VerifyResult>{
 if(!/^[A-Za-z0-9_-]{20,64}$/.test(verifyToken))return {kind:'invalid'};
 const telegramUserId=`telegram:${user.id}`,verifiedUsername=user.username?.toLowerCase()||null,hash=hashSecret(verifyToken);
 const app=await prisma.betaApplication.findUnique({where:{verifyTokenHash:hash}});
 if(!app||app.telegramUserId)return {kind:'invalid'};
 if(!app.verifyExpiresAt||app.verifyExpiresAt<now)return {kind:'expired'};
 const existing=await prisma.betaApplication.findFirst({where:{telegramUserId,status:{in:['pending','approved']},id:{not:app.id}},orderBy:{id:'desc'}});
 if(existing)return markDuplicate(app.id,hash,telegramUserId,verifiedUsername,existing);
 try{
  const row=await prisma.$transaction(async tx=>{
   // Compare-and-set on the token: a second tap of the same link cannot bind another account.
   const claimed=await tx.betaApplication.updateMany({where:{id:app.id,verifyTokenHash:hash,telegramUserId:null},data:{telegramUserId,verifiedUsername,verifiedAt:now,verifyTokenHash:null,verifyExpiresAt:null,adminNotifyState:app.status==='pending'?'pending':'none'}});
   if(!claimed.count)return null;
   await event(tx,app.id,'verified',telegramUserId,{usernameMatches:verifiedUsername===app.telegramUsername});
   return tx.betaApplication.findUniqueOrThrow({where:{id:app.id}});
  });
  if(!row)return {kind:'invalid'};
  logger.info({event:'beta.application.verified',id:row.id},'Beta application confirmed in Telegram');
  return {kind:'verified',application:row};
 }catch(error){
  // The partial unique index lost a race against another confirmation of the same account.
  if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'){
   const winner=await prisma.betaApplication.findFirst({where:{telegramUserId,status:{in:['pending','approved']}},orderBy:{id:'desc'}});
   if(winner)return markDuplicate(app.id,hash,telegramUserId,verifiedUsername,winner);
  }
  throw error;
 }
}
async function markDuplicate(id:number,hash:string,telegramUserId:string,verifiedUsername:string|null,existing:BetaApplicationRow):Promise<VerifyResult>{
 await prisma.$transaction(async tx=>{
  const claimed=await tx.betaApplication.updateMany({where:{id,verifyTokenHash:hash,telegramUserId:null},data:{status:'duplicate',telegramUserId,verifiedUsername,verifiedAt:new Date(),verifyTokenHash:null,verifyExpiresAt:null}});
  if(claimed.count)await event(tx,id,'duplicate',telegramUserId,{existing:existing.id});
 });
 return {kind:'duplicate',existing};
}

export type Decision='approved'|'rejected';
export type DecisionResult={changed:true;application:BetaApplicationRow}|{changed:false;application:BetaApplicationRow|null;reason:'not_found'|'already_decided'|'not_verified'};

/** Atomic decision: one compare-and-set from pending, history row and beta access in the same transaction.
 * Telegram messages are updated afterwards; the database is the source of truth either way. */
export async function decideApplication(id:number,decision:Decision,actor:string,now=new Date()):Promise<DecisionResult>{
 return prisma.$transaction(async tx=>{
  const app=await tx.betaApplication.findUnique({where:{id}});
  if(!app)return {changed:false,application:null,reason:'not_found'} as const;
  if(app.status!=='pending')return {changed:false,application:app,reason:'already_decided'} as const;
  if(!app.telegramUserId)return {changed:false,application:app,reason:'not_verified'} as const;
  const claimed=await tx.betaApplication.updateMany({where:{id,status:'pending'},data:{status:decision,reviewedAt:now,reviewedBy:actor,userNotifyState:'pending',userNotifyAttempts:0}});
  if(!claimed.count)return {changed:false,application:await tx.betaApplication.findUnique({where:{id}}),reason:'already_decided'} as const;
  await event(tx,id,decision,actor);
  if(decision==='approved')await grantAccess(tx,app.telegramUserId,app.verifiedUsername);
  return {changed:true,application:await tx.betaApplication.findUniqueOrThrow({where:{id}})} as const;
 });
}

/** Grants the existing BetaAccess record to an immutable Telegram ID. The application sends its own
 * notification, so the older invitation notifier is marked as already delivered. */
async function grantAccess(tx:Tx,telegramUserId:string,verifiedUsername:string|null){
 const bound=await tx.betaAccess.findUnique({where:{telegramUserId}});
 if(bound){await tx.betaAccess.update({where:{id:bound.id},data:{enabled:true,approvalNotificationState:'sent'}});return;}
 const username=verifiedUsername&&/^[a-z0-9_]{4,32}$/.test(verifiedUsername)?verifiedUsername:null;
 if(username){
  const invite=await tx.betaAccess.findUnique({where:{username}});
  if(invite&&!invite.telegramUserId){await tx.betaAccess.update({where:{id:invite.id},data:{telegramUserId,enabled:true,approvalNotificationState:'sent'}});return;}
  if(!invite){await tx.betaAccess.create({data:{username,telegramUserId,enabled:true,approvalNotificationState:'sent'}});return;}
 }
 // No username, or the username row belongs to someone else: a placeholder key keeps the row unique.
 await tx.betaAccess.create({data:{username:`id${telegramUserId.slice(9)}`,telegramUserId,enabled:true,approvalNotificationState:'sent'}});
}

export async function setApplicationNote(id:number,field:'adminComment'|'rejectionReason',text:string,actor:string){
 const value=cleanText(text).slice(0,500)||null;
 return prisma.$transaction(async tx=>{
  const app=await tx.betaApplication.findUnique({where:{id}});
  if(!app)return null;
  await tx.betaApplication.update({where:{id},data:{[field]:value}});
  await event(tx,id,field==='adminComment'?'comment':'reason',actor,{cleared:!value});
  return tx.betaApplication.findUniqueOrThrow({where:{id}});
 });
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

export const findByStatusToken=(statusToken:string)=>/^[A-Za-z0-9_-]{20,64}$/.test(statusToken)?prisma.betaApplication.findUnique({where:{statusTokenHash:hashSecret(statusToken)}}):Promise.resolve(null);
export const parsePlatforms=(value:string):BetaPlatform[]=>{try{const list=JSON.parse(value);return Array.isArray(list)?BETA_PLATFORMS.filter(p=>list.includes(p)):[];}catch{return [];}};

/** What an applicant may see about their own application. No internal comment, no reviewer, no ID of other people. */
export function publicView(app:BetaApplicationRow,now=new Date()){
 const verified=!!app.telegramUserId;
 return {
  number:displayNumber(app.id),status:app.status as BetaStatus,verified,
  telegramUsername:app.telegramUsername,platforms:parsePlatforms(app.platforms),
  createdAt:app.createdAt.toISOString(),reviewedAt:app.reviewedAt?.toISOString()||null,
  rejectionReason:app.status==='rejected'?app.rejectionReason:null,
  verifyPending:!verified&&app.status==='pending',
  verifyExpired:!verified&&(!app.verifyExpiresAt||app.verifyExpiresAt<now),
 };
}

export async function applicationsForTelegramUser(telegramUserId:string){
 return prisma.betaApplication.findMany({where:{telegramUserId},orderBy:{id:'desc'},take:5});
}

export async function betaStats(now=new Date()){
 const day=new Date(now.getTime()-86400000);
 const [grouped,unverified,today,all]=await Promise.all([
  prisma.betaApplication.groupBy({by:['status'],_count:{_all:true},where:{telegramUserId:{not:null}}}),
  prisma.betaApplication.count({where:{telegramUserId:null,status:'pending'}}),
  prisma.betaApplication.count({where:{createdAt:{gte:day}}}),
  prisma.betaApplication.findMany({where:{telegramUserId:{not:null},status:{in:['pending','approved','rejected']}},select:{platforms:true}}),
 ]);
 const count=(s:string)=>grouped.find(g=>g.status===s)?._count._all||0;
 const platforms=Object.fromEntries(BETA_PLATFORMS.map(p=>[p,0])) as Record<BetaPlatform,number>;
 for(const row of all)for(const p of parsePlatforms(row.platforms))platforms[p]++;
 const pending=count('pending'),approved=count('approved'),rejected=count('rejected');
 return {total:pending+approved+rejected,pending,approved,rejected,duplicates:count('duplicate'),unverified,today,platforms,approvalRate:approved+rejected?Math.round(approved/(approved+rejected)*100):null};
}

export type ListFilter={status?:BetaStatus|'unverified';platform?:BetaPlatform;username?:string};
export async function listApplications(filter:ListFilter,page=0,pageSize=6){
 const where:Prisma.BetaApplicationWhereInput={};
 if(filter.status==='unverified'){where.telegramUserId=null;where.status='pending';}
 else if(filter.status){where.status=filter.status;where.telegramUserId={not:null};}
 if(filter.platform)where.platforms={contains:`"${filter.platform}"`};
 if(filter.username){const u=filter.username.replace(/^@/,'').toLowerCase().replace(/[^a-z0-9_]/g,'');where.OR=[{telegramUsername:{contains:u}},{verifiedUsername:{contains:u}}];}
 const [total,items]=await Promise.all([prisma.betaApplication.count({where}),prisma.betaApplication.findMany({where,orderBy:{id:'desc'},skip:page*pageSize,take:pageSize})]);
 return {total,items,page,pages:Math.max(1,Math.ceil(total/pageSize))};
}
export const applicationEvents=(id:number)=>prisma.betaApplicationEvent.findMany({where:{applicationId:id},orderBy:{createdAt:'asc'}});

const csvCell=(value:unknown)=>{
 let s=value==null?'':String(value);
 // Spreadsheet formula injection: a leading = + - @ is neutralised.
 if(/^[=+\-@\t\r]/.test(s))s=`'${s}`;
 return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
};
export async function exportApplicationsCsv(){
 const rows=await prisma.betaApplication.findMany({orderBy:{id:'asc'}});
 const header=['number','telegram_username','telegram_user_id','verified_username','status','platforms','purpose','about','created_at','reviewed_at','reviewed_by','rejection_reason','admin_comment'];
 const lines=rows.map(r=>[displayNumber(r.id),r.telegramUsername,r.telegramUserId?.slice(9)||'',r.verifiedUsername||'',r.status,parsePlatforms(r.platforms).join(' '),r.purpose,r.about,r.createdAt.toISOString(),r.reviewedAt?.toISOString()||'',r.reviewedBy?.replace(/^telegram:/,'')||'',r.rejectionReason||'',r.adminComment||''].map(csvCell).join(','));
 return '\uFEFF'+[header.join(','),...lines].join('\n');
}

/* ── Retention ────────────────────────────────────────────────────────────── */

/** Unconfirmed applications are removed after 30 days; rejected and repeated ones after 180 days.
 * Approved applications stay while the tester keeps beta access. */
export async function purgeOldApplications(now=new Date()){
 const d=(days:number)=>new Date(now.getTime()-days*86400000);
 const stale=await prisma.betaApplication.findMany({where:{OR:[{telegramUserId:null,createdAt:{lt:d(30)}},{status:{in:['rejected','duplicate']},updatedAt:{lt:d(180)}}]},select:{id:true}});
 const ids=stale.map(s=>s.id);
 if(ids.length)await prisma.$transaction([prisma.betaApplicationEvent.deleteMany({where:{applicationId:{in:ids}}}),prisma.betaApplication.deleteMany({where:{id:{in:ids}}})]);
 await prisma.betaApplication.updateMany({where:{createdAt:{lt:d(30)},sourceHash:{not:''}},data:{sourceHash:''}});
 return ids.length;
}
