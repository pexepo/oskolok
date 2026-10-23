import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import {PrismaClient} from '@prisma/client';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {Server} from 'node:http';

const isolated=vi.hoisted(()=>({db:null as any,send:vi.fn(async(..._args:any[])=>({message_id:1})),adminKey:'beta-test-only'}));
vi.mock('../server/src/database/client.js',()=>({get prisma(){return isolated.db;}}));
vi.mock('../server/src/config/env.js',()=>({env:{ADMIN_API_KEY:isolated.adminKey,TELEGRAM_BOT_TOKEN:'mock-token'}}));
vi.mock('../server/src/services/telegramBotApi.js',async importOriginal=>({...await importOriginal<any>(),sendBanner:isolated.send}));
vi.mock('../server/src/services/telegramBot.js',()=>({notifyUser:vi.fn()}));
vi.mock('../server/src/controllers/adminDashboard.js',()=>({registerAdminDashboard:()=>{}}));
vi.mock('../server/src/controllers/communityController.js',()=>({registerAdminUnreleased:()=>{}}));
vi.mock('../server/src/utils/logger.js',()=>({logger:{warn:vi.fn(),info:vi.fn()}}));

import {grantBetaAccess,notifyBetaApproval,registerBetaBotContact} from '../server/src/services/telegramBetaNotifications.js';
import {checkBetaAccess} from '../server/src/services/telegramBeta.js';
import {BotApiError} from '../server/src/services/telegramBotApi.js';

let directory:string,origin:string,server:Server,db:PrismaClient;
const first='telegram:92000001',second='telegram:92000002';
const post=async(username:string,key=isolated.adminKey)=>{
 const response=await fetch(`${origin}/beta`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({username})});
 return {status:response.status,body:await response.json()};
};
const notificationState=(id:string,state:string)=>vi.waitFor(async()=>expect((await db.betaAccess.findUniqueOrThrow({where:{id}})).approvalNotificationState).toBe(state));

beforeAll(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'oskolok-beta-notifications-'));
 const databaseUrl=`file:${path.join(directory,'isolated.sqlite')}`;
 vi.stubEnv('DATABASE_URL',databaseUrl);
 db=new PrismaClient({datasources:{db:{url:databaseUrl}}});isolated.db=db;
 const ddl=execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8'});
 for(const sql of ddl.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(sql);
 const {adminRoutes}=await import('../server/src/controllers/adminController.js');
 const app=express();app.use(express.json());app.use(adminRoutes);
 server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const address=server.address();if(!address||typeof address==='string')throw new Error('no listener');origin=`http://127.0.0.1:${address.port}`;
},30000);
beforeEach(async()=>{await db.betaAccess.deleteMany();await db.telegramBotContact.deleteMany();await db.user.deleteMany();isolated.send.mockReset().mockResolvedValue({message_id:1});});
afterAll(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));if(db)await db.$disconnect();vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});

