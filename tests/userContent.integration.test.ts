import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import express from 'express';
import {PrismaClient} from '@prisma/client';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {Server} from 'node:http';

const isolated=vi.hoisted(()=>({db:null as any,notify:vi.fn(async()=>{}),adminKey:'integration-only-admin-key',botToken:'',tracks:{} as Record<string,any>}));
vi.mock('../server/src/database/client.js',()=>({get prisma(){return isolated.db;}}));
vi.mock('../server/src/config/env.js',()=>({env:{ADMIN_API_KEY:isolated.adminKey,get TELEGRAM_BOT_TOKEN(){return isolated.botToken;},TELEGRAM_ADMIN_CHAT_ID:'',GENIUS_ACCESS_TOKEN:''}}));
vi.mock('../server/src/services/telegramBot.js',()=>({notifyUser:isolated.notify}));
vi.mock('../server/src/controllers/trackController.js',()=>({trackController:{resolveTrack:vi.fn(async(id:string)=>isolated.tracks[id]||null)}}));
vi.mock('../server/src/services/StudioMasterService.js',()=>({studioMasterService:{prepareExportAudio:vi.fn(async()=>{throw new Error('No external audio in integration tests');})}}));

let directory:string,origin:string,server:Server,db:PrismaClient,audioId:string;
const owner='telegram:91000001',other='telegram:91000002',denied='telegram:91000003',trackId='soundcloud:integration-track';
const audio=Buffer.from('fLaC real-byte-range-fixture');
const token=(id:string)=>`isolated-session-${id}`;
async function request(url:string,options:RequestInit={},as:string|null=owner){
 const headers=new Headers(options.headers);if(as)headers.set('Cookie',`oskolok_session=${token(as)}`);
 return fetch(`${origin}${url}`,{...options,headers});
}
async function json(url:string,body?:unknown,as:string|null=owner,method='POST'){
 const response=await request(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},as);return {response,body:await response.json()};
}
async function admin(url:string,body?:unknown,method='POST'){
 const response=await request(`/api/admin${url}`,{method,headers:{Authorization:`Bearer ${isolated.adminKey}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},null);return {response,body:await response.json()};
}
async function report(kind:string,payload:Record<string,unknown>={}){
 return json('/api/content/reports',{requestId:randomUUID(),kind,reason:'Integration report',description:'A reproducible integration test report',trackId,...payload});
}

beforeAll(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'oskolok-content-integration-'));
 const databaseUrl=`file:${path.join(directory,'isolated.sqlite')}`;
 vi.stubEnv('DATABASE_URL',databaseUrl);vi.stubEnv('USER_CONTENT_DIR',path.join(directory,'uploads'));
 db=new PrismaClient({datasources:{db:{url:databaseUrl}}});isolated.db=db;
 // Generate DDL without connecting to any configured production database.
 const ddl=execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8'});
 for(const sql of ddl.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(sql);
 for(const [id,username,enabled] of [[owner,'owner_test',true],[other,'other_test',true],[denied,'denied_test',false]] as const){
  await db.user.create({data:{id,name:username,username}});
  await db.betaAccess.create({data:{username,telegramUserId:id,enabled}});
  await db.webSession.create({data:{tokenHash:createHash('sha256').update(token(id)).digest('hex'),userId:id,expiresAt:new Date(Date.now()+3600000)}});
 }
 const [{userContentRoutes},{adminRoutes},{userIdentity},{errorHandler}]=await Promise.all([import('../server/src/controllers/userContentController.js'),import('../server/src/controllers/adminController.js'),import('../server/src/middleware/userIdentity.js'),import('../server/src/middleware/errorHandler.js')]);
 const app=express();app.use(express.json({limit:'3mb'}));app.use('/api/admin',adminRoutes);app.use('/api',userIdentity);app.use('/api/content',userContentRoutes);app.use(errorHandler);
 server=await new Promise<Server>(resolve=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));});
 const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test listener');origin=`http://127.0.0.1:${address.port}`;
},30000);
afterAll(async()=>{
 if(server)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 if(db)await db.$disconnect();vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});
});

