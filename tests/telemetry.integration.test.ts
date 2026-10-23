import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import express,{Router} from 'express';
import {PrismaClient} from '@prisma/client';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {Server} from 'node:http';

const isolated=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/src/database/client.js',()=>({get prisma(){return isolated.db;}}));

let directory:string,origin:string,server:Server,db:PrismaClient;
const lena='telegram:94000001';
const token=`telemetry-session-${lena}`;
const call=async(url:string,method='GET',body?:unknown)=>{const r=await fetch(`${origin}/api${url}`,{method,headers:{Cookie:`oskolok_session=${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
const event=(type:string,extra:Record<string,unknown>={})=>({id:randomUUID(),v:1,type,trackId:'deezer:1',artist:'Artist',sessionId:'s1',context:'wave',at:new Date().toISOString(),data:{},...extra});

beforeAll(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'oskolok-telemetry-'));
 const databaseUrl=`file:${path.join(directory,'isolated.sqlite')}`;
 vi.stubEnv('DATABASE_URL',databaseUrl);
 db=new PrismaClient({datasources:{db:{url:databaseUrl}}});isolated.db=db;
 const ddl=execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8'});
 for(const sql of ddl.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(sql);
 await db.user.create({data:{id:lena,name:'Лена',username:'lena_t'}});await db.betaAccess.create({data:{username:'lena_t',telegramUserId:lena,enabled:true}});
 await db.webSession.create({data:{tokenHash:createHash('sha256').update(token).digest('hex'),userId:lena,expiresAt:new Date(Date.now()+3600000)}});
 const [{telemetryController},{userIdentity},{errorHandler}]=await Promise.all([import('../server/src/controllers/telemetryController.js'),import('../server/src/middleware/userIdentity.js'),import('../server/src/middleware/errorHandler.js')]);
 const routes=Router();routes.get('/consent',telemetryController.getConsent);routes.put('/consent',telemetryController.setConsent);routes.post('/events',telemetryController.ingest);routes.delete('/events',telemetryController.reset);
 const app=express();app.use(express.json());app.use('/api',userIdentity);app.use('/api',routes);app.use(errorHandler);
 server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const address=server.address();if(!address||typeof address==='string')throw new Error('no listener');origin=`http://127.0.0.1:${address.port}`;
},30000);
afterAll(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));if(db)await db.$disconnect();vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});

describe.sequential('listening events on real Express + SQLite',()=>{
 it('stores nothing before consent',async()=>{
  expect((await call('/consent')).body.data).toMatchObject({personalization:false,training:false,decided:false});
  expect((await call('/events','POST',{events:[event('play_start')]})).status).toBe(403);
  expect(await db.trackEvent.count()).toBe(0);
 });
 it('stores a batch once even when it is sent twice, and marks training only with that consent',async()=>{
  await call('/consent','PUT',{personalization:true,training:false});
  const batch={events:[event('play_request'),event('listen',{data:{started:true,endReason:'natural',uniqueRatio:.9,listenedMs:180000,speed:1}})]};
  expect((await call('/events','POST',batch)).body.data).toMatchObject({stored:2,duplicates:0});
  expect((await call('/events','POST',batch)).body.data).toMatchObject({stored:0,duplicates:2});
  expect(await db.trackEvent.count({where:{training:true}})).toBe(0);
  await call('/consent','PUT',{personalization:true,training:true});
  await call('/events','POST',{events:[event('like')]});
  expect(await db.trackEvent.count({where:{training:true}})).toBe(1);
 });
 it('rejects free text and unknown fields in event data',async()=>{
  expect((await call('/events','POST',{events:[event('listen',{data:{query:'secret search'}})]})).status).toBe(400);
 });
 it('revoking training unmarks; revoking personalization deletes the stored events',async()=>{
  await call('/consent','PUT',{personalization:true,training:false});
  expect(await db.trackEvent.count({where:{training:true}})).toBe(0);
  expect(await db.trackEvent.count()).toBe(3);
  await call('/consent','PUT',{personalization:false,training:true});
  expect(await db.trackEvent.count()).toBe(0);
  expect((await call('/consent')).body.data).toMatchObject({personalization:false,training:false,decided:true});
 });
 it('offline evaluation uses only consented events, in time order, and compares with the library-only baseline',async()=>{
  await call('/consent','PUT',{personalization:true,training:true});
  const base=Date.now()-30*86400_000;
  const rows=Array.from({length:30},(_,i)=>({id:randomUUID(),userId:lena,sessionId:`s${i}`,type:'listen',trackId:`deezer:${i}`,artist:i%3===0?'Skip Band':'Loved Artist',context:'wave',data:JSON.stringify(i%3===0?{started:true,endReason:'manual-skip',uniqueRatio:.05}:{started:true,endReason:'natural',uniqueRatio:.95}),schemaVersion:1,training:true,at:new Date(base+i*3600_000)}));
  for(const data of rows)await db.trackEvent.create({data});
  const {evaluateRanking}=await import('../server/src/services/recsEvaluation.js');
  const {DEFAULT_PARAMS}=await import('../server/src/services/wave/profile.js');
  const report=await evaluateRanking(DEFAULT_PARAMS);
  expect(report.baseline.users).toBe(1);
  expect(report.baseline.hitAt10).toBe(0);
  expect(report.candidate.hitAt10).toBe(1);
  expect(report.enoughData).toBe(false);
 });
});
