import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import express from 'express';
import {PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {Server} from 'node:http';

const isolated=vi.hoisted(()=>({db:null as any,blend:vi.fn(async()=>({tracks:[{id:'mix-1',title:'Общее',artist:{name:'Кино'}}],status:'ok',version:'blend:v1'}))}));
vi.mock('../server/src/database/client.js',()=>({get prisma(){return isolated.db;}}));
vi.mock('../server/src/services/telegramSession.js',()=>({contactTelegramIds:vi.fn(async()=>[])}));
vi.mock('../server/src/services/wave/blendWave.js',()=>({buildBlendWave:isolated.blend}));
vi.mock('../server/src/controllers/musicAccounts.js',()=>({yandexAccessToken:vi.fn(async()=>null)}));

let directory:string,origin:string,server:Server,db:PrismaClient;
const anna='telegram:94000001',boris='telegram:94000002',vera='telegram:94000003';
const token=(id:string)=>`jam-session-${id}`;
const call=async(url:string,as:string,body?:unknown)=>{
  const r=await fetch(`${origin}/api${url}`,{method:body===undefined?'GET':'POST',headers:{Cookie:`oskolok_session=${token(as)}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json() as any};
};
const song=(id:string)=>({id,title:`Песня ${id}`,artist:{id:'a',name:'Артист'},duration:180});

beforeAll(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'oskolok-jam-'));
  const databaseUrl=`file:${path.join(directory,'isolated.sqlite')}`;
  vi.stubEnv('DATABASE_URL',databaseUrl);
  db=new PrismaClient({datasources:{db:{url:databaseUrl}}});isolated.db=db;
  const ddl=execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8'});
  for(const sql of ddl.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(sql);
  for(const [id,username,name] of [[anna,'anna_jam','Анна'],[boris,'boris_jam','Борис'],[vera,'vera_jam','Вера']]){
    await db.user.create({data:{id,name,username}});await db.betaAccess.create({data:{username,telegramUserId:id,enabled:true}});
    await db.webSession.create({data:{tokenHash:createHash('sha256').update(token(id)).digest('hex'),userId:id,expiresAt:new Date(Date.now()+3600000)}});
  }
  // Анна и Борис — друзья; Вера знает Бориса, но не Анну; заявка Веры к Анне не принята.
  await db.friendship.create({data:{requesterId:anna,addresseeId:boris,status:'accepted'}});
  await db.friendship.create({data:{requesterId:boris,addresseeId:vera,status:'accepted'}});
  await db.friendship.create({data:{requesterId:vera,addresseeId:anna,status:'pending'}});
  const [{connectRoutes},{recommendationController},{userIdentity},{errorHandler}]=await Promise.all([import('../server/src/controllers/connectController.js'),import('../server/src/controllers/recommendationController.js'),import('../server/src/middleware/userIdentity.js'),import('../server/src/middleware/errorHandler.js')]);
  const app=express();app.use(express.json());app.use('/api',userIdentity);app.use('/api/connect',connectRoutes);app.post('/api/recommendations/wave',recommendationController.getWave);app.use(errorHandler);
  server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const address=server.address();if(!address||typeof address==='string')throw new Error('no listener');origin=`http://127.0.0.1:${address.port}`;
},30000);
afterAll(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));if(db)await db.$disconnect();vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});

describe.sequential('Jam и «Волна на двоих»: только для друзей (Express + SQLite)',()=>{
  let jamId='';
  it('владелец создаёт Jam, друг видит его в списке и подключается',async()=>{
    const created=await call('/connect/jam',anna,{deviceId:'anna-device',queue:[song('1'),song('2')],index:0,position:12,isPlaying:true});
    expect(created.status).toBe(200);
    jamId=created.body.data.id;
    expect(created.body.data.members).toMatchObject([{name:'Анна',owner:true}]);
    expect((await call('/connect/jam',boris)).body.data.friends).toMatchObject([{id:jamId,owner:{name:'Анна'},members:1}]);
    const joined=await call(`/connect/jam/${jamId}/join`,boris,{deviceId:'boris-device'});
    expect(joined.status).toBe(200);
    expect(joined.body.data.members.map((m:any)=>m.name)).toEqual(['Анна','Борис']);
  });

  it('не друг владельца не подключается и не видит Jam, даже по ссылке',async()=>{
    expect((await call('/connect/jam',vera)).body.data.friends).toEqual([]);
    const denied=await call(`/connect/jam/${jamId}/join`,vera,{deviceId:'vera-device'});
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('JAM_FRIENDS_ONLY');
    expect((await call(`/connect/jam/${jamId}/add`,vera,{track:song('x')})).status).toBe(403);
    expect((await call(`/connect/jam/${jamId}/control`,vera,{action:'pause'})).status).toBe(403);
  });

  it('оба участника добавляют треки и управляют общей очередью',async()=>{
    expect((await call(`/connect/jam/${jamId}/add`,boris,{track:song('3')})).body.data.queue.map((e:any)=>e.track.id)).toEqual(['1','2','3']);
    expect((await call(`/connect/jam/${jamId}/add`,anna,{track:song('4'),mode:'next'})).body.data.queue.map((e:any)=>e.track.id)).toEqual(['1','4','2','3']);
    expect((await call(`/connect/jam/${jamId}/control`,boris,{action:'jump',index:1,fromIndex:0})).body.data.index).toBe(1);
    expect((await call(`/connect/jam/${jamId}/control`,anna,{action:'jump',index:1,fromIndex:0})).body.data.index).toBe(1);
    expect((await call(`/connect/jam/${jamId}/control`,anna,{action:'pause',position:20})).body.data).toMatchObject({isPlaying:false,position:20});
  });

  it('позвать можно только друзей владельца; приглашение попадает в уведомления',async()=>{
    // Вера — подруга Бориса, но не Анны: у двери её всё равно развернут.
    expect((await call(`/connect/jam/${jamId}/invite`,boris,{user:'94000003'})).status).toBe(403);
    expect((await call(`/connect/jam/${jamId}/invite`,anna,{user:'94000003'})).status).toBe(403);
    const ok=await call(`/connect/jam/${jamId}/invite`,anna,{user:'94000002'});
    expect(ok.status).toBe(200);
    const bell=await db.userNotification.findMany({where:{userId:boris}});
    expect(bell).toMatchObject([{kind:'friend',title:'Анна зовёт вас в Jam',url:`/jam/${jamId}`}]);
  });

  it('владелец уходит — Jam закрывается',async()=>{
    expect((await call(`/connect/jam/${jamId}/leave`,anna,{})).status).toBe(200);
    expect((await call('/connect/jam',boris)).body.data).toEqual({jam:null,friends:[]});
    expect((await call(`/connect/jam/${jamId}/join`,boris,{deviceId:'boris-device'})).status).toBe(404);
  });

  it('«Волна на двоих» строится только с другом',async()=>{
    const denied=await call('/recommendations/wave',vera,{v:2,language:'all',blendWith:'94000001'});
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('NOT_FRIENDS');
    expect(isolated.blend).not.toHaveBeenCalled();
    const ok=await call('/recommendations/wave',boris,{v:2,language:'all',limit:12,blendWith:'94000001'});
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({status:'ok',source:'oskolok',blend:{publicId:'94000001',name:'Анна'}});
    expect(isolated.blend).toHaveBeenCalledWith(expect.objectContaining({userId:boris,limit:12}),{userId:anna,name:'Анна'});
  });
});
