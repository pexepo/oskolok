import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import express from 'express';
import {PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {Server} from 'node:http';

const isolated=vi.hoisted(()=>({db:null as any,notify:vi.fn(async()=>{}),adminKey:'integration-only-admin-key'}));
vi.mock('../server/src/database/client.js',()=>({get prisma(){return isolated.db;}}));
vi.mock('../server/src/config/env.js',()=>({env:{ADMIN_API_KEY:isolated.adminKey,TELEGRAM_BOT_TOKEN:'',TELEGRAM_ADMIN_CHAT_ID:'',GENIUS_ACCESS_TOKEN:''}}));
vi.mock('../server/src/services/telegramBot.js',()=>({notifyUser:isolated.notify}));
vi.mock('../server/src/services/SpotifyService.js',()=>({spotifyService:{isConfigured:()=>false}}));
vi.mock('../server/src/services/SoundCloudService.js',()=>({soundCloudService:{search:vi.fn(async()=>({artists:[]}))}}));
vi.mock('../server/src/controllers/catalogController.js',()=>({catalogController:{artistDetails:vi.fn(async(_q:any,res:any)=>res.json({data:{artist:{name:'Test Artist'},releases:[]}}))}}));
vi.mock('../server/src/controllers/adminDashboard.js',()=>({registerAdminDashboard:()=>{}}));
vi.mock('../server/src/services/GeniusService.js',()=>({geniusArtist:vi.fn(async()=>null),geniusApi:vi.fn(),geniusCached:vi.fn(),geniusDate:vi.fn()}));

let directory:string,origin:string,server:Server,db:PrismaClient;
const owner='telegram:92000001',other='telegram:92000002';
const token=(id:string)=>`community-session-${id}`;
const flac=Buffer.concat([Buffer.from('fLaC'),Buffer.alloc(64,7)]);
const call=(url:string,options:RequestInit={},as:string|null=owner)=>{const headers=new Headers(options.headers);if(as)headers.set('Cookie',`oskolok_session=${token(as)}`);return fetch(`${origin}${url}`,{...options,headers});};
const json=async(url:string,body?:unknown,as:string|null=owner,method='POST')=>{const r=await call(url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},as);return {status:r.status,body:await r.json()};};
const admin=async(url:string,body?:unknown,method='POST')=>{const r=await fetch(`${origin}/api/admin${url}`,{method,headers:{Authorization:`Bearer ${isolated.adminKey}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};

beforeAll(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'oskolok-community-'));
 const databaseUrl=`file:${path.join(directory,'isolated.sqlite')}`;
 vi.stubEnv('DATABASE_URL',databaseUrl);vi.stubEnv('USER_CONTENT_DIR',path.join(directory,'uploads'));
 db=new PrismaClient({datasources:{db:{url:databaseUrl}}});isolated.db=db;
 const ddl=execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8'});
 for(const sql of ddl.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(sql);
 for(const [id,username] of [[owner,'owner_c'],[other,'other_c']]){await db.user.create({data:{id,name:username,username}});await db.betaAccess.create({data:{username,telegramUserId:id,enabled:true}});await db.webSession.create({data:{tokenHash:createHash('sha256').update(token(id)).digest('hex'),userId:id,expiresAt:new Date(Date.now()+3600000)}});}
 const [{communityRoutes,unreleasedCover},{adminRoutes},{userIdentity},{errorHandler}]=await Promise.all([import('../server/src/controllers/communityController.js'),import('../server/src/controllers/adminController.js'),import('../server/src/middleware/userIdentity.js'),import('../server/src/middleware/errorHandler.js')]);
 const app=express();app.use(express.json());app.use('/api/admin',adminRoutes);app.get('/api/unreleased/:id/cover',unreleasedCover);app.use('/api',userIdentity);app.use('/api',communityRoutes);app.use('/api/tracks/:id',(_req,res)=>{res.status(418).json({error:{message:'fell through'}});});app.use(errorHandler);
 server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const address=server.address();if(!address||typeof address==='string')throw new Error('no listener');origin=`http://127.0.0.1:${address.port}`;
},30000);
afterAll(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));if(db)await db.$disconnect();vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});

