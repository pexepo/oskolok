import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import {PrismaClient} from '@prisma/client';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import type {Server} from 'node:http';

const isolated=vi.hoisted(()=>({
 db:null as any,
 env:{TELEGRAM_BOT_TOKEN:'mock-token',TELEGRAM_BOT_USERNAME:'oskolokplayerbot',BETA_ADMIN_IDS:'1001,1002',PUBLIC_SITE_URL:'https://oskolok.lol',PRIVATE_RELEASES_DIR:'',ADMIN_API_KEY:'',NODE_ENV:'test'} as Record<string,string>,
 sendText:vi.fn(async(..._a:any[])=>({message_id:Math.floor(Math.random()*1e6)})),
 sendBanner:vi.fn(async(..._a:any[])=>({message_id:1})),
 editText:vi.fn(async(..._a:any[])=>undefined),
 answerCallback:vi.fn(async(..._a:any[])=>undefined),
 api:vi.fn(async(..._a:any[])=>({})),
}));
vi.mock('../server/src/database/client.js',()=>({get prisma(){return isolated.db;}}));
vi.mock('../server/src/config/env.js',()=>({get env(){return isolated.env;}}));
vi.mock('../server/src/utils/logger.js',()=>({logger:{warn:vi.fn(),info:vi.fn(),error:vi.fn()}}));
vi.mock('../server/src/services/telegramBotApi.js',async importOriginal=>({...await importOriginal<any>(),sendText:isolated.sendText,sendBanner:isolated.sendBanner,editText:isolated.editText,answerCallback:isolated.answerCallback,api:isolated.api}));

import {BotApiError} from '../server/src/services/telegramBotApi.js';

let directory:string,origin:string,server:Server,db:PrismaClient;
let lib:typeof import('../server/src/services/betaApplications.js');
let bot:typeof import('../server/src/services/betaBot.js');
let checkBetaAccess:typeof import('../server/src/services/telegramBeta.js').checkBetaAccess;

const form=()=>lib.issueFormToken(Date.now()-5000);
const valid=(extra:Record<string,unknown>={})=>({telegramUsername:' @Listener_One ',purpose:'Хочу слушать музыку и искать баги в плеере',about:'Слушаю рок и электронику, пользуюсь SoundCloud',platforms:['ios','web'],consent:true,website:'',formToken:form(),...extra});
let ipCounter=0;
const post=async(url:string,body:unknown,headers:Record<string,string>={})=>{
 const response=await fetch(`${origin}${url}`,{method:'POST',headers:{'Content-Type':'application/json','X-Test-Ip':`10.0.${Math.floor(++ipCounter/250)}.${ipCounter%250}`,...headers},body:JSON.stringify(body)});
 return {status:response.status,body:await response.json().catch(()=>null)};
};
const apply=async(extra:Record<string,unknown>={},headers:Record<string,string>={})=>post('/api/site/beta/applications',valid(extra),headers);
const verifyTokenOf=(verifyUrl:string)=>verifyUrl.split('start=beta_')[1];
const msg=(from:number,text:string,username?:string)=>({message_id:Math.floor(Math.random()*1e9),chat:{id:from,type:'private'},from:{id:from,username},text});
const cb=(from:number,data:string)=>({id:randomBytes(6).toString('hex'),from:{id:from},data,message:{message_id:77,chat:{id:from,type:'private'}}});
const settle=async()=>{await vi.waitFor(async()=>expect(await db.betaApplication.count({where:{OR:[{adminNotifyState:'sending'},{userNotifyState:'sending'}]}})).toBe(0));await new Promise(r=>setTimeout(r,20));};
async function verifiedApplication(userId:number,username='listener_one'){
 const created=await apply({telegramUsername:username});
 expect(created.status).toBe(201);
 await bot.handleBetaMessage(msg(userId,`/start beta_${verifyTokenOf(created.body.data.verifyUrl)}`,username));
 await settle();
 const row=await db.betaApplication.findFirstOrThrow({where:{telegramUserId:`telegram:${userId}`},orderBy:{id:'desc'}});
 return {created,row};
}