describe.sequential('beta approval notifications on real Express + SQLite',()=>{
 it('remembers a denied bot visitor and notifies once when their username is approved',async()=>{
  await registerBetaBotContact(first,'Beta_Visitor');
  expect(await checkBetaAccess(first,'beta_visitor')).toBe(false);
  const result=await post(' @Beta_Visitor ');expect(result.status).toBe(200);
  await notificationState(result.body.data.id,'sent');
  expect(isolated.send).toHaveBeenCalledOnce();
  expect(isolated.send).toHaveBeenCalledWith(first.slice(9),'beta-approved',expect.objectContaining({text:expect.stringContaining('одобрены на бету')}),{inline_keyboard:[[{text:'Открыть Осколок',url:'https://oskolok.lol/'}]]});
  expect(await checkBetaAccess(first,'beta_visitor')).toBe(true);
  await post('beta_visitor');await notifyBetaApproval(result.body.data.id);
  expect(isolated.send).toHaveBeenCalledOnce();
 });
 it('keeps an invitation pending until a new listener opens the bot',async()=>{
  const result=await post('not_started');
  expect(result.status).toBe(200);expect(isolated.send).not.toHaveBeenCalled();
  await registerBetaBotContact(first,'not_started');
  await notificationState(result.body.data.id,'sent');
  await registerBetaBotContact(first,'not_started');
  expect(isolated.send).toHaveBeenCalledOnce();
 });
 it('notifies a previous Mini App visitor using their case-insensitive verified User username',async()=>{
  await db.user.createMany({data:[{id:first,username:'ExIsTiNg_MiNi'},{id:'local:1',username:'existing_mini'}]});
  const result=await post('existing_mini');await notificationState(result.body.data.id,'sent');
  expect(isolated.send).toHaveBeenCalledOnce();expect(isolated.send.mock.calls[0][0]).toBe(first.slice(9));
  expect((await db.betaAccess.findUniqueOrThrow({where:{id:result.body.data.id}})).telegramUserId).toBe(first);
  expect(await db.telegramBotContact.count()).toBe(0);
 });
 it('leaves an ambiguous case-insensitive User lookup unbound and pending',async()=>{
  await db.user.createMany({data:[{id:first,username:'Ambiguous_User'},{id:second,username:'ambiguous_user'}]});
  const result=await post('ambiguous_user');await notifyBetaApproval(result.body.data.id);
  expect(isolated.send).not.toHaveBeenCalled();
  expect(await db.betaAccess.findUniqueOrThrow({where:{id:result.body.data.id}})).toMatchObject({telegramUserId:null,approvalNotificationState:'pending'});
 });
 it('does not notify nonnumeric Telegram IDs from the User fallback',async()=>{
  await db.user.create({data:{id:'telegram:invalid',username:'invalid_fallback'}});
  const result=await post('invalid_fallback');await notifyBetaApproval(result.body.data.id);
  expect(isolated.send).not.toHaveBeenCalled();
  expect((await db.betaAccess.findUniqueOrThrow({where:{id:result.body.data.id}})).telegramUserId).toBeNull();
 });
 it('does not override a newer bot username with stale User data',async()=>{
  await db.user.create({data:{id:first,username:'stale_username'}});
  await registerBetaBotContact(first,'current_username');
  const result=await post('stale_username');await notifyBetaApproval(result.body.data.id);
  expect(isolated.send).not.toHaveBeenCalled();
  expect((await db.betaAccess.findUniqueOrThrow({where:{id:result.body.data.id}})).telegramUserId).toBeNull();
  expect((await db.telegramBotContact.findUniqueOrThrow({where:{userId:first}})).username).toBe('current_username');
 });
 it('does not restore a removed bot username from stale User data',async()=>{
  await db.user.create({data:{id:first,username:'removed_username'}});
  await registerBetaBotContact(first);
  const result=await post('removed_username');await notifyBetaApproval(result.body.data.id);
  expect(isolated.send).not.toHaveBeenCalled();
  expect((await db.betaAccess.findUniqueOrThrow({where:{id:result.body.data.id}})).telegramUserId).toBeNull();
 });
 it('prefers a current bot contact over an older Mini App username owner',async()=>{
  await db.user.create({data:{id:first,username:'changed_owner'}});
  await registerBetaBotContact(second,'changed_owner');
  const result=await post('changed_owner');await notificationState(result.body.data.id,'sent');
  expect(isolated.send).toHaveBeenCalledOnce();expect(isolated.send.mock.calls[0][0]).toBe(second.slice(9));
  expect((await db.betaAccess.findUniqueOrThrow({where:{id:result.body.data.id}})).telegramUserId).toBe(second);
 });
 it('does not reuse a User identity already bound to another beta invitation',async()=>{
  await db.user.create({data:{id:first,username:'already_bound'}});
  await db.betaAccess.create({data:{username:'original_invite',telegramUserId:first,enabled:false}});
  const result=await post('already_bound');await notifyBetaApproval(result.body.data.id);
  expect(isolated.send).not.toHaveBeenCalled();
  expect((await db.betaAccess.findUniqueOrThrow({where:{id:result.body.data.id}})).telegramUserId).toBeNull();
 });
 it('claims a notification once across simultaneous delivery workers',async()=>{
  const item=await grantBetaAccess('concurrent');
  await db.betaAccess.update({where:{id:item.id},data:{telegramUserId:first}});
  await Promise.all([notifyBetaApproval(item.id),notifyBetaApproval(item.id),notifyBetaApproval(item.id)]);
  expect(isolated.send).toHaveBeenCalledOnce();await notificationState(item.id,'sent');
 });
 it('re-enables the original identity once even after its username is recycled',async()=>{
  await registerBetaBotContact(first,'recycled_name');
  const item=await grantBetaAccess('recycled_name');await notifyBetaApproval(item.id);
  await registerBetaBotContact(first,'renamed_original');
  await registerBetaBotContact(second,'recycled_name');
  await db.betaAccess.update({where:{id:item.id},data:{enabled:false}});
  isolated.send.mockClear();
  const enabled=await post('recycled_name');await notificationState(item.id,'sent');
  expect(enabled.body.data.approvalNotificationId).not.toBe(item.approvalNotificationId);
  expect(isolated.send).toHaveBeenCalledOnce();expect(isolated.send.mock.calls[0][0]).toBe(first.slice(9));
  expect(await checkBetaAccess(second,'recycled_name')).toBe(false);
  expect(await checkBetaAccess(first,'renamed_original')).toBe(true);
 });
 it('does not let a replacement username owner claim an existing pending binding',async()=>{
  const item=await grantBetaAccess('bound_pending');
  await db.betaAccess.update({where:{id:item.id},data:{telegramUserId:first}});
  isolated.send.mockRejectedValueOnce(new BotApiError('sendPhoto',403,'bot was blocked by the user'));
  await registerBetaBotContact(second,'bound_pending');
  expect(isolated.send).not.toHaveBeenCalled();
  await notificationState(item.id,'pending');
  await notifyBetaApproval(item.id);
  expect(isolated.send.mock.calls.every(call=>call[0]===first.slice(9))).toBe(true);
  expect(await checkBetaAccess(second,'bound_pending')).toBe(false);
 });
 it('preserves access after an explicit Telegram rejection and retries when the listener returns',async()=>{
  await registerBetaBotContact(first,'blocked_user');
  isolated.send.mockRejectedValueOnce(new BotApiError('sendPhoto',403,'bot was blocked by the user'));
  const result=await post('blocked_user');
  await vi.waitFor(()=>expect(isolated.send).toHaveBeenCalledOnce());await notificationState(result.body.data.id,'pending');
  expect(await checkBetaAccess(first,'blocked_user')).toBe(true);
  await registerBetaBotContact(first,'blocked_user');await notificationState(result.body.data.id,'sent');
  expect(isolated.send).toHaveBeenCalledTimes(2);
 });
 it('does not resend after a timeout with an unknown delivery result',async()=>{
  const item=await grantBetaAccess('unknown_result');
  await db.betaAccess.update({where:{id:item.id},data:{telegramUserId:first}});
  isolated.send.mockRejectedValueOnce(new Error('fetch timeout'));
  await notifyBetaApproval(item.id);await notificationState(item.id,'unknown');
  await registerBetaBotContact(first,'unknown_result');await post('unknown_result');await notifyBetaApproval(item.id);
  expect(isolated.send).toHaveBeenCalledOnce();expect(await checkBetaAccess(first,'unknown_result')).toBe(true);
 });
 it('does not let a previous in-flight delivery overwrite a later approval generation',async()=>{
  const item=await grantBetaAccess('new_generation');
  await db.betaAccess.update({where:{id:item.id},data:{telegramUserId:first}});
  let finish!:(value:{message_id:number})=>void;
  isolated.send.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const previous=notifyBetaApproval(item.id);
  await vi.waitFor(()=>expect(isolated.send).toHaveBeenCalledOnce());
  await db.betaAccess.update({where:{id:item.id},data:{enabled:false}});
  const renewed=await grantBetaAccess('new_generation');
  expect(renewed.approvalNotificationId).not.toBe(item.approvalNotificationId);
  finish({message_id:1});await previous;
  await notificationState(item.id,'pending');
  await notifyBetaApproval(item.id);await notificationState(item.id,'sent');
  expect(isolated.send).toHaveBeenCalledTimes(2);
 });
 it('keeps only the latest verified username lookup and never moves a stable access binding',async()=>{
  await registerBetaBotContact(first,'old_username');await registerBetaBotContact(first,'new_username');
  expect(await db.telegramBotContact.findUnique({where:{username:'old_username'}})).toBeNull();
  await registerBetaBotContact(second,'new_username');
  expect((await db.telegramBotContact.findUniqueOrThrow({where:{userId:first}})).username).toBeNull();
  expect((await db.telegramBotContact.findUniqueOrThrow({where:{username:'new_username'}})).userId).toBe(second);
 });
 it('does not send a retrospective notification when an active legacy invitation is added again',async()=>{
  const item=await db.betaAccess.create({data:{username:'legacy_active',telegramUserId:first}});
  const result=await post('legacy_active');await notifyBetaApproval(item.id);
  expect(result.status).toBe(200);expect(isolated.send).not.toHaveBeenCalled();
 });
 it('upgrades the old SQLite schema additively and does not notify existing active testers',async()=>{
  await db.$executeRawUnsafe('DROP TABLE "TelegramBotContact"');
  await db.$executeRawUnsafe('DROP TABLE "BetaAccess"');
  await db.$executeRawUnsafe('CREATE TABLE "BetaAccess" ("id" TEXT PRIMARY KEY,"username" TEXT NOT NULL UNIQUE,"telegramUserId" TEXT UNIQUE,"enabled" BOOLEAN NOT NULL DEFAULT true,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await db.$executeRawUnsafe(`INSERT INTO "BetaAccess" ("id","username","telegramUserId","enabled") VALUES ('upgrade-active','upgrade_active','${first}',true),('upgrade-revoked','upgrade_revoked','${second}',false)`);
  const preserved='SELECT "id","username","telegramUserId","enabled","createdAt","updatedAt" FROM "BetaAccess" ORDER BY "id"';
  const before=await db.$queryRawUnsafe(preserved);
  const {ensureUserContentSchema}=await import('../server/src/database/ensureUserContentSchema.js');
  await ensureUserContentSchema();await ensureUserContentSchema();
  expect(await db.$queryRawUnsafe(preserved)).toEqual(before);
  const rows=await db.betaAccess.findMany({orderBy:{id:'asc'}});
  expect(rows.map(row=>[row.enabled,row.telegramUserId,row.approvalNotificationId,row.approvalNotificationState])).toEqual([[true,first,null,'none'],[false,second,null,'none']]);
  expect(await db.telegramBotContact.count()).toBe(0);
  await registerBetaBotContact(first,'upgrade_active');
  expect((await post('upgrade_active')).status).toBe(200);await notifyBetaApproval('upgrade-active');
  expect(isolated.send).not.toHaveBeenCalled();
 });
 it('checks admin authorization before granting access',async()=>{
  expect((await post('unauthorized','wrong-key')).status).toBe(401);
  expect(await db.betaAccess.count()).toBe(0);expect(isolated.send).not.toHaveBeenCalled();
 });
});
