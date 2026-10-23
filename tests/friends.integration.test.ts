import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import express from 'express';
import {PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {Server} from 'node:http';

const isolated=vi.hoisted(()=>({db:null as any,contacts:vi.fn(async()=>['93000002','99999999'])}));
vi.mock('../server/src/database/client.js',()=>({get prisma(){return isolated.db;}}));
vi.mock('../server/src/services/telegramSession.js',()=>({contactTelegramIds:isolated.contacts}));

let directory:string,origin:string,server:Server,db:PrismaClient;
const anna='telegram:93000001',boris='telegram:93000002',vera='telegram:93000003';
const token=(id:string)=>`friends-session-${id}`;
const call=async(url:string,as:string,method='GET')=>{const r=await fetch(`${origin}/api${url}`,{method,headers:{Cookie:`oskolok_session=${token(as)}`,'Content-Type':'application/json'},body:method==='POST'?'{}':undefined});return {status:r.status,body:await r.json() as any};};

beforeAll(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'oskolok-friends-'));
 const databaseUrl=`file:${path.join(directory,'isolated.sqlite')}`;
 vi.stubEnv('DATABASE_URL',databaseUrl);
 db=new PrismaClient({datasources:{db:{url:databaseUrl}}});isolated.db=db;
 const ddl=execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8'});
 for(const sql of ddl.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(sql);
 for(const [id,username,name] of [[anna,'anna_k','Анна'],[boris,'boris_m','Борис'],[vera,'vera_s','Вера']]){
  await db.user.create({data:{id,name,username}});await db.betaAccess.create({data:{username,telegramUserId:id,enabled:true}});
  await db.webSession.create({data:{tokenHash:createHash('sha256').update(token(id)).digest('hex'),userId:id,expiresAt:new Date(Date.now()+3600000)}});
 }
 const [{friendsRoutes},{userIdentity},{errorHandler}]=await Promise.all([import('../server/src/controllers/friendsController.js'),import('../server/src/middleware/userIdentity.js'),import('../server/src/middleware/errorHandler.js')]);
 const app=express();app.use(express.json());app.use('/api',userIdentity);app.use('/api',friendsRoutes);app.use(errorHandler);
 server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const address=server.address();if(!address||typeof address==='string')throw new Error('no listener');origin=`http://127.0.0.1:${address.port}`;
},30000);
afterAll(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));if(db)await db.$disconnect();vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});

describe.sequential('friends on real Express + SQLite',()=>{
 it('finds listeners by @username and by Cyrillic nickname, never yourself',async()=>{
  expect((await call('/people/search?q=@boris_m',anna)).body.data.map((p:any)=>p.username)).toEqual(['boris_m']);
  expect((await call('/people/search?q=вер',anna)).body.data[0].username).toBe('vera_s');
  expect((await call('/people/search?q=anna',anna)).body.data).toEqual([]);
 });
 it('request → notification → accept → both are friends',async()=>{
  expect((await call('/friends/93000002',anna,'POST')).body.data.relation).toBe('outgoing');
  const bell=await db.userNotification.findMany({where:{userId:boris}});
  expect(bell.map(n=>n.kind)).toEqual(['friend']);
  expect((await call('/friends',boris)).body.data.incoming.map((p:any)=>p.username)).toEqual(['anna_k']);
  expect((await call('/friends/93000001',boris,'POST')).body.data.relation).toBe('friends');
  expect((await call('/friends',anna)).body.data.friends.map((p:any)=>p.publicId)).toEqual(['93000002']);
  expect((await call('/friends/status/93000001',boris)).body.data.relation).toBe('friends');
 });
 it('shows only contacts who use Oskolok',async()=>{
  await db.telegramConnection.create({data:{userId:vera,encryptedSession:'x'}});
  const r=await call('/people/contacts',vera);
  expect(r.body.data.connected).toBe(true);
  expect(r.body.data.people.map((p:any)=>p.username)).toEqual(['boris_m']);
  expect((await call('/people/contacts',anna)).body.data.connected).toBe(false);
 });
 it('removing a friend clears both sides',async()=>{
  expect((await call('/friends/93000002',anna,'DELETE')).body.data.relation).toBe('none');
  expect((await call('/friends',boris)).body.data.friends).toEqual([]);
 });
});