beforeAll(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'oskolok-beta-site-'));
 const databaseUrl=`file:${path.join(directory,'isolated.sqlite')}`;
 vi.stubEnv('DATABASE_URL',databaseUrl);vi.stubEnv('OSKOLOK_PRIVATE_DIR',path.join(directory,'private'));
 isolated.env.PRIVATE_RELEASES_DIR=path.join(directory,'releases');
 await mkdir(isolated.env.PRIVATE_RELEASES_DIR,{recursive:true});
 db=new PrismaClient({datasources:{db:{url:databaseUrl}}});isolated.db=db;
 const ddl=execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8'});
 for(const sql of ddl.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(sql);
 const {ensureBetaSchema}=await import('../server/src/database/ensureBetaSchema.js');await ensureBetaSchema();
 lib=await import('../server/src/services/betaApplications.js');
 bot=await import('../server/src/services/betaBot.js');
 ({checkBetaAccess}=await import('../server/src/services/telegramBeta.js'));
 const {sitePublicRoutes,siteProtectedRoutes}=await import('../server/src/controllers/siteController.js');
 const {userIdentity}=await import('../server/src/middleware/userIdentity.js');
 const {errorHandler}=await import('../server/src/middleware/errorHandler.js');
 const app=express();
 app.set('trust proxy','loopback');
 app.use((req,_res,next)=>{const ip=req.get('X-Test-Ip');if(ip)req.headers['x-forwarded-for']=ip;next();});
 app.use('/api/site',express.json({limit:'16kb'}));
 app.use('/api/site',sitePublicRoutes);app.use('/api',userIdentity);app.use('/api/site',siteProtectedRoutes);app.use(errorHandler);
 server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const address=server.address();if(!address||typeof address==='string')throw new Error('no listener');origin=`http://127.0.0.1:${address.port}`;
},60000);
beforeEach(async()=>{
 for(const t of ['betaApplicationEvent','betaApplication','siteSetting','betaAccess','webSession','user','appRelease'] as const)await (db as any)[t].deleteMany();
 for(const f of [isolated.sendText,isolated.sendBanner,isolated.editText,isolated.answerCallback,isolated.api])f.mockClear();
 isolated.sendText.mockImplementation(async()=>({message_id:Math.floor(Math.random()*1e6)}));
 isolated.sendBanner.mockImplementation(async()=>({message_id:1}));
});
afterAll(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));if(db)await db.$disconnect();vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});

