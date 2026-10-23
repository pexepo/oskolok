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
const owner='telegram:95000001',other='telegram:95000002';
const token=(id:string)=>`import-session-${id}`;
const call=async(url:string,as:string,method='GET',body?:unknown)=>{const r=await fetch(`${origin}/api${url}`,{method,headers:{Cookie:`oskolok_session=${token(as)}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};};
const track=(i:number)=>({id:`deezer:${i}`,title:`Song ${i}`,artist:{id:'a',name:'Artist'},duration:180,source:'deezer',sourceId:String(i),access:'playable'});

beforeAll(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'oskolok-import-'));
 const databaseUrl=`file:${path.join(directory,'isolated.sqlite')}`;
 vi.stubEnv('DATABASE_URL',databaseUrl);
 db=new PrismaClient({datasources:{db:{url:databaseUrl}}});isolated.db=db;
 const ddl=execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8'});
 for(const sql of ddl.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(sql);
 for(const [id,username] of [[owner,'import_owner'],[other,'import_other']]){await db.user.create({data:{id,name:username,username}});await db.betaAccess.create({data:{username,telegramUserId:id,enabled:true}});await db.webSession.create({data:{tokenHash:createHash('sha256').update(token(id)).digest('hex'),userId:id,expiresAt:new Date(Date.now()+3600000)}});}
 const [{playlistController},{userIdentity,ownPlaylist},{errorHandler}]=await Promise.all([import('../server/src/controllers/playlistController.js'),import('../server/src/middleware/userIdentity.js'),import('../server/src/middleware/errorHandler.js')]);
 const routes=Router();routes.post('/playlist-imports',playlistController.importPlaylist);routes.post('/playlist-imports/:requestId/chunks',playlistController.importChunk);routes.use('/playlists/:id',ownPlaylist);routes.get('/playlists/:id',playlistController.getPlaylist);
 const app=express();app.use(express.json({limit:'2mb'}));app.use('/api',userIdentity);app.use('/api',routes);app.use(errorHandler);
 server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const address=server.address();if(!address||typeof address==='string')throw new Error('no listener');origin=`http://127.0.0.1:${address.port}`;
},30000);
afterAll(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));if(db)await db.$disconnect();vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});

describe.sequential('playlist import on real Express + SQLite',()=>{
 const requestId=randomUUID();
 it('creates one playlist per confirmed request, in source order, private by default choice',async()=>{
  const body={requestId,title:'Перенос',isPublic:false,artworkUrl:'https://i.scdn.co/image/abc',tracks:[track(3),track(1),track(2)]};
  const first=await call('/playlist-imports',owner,'POST',body);
  expect(first.status).toBe(201);
  const again=await call('/playlist-imports',owner,'POST',body);
  expect(again.status).toBe(200);
  expect(again.body.data.playlist.id).toBe(first.body.data.playlist.id);
  expect(await db.playlist.count()).toBe(1);
  expect(first.body.data.playlist.tracks.map((t:any)=>t.trackId)).toEqual(['deezer:3','deezer:1','deezer:2']);
 });
 it('two simultaneous confirmations still create one playlist',async()=>{
  const body={requestId:randomUUID(),title:'Двойной клик',isPublic:false,tracks:[track(7)]};
  const [a,b]=await Promise.all([call('/playlist-imports',owner,'POST',body),call('/playlist-imports',owner,'POST',body)]);
  expect(a.body.data.playlist.id).toBe(b.body.data.playlist.id);
  expect(await db.playlist.count({where:{title:'Двойной клик'}})).toBe(1);
 });
 it('applies each chunk once and refuses a gap',async()=>{
  expect((await call(`/playlist-imports/${requestId}/chunks`,owner,'POST',{index:1,tracks:[track(4),track(5)]})).body.data).toMatchObject({applied:true,total:5});
  expect((await call(`/playlist-imports/${requestId}/chunks`,owner,'POST',{index:1,tracks:[track(4),track(5)]})).body.data).toMatchObject({applied:false,total:5});
  expect((await call(`/playlist-imports/${requestId}/chunks`,owner,'POST',{index:5,tracks:[track(6)]})).status).toBe(409);
  expect((await call(`/playlist-imports/${requestId}/chunks`,other,'POST',{index:2,tracks:[track(6)]})).status).toBe(404);
 });
 it('keeps a private playlist away from other listeners, also by direct id',async()=>{
  const id=(await db.playlist.findFirst())!.id;
  expect((await call(`/playlists/${id}`,owner)).status).toBe(200);
  expect((await call(`/playlists/${id}`,other)).status).toBe(404);
 });
 it('rejects a cover that is neither an image nor an https link',async()=>{
  expect((await call('/playlist-imports',owner,'POST',{requestId:randomUUID(),title:'x',isPublic:false,artworkUrl:'http://127.0.0.1/admin',tracks:[]})).status).toBe(400);
 });
});