describe.sequential('community routes on real Express + SQLite',()=>{
 let submissionId='',trackId='';
 it('validates and stores an unreleased upload, visible only to its owner until approved',async()=>{
  expect((await call('/api/unreleased/files?kind=audio&fileName=x.wav',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:flac})).status).toBe(400);
  expect((await call('/api/unreleased/files?kind=audio&fileName=x.flac',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:Buffer.from('not audio at all')})).status).toBe(400);
  const up=await call('/api/unreleased/files?kind=audio&fileName=demo.flac',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:flac});expect(up.status).toBe(201);
  const audioId=(await up.json()).data.id;
  expect((await json('/api/unreleased',{title:'Ghost',artistName:'Test Artist',audioFileId:audioId,kind:'snippet'},other)).status).toBe(400);
  const created=await json('/api/unreleased',{title:'Ghost [Snippet]',artistName:'Test Artist',artistId:'spotify:artist:abc',audioFileId:audioId,kind:'snippet',duration:42});
  expect(created.status).toBe(201);submissionId=created.body.data.id;trackId=created.body.data.track.id;
  expect(created.body.data.track).toMatchObject({source:'unreleased',access:'playable',duration:42,artist:{id:'spotify:artist:abc',name:'Test Artist'}});
  expect((await call(`/api/tracks/${encodeURIComponent(trackId)}/stream`,{},other)).status).toBe(404);
  expect((await call(`/api/tracks/${encodeURIComponent(trackId)}/stream`,{headers:{Range:'bytes=0-1'}})).status).toBe(206);
  expect((await json(`/api/unreleased/artist?name=${encodeURIComponent('Test Artist')}`,undefined,other,'GET')).body.data).toEqual([]);
  expect((await json('/api/unreleased/mine',undefined,owner,'GET')).body.data[0].status).toBe('pending');
 });
 it('lets the developer panel edit and approve; approved tracks stream with ranges, list on the artist and search',async()=>{
  expect((await admin('/unreleased?status=pending',undefined,'GET')).body.data[0].audio.fileName).toBe('demo.flac');
  expect((await admin(`/unreleased/${submissionId}/update`,{title:'Ghost'})).body.data.title).toBe('Ghost');
  await json('/api/follows',{name:'Test Artist',artistId:'spotify:artist:abc'},other);
  expect((await admin(`/unreleased/${submissionId}/review`,{decision:'approved',reviewNote:'ok'})).body.data.status).toBe('approved');
  const ranged=await call(`/api/tracks/${encodeURIComponent(trackId)}/stream`,{headers:{Range:'bytes=4-9'}},other);
  expect(ranged.status).toBe(206);expect(ranged.headers.get('x-audio-source')).toBe('unreleased');expect(Buffer.from(await ranged.arrayBuffer())).toEqual(flac.subarray(4,10));
  expect((await json(`/api/tracks/${encodeURIComponent(trackId)}`,undefined,other,'GET')).body.data.title).toBe('Ghost');
  expect((await call('/api/tracks/spotify:other',{},other)).status).toBe(418);
  expect((await json(`/api/unreleased/artist?name=${encodeURIComponent('test artist')}`,undefined,other,'GET')).body.data.map((t:any)=>t.id)).toEqual([trackId]);
  expect((await json('/api/unreleased/search?q=ghost',undefined,other,'GET')).body.data.map((t:any)=>t.id)).toEqual([trackId]);
  expect((await json('/api/unreleased/'+submissionId,undefined,owner,'DELETE')).status).toBe(409);
  const notes=(await json('/api/notifications',undefined,other,'GET')).body.data;
  expect(notes.unread).toBe(1);expect(notes.items[0].kind).toBe('unreleased');
  expect((await json('/api/notifications',undefined,owner,'GET')).body.data.items[0].kind).toBe('unreleased-review');
 });
 it('tracks follows with counts and marks notifications read',async()=>{
  expect((await json('/api/follows/status?name=Test%20Artist',undefined,owner,'GET')).body.data).toMatchObject({following:false,followers:1});
  await json('/api/follows',{name:'Test Artist'});
  expect((await json('/api/follows/status?name=TEST%20ARTIST',undefined,owner,'GET')).body.data).toMatchObject({following:true,followers:2});
  expect((await json('/api/follows',undefined,owner,'GET')).body.data).toHaveLength(1);
  await json('/api/notifications/read',{},other);
  expect((await json('/api/notifications',undefined,other,'GET')).body.data.unread).toBe(0);
  expect((await json('/api/follows?name=Test%20Artist',undefined,owner,'DELETE')).body.data.following).toBe(false);
 });
 it('deletes the row and its stored files from the developer panel',async()=>{
  const row=await db.unreleasedTrack.findUniqueOrThrow({where:{id:submissionId}}),file=await db.userFile.findUniqueOrThrow({where:{id:row.audioFileId}});
  expect((await admin(`/unreleased/${submissionId}`,undefined,'DELETE')).status).toBe(200);
  await expect(access(file.path)).rejects.toThrow();expect(await db.userFile.findUnique({where:{id:file.id}})).toBeNull();
 });
});