describe.sequential('beta applications: site API',()=>{
 it('stores a valid application with a normalised username and returns only secrets for the applicant',async()=>{
  const r=await apply();
  expect(r.status).toBe(201);
  expect(r.body.data.number).toMatch(/^#\d{6}$/);
  expect(r.body.data.verifyUrl).toMatch(/^https:\/\/t\.me\/oskolokplayerbot\?start=beta_[A-Za-z0-9_-]{32}$/);
  const row=await db.betaApplication.findFirstOrThrow();
  expect(row.telegramUsername).toBe('listener_one');
  expect(JSON.parse(row.platforms)).toEqual(['ios','web']);
  expect(row.statusTokenHash).not.toBe(r.body.data.statusToken);
  expect(row.status).toBe('pending');expect(row.telegramUserId).toBeNull();
  // Nothing goes to admins before Telegram is confirmed.
  expect(row.adminNotifyState).toBe('none');
  expect(await db.betaApplicationEvent.count({where:{applicationId:row.id,type:'created'}})).toBe(1);
 });

 it('rejects invalid input with field messages and stores nothing',async()=>{
  const r=await apply({telegramUsername:'<script>',purpose:'коротко',about:'',platforms:['ios','playstation'],consent:false});
  expect(r.status).toBe(400);
  expect(Object.keys(r.body.error.fields).sort()).toEqual(['about','consent','platforms','purpose','telegramUsername']);
  expect(await db.betaApplication.count()).toBe(0);
 });

 it('keeps markup as inert text and strips control characters',async()=>{
  const r=await apply({purpose:'<img src=x onerror=alert(1)> хочу тестировать‮\u0000 плеер'});
  expect(r.status).toBe(201);
  const row=await db.betaApplication.findFirstOrThrow();
  expect(row.purpose).toBe('<img src=x onerror=alert(1)> хочу тестировать плеер');
 });

 it.each([
  ['honeypot',{website:'http://spam.example'}],
  ['missing form ticket',{formToken:undefined}],
  ['forged form ticket',{formToken:'abc.def.ghi'}],
  ['instant submit',{formToken:'NOW'}],
 ])('answers neutrally to automated submissions (%s)',async(_name,extra)=>{
  const fields={...extra} as Record<string,unknown>;
  if(fields.formToken==='NOW')fields.formToken=lib.issueFormToken(Date.now());
  const r=await apply(fields);
  expect(r.status).toBe(400);expect(r.body.error.code).toBe('SUBMIT_FAILED');
  expect(JSON.stringify(r.body)).not.toMatch(/honeypot|token|ticket/i);
  expect(await db.betaApplication.count()).toBe(0);
 });

 it('accepts a form ticket only once',async()=>{
  const formToken=form();
  expect((await apply({formToken})).status).toBe(201);
  expect((await apply({formToken,telegramUsername:'other_user'})).status).toBe(400);
 });

 it('limits repeated applications from one sender and for one username',async()=>{
  const sameSender={'X-Test-Ip':'10.9.9.9','User-Agent':'same-agent'};
  const results=[];
  for(let i=0;i<5;i++)results.push((await post('/api/site/beta/applications',valid({telegramUsername:`sender_${i}x`}),sameSender)).status);
  expect(results.slice(0,4)).toEqual([201,201,201,201]);
  expect(results[4]).toBe(429);
  for(let i=0;i<3;i++)expect((await apply({telegramUsername:'same_name'})).status).toBe(201);
  expect((await apply({telegramUsername:'same_name'})).status).toBe(429);
 });

 it('refuses new applications on the server while recruitment is closed, keeping old ones',async()=>{
  await apply();
  await lib.setBetaOpen(false,'telegram:1001');
  const closed=await apply({telegramUsername:'late_user'});
  expect(closed.status).toBe(403);expect(closed.body.error.code).toBe('BETA_CLOSED');
  expect((await fetch(`${origin}/api/site/beta`).then(r=>r.json())).data.open).toBe(false);
  expect(await db.betaApplication.count()).toBe(1);
  await lib.setBetaOpen(true,'telegram:1001');
  expect((await apply({telegramUsername:'late_user'})).status).toBe(201);
 });

 it('rejects oversized bodies before parsing',async()=>{
  const r=await apply({about:'я'.repeat(20000)});
  expect(r.status).toBe(413);
 });

 it('shows status only to the holder of the secret token, never by sequential number',async()=>{
  const r=await apply();
  const own=await post('/api/site/beta/status',{statusToken:r.body.data.statusToken});
  expect(own.status).toBe(200);
  expect(own.body.data.application).toMatchObject({status:'pending',verified:false,verifyPending:true});
  expect(own.body.data.application).not.toHaveProperty('adminComment');
  const row=await db.betaApplication.findFirstOrThrow();
  for(const guess of [String(row.id),r.body.data.number,randomBytes(24).toString('base64url'),''])expect((await post('/api/site/beta/status',{statusToken:guess})).status).toBe(404);
 });
});

describe.sequential('beta applications: Telegram confirmation',()=>{
 it('binds the real Telegram ID, makes the link single-use and queues the admin card',async()=>{
  const r=await apply();
  const verifyToken=verifyTokenOf(r.body.data.verifyUrl);
  expect(await bot.handleBetaMessage(msg(555,`/start beta_${verifyToken}`,'Listener_One'))).toBe(true);
  const row=await db.betaApplication.findFirstOrThrow();
  expect(row.telegramUserId).toBe('telegram:555');expect(row.verifiedUsername).toBe('listener_one');
  expect(row.verifyTokenHash).toBeNull();
  expect(['pending','sending','sent']).toContain(row.adminNotifyState);
  // Someone else replaying the same link cannot take the application over.
  const replay=await lib.verifyApplication(verifyToken,{id:777,username:'thief'});
  expect(replay.kind).toBe('invalid');
  expect((await db.betaApplication.findFirstOrThrow()).telegramUserId).toBe('telegram:555');
 });

 it('treats an expired link as expired and lets the applicant get a new one',async()=>{
  const r=await apply();
  const old=verifyTokenOf(r.body.data.verifyUrl);
  expect((await lib.verifyApplication(old,{id:556},new Date(Date.now()+lib.VERIFY_TTL_MS+1000))).kind).toBe('expired');
  const fresh=await post('/api/site/beta/status/verify-link',{statusToken:r.body.data.statusToken});
  expect(fresh.status).toBe(200);
  expect((await lib.verifyApplication(old,{id:556})).kind).toBe('invalid');
  expect((await lib.verifyApplication(verifyTokenOf(fresh.body.data.verifyUrl),{id:556})).kind).toBe('verified');
  expect((await post('/api/site/beta/status/verify-link',{statusToken:r.body.data.statusToken})).status).toBe(409);
 });

 it('keeps one active application per Telegram account even when confirmations race',async()=>{
  const a=await apply({telegramUsername:'first_try'}),b=await apply({telegramUsername:'second_try'});
  const results=await Promise.all([lib.verifyApplication(verifyTokenOf(a.body.data.verifyUrl),{id:900}),lib.verifyApplication(verifyTokenOf(b.body.data.verifyUrl),{id:900})]);
  expect(results.map(r=>r.kind).sort()).toEqual(['duplicate','verified']);
  expect(await db.betaApplication.count({where:{telegramUserId:'telegram:900',status:{in:['pending','approved']}}})).toBe(1);
  expect(await db.betaApplication.count({where:{status:'duplicate'}})).toBe(1);
 });
});

describe.sequential('beta applications: admin decisions in the bot',()=>{
 it('sends the confirmed application to every admin with real inline buttons',async()=>{
  const {row}=await verifiedApplication(601);
  await bot.deliverAdminNotifications();await settle();
  const calls=isolated.sendText.mock.calls.filter(c=>['1001','1002'].includes(String(c[0])));
  expect(calls).toHaveLength(2);
  const [,message,markup]=calls[0];
  expect(message.text).toContain('💎 OSKOLOK — НОВАЯ ЗАЯВКА');
  expect(message.text).toContain('@listener_one');expect(message.text).toContain(lib.displayNumber(row.id));
  const buttons=markup.inline_keyboard.flat();
  expect(buttons).toEqual(expect.arrayContaining([
   {text:'✅ Принять',callback_data:`ba:ok:${row.id}`},{text:'❌ Отклонить',callback_data:`ba:no:${row.id}`},
   {text:'👤 Профиль',url:'https://t.me/listener_one'},{text:'📋 Подробнее',callback_data:`ba:info:${row.id}`},
  ]));
  expect((await db.betaApplication.findUniqueOrThrow({where:{id:row.id}})).adminNotifyState).toBe('sent');
  await bot.deliverAdminNotifications();
  expect(isolated.sendText.mock.calls.filter(c=>['1001','1002'].includes(String(c[0])))).toHaveLength(2);
 });

 it('approves atomically, grants beta access to the Telegram ID and notifies the applicant once',async()=>{
  const {row}=await verifiedApplication(602);
  await bot.deliverAdminNotifications();
  await bot.handleBetaCallback(cb(1001,`ba:ok:${row.id}`));
  await vi.waitFor(async()=>expect((await db.betaApplication.findUniqueOrThrow({where:{id:row.id}})).userNotifyState).toBe('sent'));
  const saved=await db.betaApplication.findUniqueOrThrow({where:{id:row.id}});
  expect(saved).toMatchObject({status:'approved',reviewedBy:'telegram:1001'});expect(saved.reviewedAt).toBeInstanceOf(Date);
  expect(await checkBetaAccess('telegram:602','listener_one')).toBe(true);
  expect(isolated.sendBanner).toHaveBeenCalledTimes(1);
  expect(isolated.sendBanner.mock.calls[0][0]).toBe('602');
  expect(isolated.sendBanner.mock.calls[0][2].text).toContain('Поздравляем');
  expect(isolated.sendBanner.mock.calls[0][3].inline_keyboard[0][0]).toEqual({text:'Перейти к Осколку',url:'https://oskolok.lol/app'});
  // Admin cards are rewritten to the decided state without decision buttons.
  await vi.waitFor(()=>expect(isolated.editText).toHaveBeenCalled());
  const edited=isolated.editText.mock.calls.at(-1)!;
  expect(edited[2].text).toContain('✅ ЗАЯВКА ОДОБРЕНА');
  expect(JSON.stringify(edited[3])).not.toContain('ba:ok:');
  // A second press — by the same or another admin — changes nothing and sends nothing.
  await bot.handleBetaCallback(cb(1001,`ba:ok:${row.id}`));
  await bot.handleBetaCallback(cb(1002,`ba:no:${row.id}`));
  expect((await db.betaApplication.findUniqueOrThrow({where:{id:row.id}})).status).toBe('approved');
  expect(isolated.answerCallback.mock.calls.at(-1)![1]).toContain('Уже решено');
  await bot.deliverUserNotifications();
  expect(isolated.sendBanner).toHaveBeenCalledTimes(1);
  expect(await db.betaApplicationEvent.count({where:{applicationId:row.id,type:{in:['approved','rejected']}}})).toBe(1);
 });

 it('rejects politely, keeps the internal comment private and allows a visible reason',async()=>{
  const {created,row}=await verifiedApplication(603);
  await bot.handleBetaCallback(cb(1002,`ba:no:${row.id}`));
  await vi.waitFor(async()=>expect((await db.betaApplication.findUniqueOrThrow({where:{id:row.id}})).userNotifyState).toBe('sent'));
  const notice=isolated.sendText.mock.calls.find(c=>c[0]==='603'&&!c[1].text.includes('подтверждён'))!;
  expect(notice[1].text).toContain('Спасибо за интерес к Осколку');
  await bot.handleBetaCallback(cb(1002,`ba:cm:${row.id}`));
  await bot.handleBetaMessage(msg(1002,'Профиль выглядит как бот'));
  await bot.handleBetaCallback(cb(1002,`ba:rs:${row.id}`));
  await bot.handleBetaMessage(msg(1002,'Сейчас набираем только Android'));
  const saved=await db.betaApplication.findUniqueOrThrow({where:{id:row.id}});
  expect(saved).toMatchObject({status:'rejected',adminComment:'Профиль выглядит как бот',rejectionReason:'Сейчас набираем только Android'});
  expect(isolated.sendText.mock.calls.filter(c=>c[0]==='603'&&!c[1].text.includes('подтверждён'))).toHaveLength(1);
  const view=await post('/api/site/beta/status',{statusToken:created.body.data.statusToken});
  expect(view.body.data.application.rejectionReason).toBe('Сейчас набираем только Android');
  expect(JSON.stringify(view.body)).not.toContain('как бот');
  expect(await checkBetaAccess('telegram:603','listener_one')).toBe(false);
 });

 it('lets exactly one of two simultaneous admin decisions win',async()=>{
  const {row}=await verifiedApplication(604);
  const results=await Promise.all([lib.decideApplication(row.id,'approved','telegram:1001'),lib.decideApplication(row.id,'rejected','telegram:1002')]);
  expect(results.filter(r=>r.changed)).toHaveLength(1);
  expect(await db.betaApplicationEvent.count({where:{applicationId:row.id,type:{in:['approved','rejected']}}})).toBe(1);
 });

 it('ignores admin commands and buttons from anyone else',async()=>{
  const {row}=await verifiedApplication(605);
  expect(await bot.handleBetaMessage(msg(605,'/admin','listener_one'))).toBe(false);
  expect(await bot.handleBetaMessage(msg(605,'/close_beta','listener_one'))).toBe(false);
  await bot.handleBetaCallback(cb(605,`ba:ok:${row.id}`));
  expect(isolated.answerCallback.mock.calls.at(-1)).toEqual([expect.any(String),'Это действие доступно только администраторам.',true]);
  expect((await db.betaApplication.findUniqueOrThrow({where:{id:row.id}})).status).toBe('pending');
  expect(await lib.isBetaOpen()).toBe(true);
 });

 it('opens and closes recruitment from bot commands',async()=>{
  expect(await bot.handleBetaMessage(msg(1001,'/close_beta'))).toBe(true);
  expect(await lib.isBetaOpen()).toBe(false);
  expect((await apply()).status).toBe(403);
  expect(await bot.handleBetaMessage(msg(1001,'/open_beta'))).toBe(true);
  expect(await lib.isBetaOpen()).toBe(true);
  expect(await bot.handleBetaMessage(msg(1001,'/admin'))).toBe(true);
  expect(isolated.sendText.mock.calls.at(-1)![1].text).toContain('Набор: ОТКРЫТ');
 });

 it('does not repeat a notification whose delivery result is unknown, and retries one Telegram rate-limited',async()=>{
  const {row:a}=await verifiedApplication(606,'user_unknown');
  const {row:b}=await verifiedApplication(607,'user_flood');
  const {row:c}=await verifiedApplication(608,'user_blocked');
  isolated.sendText.mockImplementation(async(chat:any)=>{
   if(chat==='606')throw new Error('fetch failed');
   if(chat==='607')throw new BotApiError('sendMessage',429,'Too Many Requests',3);
   if(chat==='608')throw new BotApiError('sendMessage',403,'Forbidden: bot was blocked by the user');
   return {message_id:1};
  });
  for(const id of [a.id,b.id,c.id])await lib.decideApplication(id,'rejected','telegram:1001');
  await bot.deliverUserNotifications();
  const state=async(id:number)=>(await db.betaApplication.findUniqueOrThrow({where:{id}})).userNotifyState;
  expect(await state(a.id)).toBe('unknown');expect(await state(b.id)).toBe('pending');expect(await state(c.id)).toBe('failed');
  // Decisions are stored regardless of Telegram.
  for(const id of [a.id,b.id,c.id])expect((await db.betaApplication.findUniqueOrThrow({where:{id}})).status).toBe('rejected');
  isolated.sendText.mockImplementation(async()=>({message_id:1}));
  await bot.deliverUserNotifications();
  expect(await state(a.id)).toBe('unknown');expect(await state(b.id)).toBe('sent');
 });

 it('keeps the admin card queued while Telegram rate-limits it',async()=>{
  isolated.sendText.mockImplementation(async(chat:any)=>{if(chat==='1001'||chat==='1002')throw new BotApiError('sendMessage',429,'Too Many Requests',3);return {message_id:1};});
  const {row}=await verifiedApplication(609);
  await bot.deliverAdminNotifications();await settle();
  expect((await db.betaApplication.findUniqueOrThrow({where:{id:row.id}})).adminNotifyState).toBe('pending');
  isolated.sendText.mockImplementation(async()=>({message_id:5}));
  await bot.deliverAdminNotifications();await settle();
  const saved=await db.betaApplication.findUniqueOrThrow({where:{id:row.id}});
  expect(saved.adminNotifyState).toBe('sent');expect(JSON.parse(saved.adminMessages)).toHaveLength(2);
 });

 it('exports applications only to admins as a CSV document with neutralised formulas',async()=>{
  await apply({purpose:'=HYPERLINK("http://evil") хочу в бету'});
  const csv=await lib.exportApplicationsCsv();
  expect(csv).toContain(`"'=HYPERLINK(""http://evil"") хочу в бету"`);
  expect(await bot.handleBetaMessage(msg(605,'/export'))).toBe(false);
  expect(await bot.handleBetaMessage(msg(1001,'/export'))).toBe(true);
  expect(isolated.api).toHaveBeenCalledWith('sendDocument',expect.any(FormData),30000);
 });
});

describe.sequential('releases and protected downloads',()=>{
 it('publishes honest platform statuses and hides beta-only file addresses',async()=>{
  const {seedPublishedReleases}=await import('../server/src/services/releases.js');
  await seedPublishedReleases();
  await db.appRelease.create({data:{platform:'ios',version:'1.0.0',releaseDate:new Date(),fileName:'Oskolok-1.0.0.ipa',fileSize:3,betaOnly:true,storage:'private',availability:'beta'}});
  const catalog=await fetch(`${origin}/api/site/releases`).then(r=>r.json());
  const byPlatform=Object.fromEntries(catalog.data.platforms.map((p:any)=>[p.platform,p]));
  expect(byPlatform.windows.status).toBe('available');
  expect(byPlatform.windows.builds[0].downloadUrl).toMatch(/^\/downloads\/Oskolok-/);
  expect(byPlatform.linux).toMatchObject({status:'soon',builds:[]});
  expect(byPlatform.ios.status).toBe('beta');
  expect(byPlatform.ios.builds[0].downloadUrl).toBeNull();
  expect(JSON.stringify(catalog)).not.toContain('Oskolok-1.0.0.ipa');
 });

 it('refuses a closed build without a beta session and serves it only through a fresh signed link',async()=>{
  await writeFile(path.join(isolated.env.PRIVATE_RELEASES_DIR,'Oskolok-1.0.0.ipa'),'ipa');
  const release=await db.appRelease.create({data:{platform:'ios',version:'1.0.1',releaseDate:new Date(),fileName:'Oskolok-1.0.0.ipa',fileSize:3,betaOnly:true,storage:'private',availability:'beta'}});
  expect((await post(`/api/site/releases/${release.id}/link`,{})).status).toBe(401);
  expect((await fetch(`${origin}/api/site/releases/${release.id}/file`)).status).toBe(403);
  expect((await fetch(`${origin}/api/site/releases/${release.id}/file?e=${Date.now()+60000}&u=AAAAAAAAAAAAAAAA&s=${'A'.repeat(43)}`)).status).toBe(403);
  // A signed-in listener without beta access is refused too.
  const session=async(userId:string)=>{const token=randomBytes(32).toString('hex');await db.user.create({data:{id:userId,username:`user${userId.slice(9)}`}});await db.webSession.create({data:{tokenHash:createHash('sha256').update(token).digest('hex'),userId,expiresAt:new Date(Date.now()+86400000)}});return `oskolok_session=${token}`;};
  const outsider=await session('telegram:701');
  expect((await post(`/api/site/releases/${release.id}/link`,{},{Cookie:outsider})).status).toBe(403);
  const tester=await session('telegram:702');
  await db.betaAccess.create({data:{username:'id702',telegramUserId:'telegram:702',enabled:true}});
  const link=await post(`/api/site/releases/${release.id}/link`,{},{Cookie:tester});
  expect(link.status).toBe(200);
  const file=await fetch(`${origin}${link.body.data.url}`);
  expect(file.status).toBe(200);expect(await file.text()).toBe('ipa');
  expect(file.headers.get('content-disposition')).toContain('attachment');
  const expired=new URL(`${origin}${link.body.data.url}`);expired.searchParams.set('e',String(Date.now()-1000));
  expect((await fetch(expired)).status).toBe(403);
 });
});

describe.sequential('failure handling',()=>{
 it('answers with a JSON error and no stored data when the database is unavailable',async()=>{
  const real=isolated.db;
  const down=async()=>{throw Object.assign(new Error('Can\'t reach database server'),{code:'P1001'});};
  isolated.db=new Proxy(real,{get(target,prop){if(prop==='siteSetting'||prop==='betaApplication')return new Proxy({},{get:()=>down});return (target as any)[prop];}});
  try{
   const r=await apply();
   expect(r.status).toBe(500);expect(r.body.error).toBeDefined();
  }finally{isolated.db=real;}
  expect(await db.betaApplication.count()).toBe(0);
 });
});