describe.sequential('real Express + isolated SQLite content integration',()=>{
 it('distinguishes missing session, expired session and beta denial; rejects user sessions at admin routes',async()=>{
  expect((await request('/api/content/reports',{},null)).status).toBe(401);
  const expired=await request('/api/content/reports',{},'telegram:missing');expect(expired.status).toBe(401);expect((await expired.json()).error.code).toBe('TELEGRAM_SESSION_EXPIRED');
  const blocked=await request('/api/content/reports',{},denied);expect(blocked.status).toBe(403);expect((await blocked.json()).error.message).toBe('Проект находится в стадии бета-тестирования. У вас нету к нему доступа');
  expect((await request('/api/admin/reports')).status).toBe(401);
 });
 it('persists raw audio under its owner and track, supports byte ranges, hides it from other users',async()=>{
  const response=await request(`/api/content/files?kind=audio&trackId=${encodeURIComponent(trackId)}&fileName=private.flac`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:audio});expect(response.status).toBe(201);
  const file=(await response.json()).data;audioId=file.id;
  const stored=await db.userFile.findUniqueOrThrow({where:{id:audioId}});expect(stored.userId).toBe(owner);expect(stored.trackId).toBe(trackId);expect(stored.path.startsWith(directory)).toBe(true);expect(await readFile(stored.path)).toEqual(audio);
  const partial=await request(file.url,{headers:{Range:'bytes=5-13'}});expect(partial.status).toBe(206);expect(partial.headers.get('content-range')).toBe(`bytes 5-13/${audio.length}`);expect(Buffer.from(await partial.arrayBuffer())).toEqual(audio.subarray(5,14));
  expect((await request(file.url,{},other)).status).toBe(404);
  const allowedAdmin=await request(`/api/admin/files/${audioId}`,{headers:{Authorization:`Bearer ${isolated.adminKey}`}},null);expect(allowedAdmin.status).toBe(200);
  const personal=(await (await request(`/api/content/tracks/${encodeURIComponent(trackId)}/personal`)).json()).data;expect(personal.audio.id).toBe(audioId);
 });
 it('rejects invalid bytes and JSON disguised as an upload',async()=>{
  const url=`/api/content/files?kind=audio&trackId=${encodeURIComponent(trackId)}&fileName=fake.mp3`;
  expect((await request(url,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:'MZ executable'})).status).toBe(400);
  expect((await json(url,{payload:'wrong'})).response.status).toBe(400);
 });
 it('keeps personal lyrics and timing private, persistent and separate from public moderation',async()=>{
  const lines=[{text:'A private lyric',time:0}];expect((await json(`/api/content/tracks/${encodeURIComponent(trackId)}/personal`,{offset:1.25,lines},owner,'PUT')).response.status).toBe(200);
  const self=(await (await request(`/api/content/tracks/${encodeURIComponent(trackId)}/personal`)).json()).data;expect(self.offset).toBe(1.25);expect(self.lines).toEqual(lines);
  const theirs=(await (await request(`/api/content/tracks/${encodeURIComponent(trackId)}/personal`,{},other)).json()).data;expect(theirs.lines).toBeNull();expect(theirs.audio).toBeNull();expect(await db.lyricContribution.count({where:{trackId}})).toBe(0);
 });
 it('rejects references to somebody else’s file in a report',async()=>{
  const result=await json('/api/content/reports',{requestId:randomUUID(),kind:'bug',reason:'Broken image',description:'This file belongs to a different user',attachmentIds:[audioId]},other);expect(result.response.status).toBe(400);
 });
 it('creates only one report and one notification for simultaneous duplicate requestId',async()=>{
  isolated.notify.mockClear();const requestId=randomUUID(),body={requestId,kind:'bug',reason:'Duplicate test',description:'token=secret-value Broken view',page:'/profile?token=secret-value'};
  const results=await Promise.all([json('/api/content/reports',body),json('/api/content/reports',body)]);expect(results.every(r=>r.response.ok)).toBe(true);expect(results[0].body.data.id).toBe(results[1].body.data.id);expect(await db.userReport.count({where:{userId:owner,requestId}})).toBe(1);expect(isolated.notify).toHaveBeenCalledTimes(1);
  const stored=await db.userReport.findUniqueOrThrow({where:{userId_requestId:{userId:owner,requestId}}});expect(stored.description).not.toContain('secret-value');expect(stored.page).toBe('/profile');
 });
 it('applies approved timing globally while preserving an explicit personal offset; prevents double review',async()=>{
  const result=await report('timing',{offset:2.5});expect(result.response.status).toBe(201);
  const id=result.body.data.id;expect((await admin(`/reports/${id}/review`,{decision:'approved',reviewNote:'Verified timing'})).response.status).toBe(200);
  expect((await db.sharedTrackOverride.findUniqueOrThrow({where:{trackId}})).offset).toBe(2.5);
  expect((await admin(`/reports/${id}/review`,{decision:'rejected'})).response.status).toBe(409);
  const self=(await (await request(`/api/content/tracks/${encodeURIComponent(trackId)}/personal`)).json()).data,theirs=(await (await request(`/api/content/tracks/${encodeURIComponent(trackId)}/personal`,{},other)).json()).data;expect(self.offset).toBe(1.25);expect(theirs.offset).toBe(2.5);
 });
 it('makes an approved source stream shared only after review; retains private audio on rejection',async()=>{
  const shared=`/api/content/shared/${encodeURIComponent(trackId)}/audio`;expect((await request(shared,{},other)).status).toBe(404);
  const result=await report('source',{platform:'soundcloud',attachmentIds:[audioId]});expect(result.response.status).toBe(201);expect((await admin(`/reports/${result.body.data.id}/review`,{decision:'approved'})).response.status).toBe(200);
  const response=await request(shared,{headers:{Range:'bytes=0-3'}},other);expect(response.status).toBe(206);expect(await response.text()).toBe('fLaC');expect((await request(`/api/content/files/${audioId}`,{},other)).status).toBe(404);
  const rejected=await report('source',{platform:'youtube',proposedUrl:'https://youtu.be/example123'});expect((await admin(`/reports/${rejected.body.data.id}/review`,{decision:'rejected',reviewNote:'Wrong version'})).response.status).toBe(200);expect((await db.sharedTrackOverride.findUniqueOrThrow({where:{trackId}})).audioFileId).toBe(audioId);expect((await db.personalTrack.findUniqueOrThrow({where:{userId_trackId:{userId:owner,trackId}}})).audioFileId).toBe(audioId);
 });
 it('publishes approved lyric corrections, invalidates cache, leaves private copy and rejected proposals intact',async()=>{
  await db.lyricsCache.create({data:{id:trackId,lyricsData:'old cached lyrics'}});const lines=[{text:'Published lyric',time:0},{text:'Second line',time:3}];
  const result=await report('lyrics',{lines,trackTitle:'Test song',artistName:'Test artist'});expect((await admin(`/reports/${result.body.data.id}/review`,{decision:'approved'})).response.status).toBe(200);
  const published=await db.lyricContribution.findFirstOrThrow({where:{trackId}});expect(JSON.parse(published.lyricsData)).toEqual(lines);expect(await db.lyricsCache.findUnique({where:{id:trackId}})).toBeNull();
  const rejected=await report('lyrics',{lines:[{text:'Rejected change',time:0}]});await admin(`/reports/${rejected.body.data.id}/review`,{decision:'rejected',reviewNote:'Keep previous text'});expect((await db.lyricContribution.findFirstOrThrow({where:{trackId}})).id).toBe(published.id);expect((await db.userReport.findUniqueOrThrow({where:{id:rejected.body.data.id}})).reviewNote).toBe('Keep previous text');
  expect(JSON.parse((await db.personalTrack.findUniqueOrThrow({where:{userId_trackId:{userId:owner,trackId}}})).lyricsData!)[0].text).toBe('A private lyric');
 });
 it('inherits approved timing for audio-only rows and honors an explicitly saved zero',async()=>{
  const id='soundcloud:audio-only';await db.personalTrack.create({data:{userId:owner,trackId:id,audioFileId:audioId}});await db.sharedTrackOverride.create({data:{trackId:id,offset:3.5}});
  const url=`/api/content/tracks/${encodeURIComponent(id)}/personal`;
  expect((await (await request(url)).json()).data.offset).toBe(3.5);
  expect((await json(url,{offset:0},owner,'PUT')).response.status).toBe(200);
  expect((await (await request(url)).json()).data.offset).toBe(0);
  expect((await db.personalTrack.findUniqueOrThrow({where:{userId_trackId:{userId:owner,trackId:id}}})).hasTimingOffset).toBe(true);
 });
 it('keeps a separate timing offset per playback source and recording',async()=>{
  const id='soundcloud:per-source',url=`/api/content/tracks/${encodeURIComponent(id)}/personal`;
  expect((await json(url,{offset:1},owner,'PUT')).response.status).toBe(200);
  expect((await json(url,{offset:-4.5,source:'youtube:youtube:abcdefghijk'},owner,'PUT')).response.status).toBe(200);
  expect((await json(url,{offset:2,source:'soundcloud'},owner,'PUT')).response.status).toBe(200);
  const at=async(source?:string)=>(await (await request(source?`${url}?source=${encodeURIComponent(source)}`:url)).json()).data.offset;
  expect(await at()).toBe(1);
  expect(await at('youtube:youtube:abcdefghijk')).toBe(-4.5);
  expect(await at('soundcloud')).toBe(2);
  expect(await at('youtube')).toBe(1);
  expect((await json(url,{offset:1,source:'spotify'},owner,'PUT')).response.status).toBe(400);
 });
 it('deduplicates concurrent release exports, writes a valid ZIP and isolates its download',async()=>{
  isolated.tracks[trackId]={id:trackId,source:'soundcloud',title:'Test export',artist:{name:'Artist'},duration:1};
  const body={requestId:randomUUID(),trackIds:[trackId],title:'Private release',sendTelegram:false};
  const results=await Promise.all([json('/api/content/releases/test-release/export',body),json('/api/content/releases/test-release/export',{...body,requestId:randomUUID()})]);expect(results.every(r=>r.response.status===202)).toBe(true);expect(results[0].body.data.id).toBe(results[1].body.data.id);
  const id=results[0].body.data.id;let job:any;for(let tries=0;tries<50;tries++){job=(await (await request(`/api/content/exports/${id}`)).json()).data;if(job.status!=='preparing')break;await new Promise(r=>setTimeout(r,10));}
  expect(job.status).toBe('completed');expect(job.delivery).toBe('not_requested');expect(await db.releaseExport.count({where:{releaseId:'test-release'}})).toBe(1);
  const download=await request(job.downloadUrl);expect(download.status).toBe(200);const bytes=Buffer.from(await download.arrayBuffer());expect(bytes.readUInt32LE()).toBe(0x04034b50);expect(bytes.includes(audio)).toBe(true);expect((await request(job.downloadUrl,{},other)).status).toBe(404);expect((await request(`/api/content/exports/${id}`,{},other)).status).toBe(404);
 });
 it('never duplicates a long-running export or retries an unknown Telegram delivery with a new requestId',async()=>{
  await db.releaseExport.create({data:{userId:owner,releaseId:'long-release',requestId:randomUUID(),title:'Long export',createdAt:new Date(Date.now()-600000)}});
  const input={requestId:randomUUID(),trackIds:[trackId],title:'Long export',sendTelegram:false};
  const repeated=await json('/api/content/releases/long-release/export',input);expect(repeated.response.status).toBe(202);expect(await db.releaseExport.count({where:{releaseId:'long-release'}})).toBe(1);
  isolated.botToken='integration-no-real-token';const fetchActual=globalThis.fetch;
  const intercepted=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{if(String(input).startsWith('https://api.telegram.org/'))throw new Error('Simulated lost delivery acknowledgement');return fetchActual(input,init);});
  try{
   const first=await json('/api/content/releases/uncertain-release/export',{...input,requestId:randomUUID(),sendTelegram:true});const id=first.body.data.id;let job:any;
   for(let tries=0;tries<50;tries++){job=(await (await request(`/api/content/exports/${id}`)).json()).data;if(job.status!=='preparing')break;await new Promise(r=>setTimeout(r,10));}
   expect(job.delivery).toBe('unknown');expect(job.status).toBe('uncertain');expect(job.downloadUrl).toBeTruthy();
   await db.releaseExport.update({where:{id},data:{createdAt:new Date(Date.now()-600000)}});
   const again=await json('/api/content/releases/uncertain-release/export',{...input,requestId:randomUUID(),sendTelegram:true});expect(again.body.data.id).toBe(id);expect(intercepted.mock.calls.filter(([url])=>String(url).startsWith('https://api.telegram.org/'))).toHaveLength(1);
  }finally{intercepted.mockRestore();isolated.botToken='';}
 });
 it('migrates the legacy username/userId beta schema additively and remains idempotent without losing library or identity data',async()=>{
  await db.playlist.create({data:{id:'preserved-playlist',userId:owner,title:'Keep my music'}});
  await db.$executeRawUnsafe('DROP TABLE "BetaAccess"');
  await db.$executeRawUnsafe('CREATE TABLE "BetaAccess" ("username" TEXT PRIMARY KEY,"userId" TEXT,"enabled" BOOLEAN NOT NULL DEFAULT true,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await db.$executeRawUnsafe('INSERT INTO "BetaAccess" ("username","userId","enabled") VALUES (?,?,?)','owner_test',owner,false);
  await db.$executeRawUnsafe('INSERT INTO "BetaAccess" ("username","userId","enabled") VALUES (?,?,?)','new_invitee',null,true);
  await db.$executeRawUnsafe('ALTER TABLE "PersonalTrack" DROP COLUMN "hasTimingOffset"');
  // A real startup migrates legacy DDL with fresh connections, before serving requests.
  await db.$disconnect();await db.$connect();
  const {ensureUserContentSchema}=await import('../server/src/database/ensureUserContentSchema.js');await Promise.all([ensureUserContentSchema(),ensureUserContentSchema(),ensureUserContentSchema()]);await ensureUserContentSchema();
  const access=await db.betaAccess.findUniqueOrThrow({where:{username:'owner_test'}});expect(access.id).toBe('legacy:owner_test');expect(access.telegramUserId).toBe(owner);expect(access.enabled).toBe(false);expect(access.updatedAt).toEqual(access.createdAt);
  expect((await db.betaAccess.findUniqueOrThrow({where:{username:'new_invitee'}})).telegramUserId).toBeNull();expect(await db.user.count()).toBe(3);expect((await db.playlist.findUniqueOrThrow({where:{id:'preserved-playlist'}})).title).toBe('Keep my music');expect(await db.userFile.count()).toBe(1);expect(await db.userReport.count()).toBeGreaterThan(0);
  expect((await db.personalTrack.findUniqueOrThrow({where:{userId_trackId:{userId:owner,trackId}}})).hasTimingOffset).toBe(true);
  expect((await db.personalTrack.findUniqueOrThrow({where:{userId_trackId:{userId:owner,trackId:'soundcloud:audio-only'}}})).hasTimingOffset).toBe(false);
  expect((await request('/api/content/reports')).status).toBe(403);
 });
});
