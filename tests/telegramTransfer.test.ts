import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../server/src/config/env.js', () => ({env:{TELEGRAM_BOT_TOKEN:'test-only',TELEGRAM_BOT_USERNAME:'oskolokplayerbot',TELEGRAM_MODE:true}}));
const durable=vi.hoisted(()=>({jobs:new Map<string,any>(),serial:0}));
vi.mock('../server/src/database/client.js', () => ({prisma:{
 user:{upsert:vi.fn()},playlist:{findUnique:vi.fn()},personalTrack:{findUnique:vi.fn()},userFile:{findFirst:vi.fn()},
 releaseExport:{
  findUnique:vi.fn(async({where}:any)=>[...durable.jobs.values()].find(j=>j.userId===where.userId_requestId.userId&&j.requestId===where.userId_requestId.requestId)||null),
  create:vi.fn(async({data}:any)=>{if([...durable.jobs.values()].some(j=>j.userId===data.userId&&j.requestId===data.requestId))throw Object.assign(new Error('duplicate'),{code:'P2002'});const job={id:String(++durable.serial),result:'{}',createdAt:new Date(),updatedAt:new Date(),...data};durable.jobs.set(job.id,job);return {...job};}),
  update:vi.fn(async({where,data}:any)=>{const job=durable.jobs.get(where.id);Object.assign(job,data);return {...job};}),
  updateMany:vi.fn(async({where,data}:any)=>{const job=durable.jobs.get(where.id);if(!job||job.status!==where.status)return {count:0};Object.assign(job,data);return {count:1};}),
 }
}}));
vi.mock('../server/src/services/StudioMasterService.js', () => ({studioMasterService:{getExportAudio:vi.fn(),prepareExportAudio:vi.fn(),prefetch:vi.fn()}}));
vi.mock('../server/src/controllers/trackController.js', () => ({trackController:{resolveTrack:vi.fn()}}));
vi.mock('node:fs', () => ({openAsBlob:vi.fn(async()=>new Blob(['test'],{type:'audio/mp4'}))}));
import { telegramController } from '../server/src/controllers/TelegramController.js';
import { userIdentity, ownPlaylist } from '../server/src/middleware/userIdentity.js';
import { prisma } from '../server/src/database/client.js';
import { studioMasterService } from '../server/src/services/StudioMasterService.js';
import { trackController } from '../server/src/controllers/trackController.js';
const response=(user?:number)=>{const r:any={locals:{userId:user?`telegram:${user}`:'local-user',telegramUser:user?{id:user}:undefined},status:vi.fn(),json:vi.fn()};r.status.mockReturnValue(r);return r;};
beforeEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();durable.jobs.clear();vi.mocked(prisma.personalTrack.findUnique).mockResolvedValue(null);vi.mocked(prisma.userFile.findFirst).mockResolvedValue(null);});
describe('Telegram transfer and data isolation',()=>{
 it('rejects unsigned requests in Telegram mode',async()=>{
  const res=response(),next=vi.fn();await userIdentity({get:()=>undefined,method:'GET',path:'/liked'} as any,res,next);
  expect(res.status).toHaveBeenCalledWith(401);expect(next).not.toHaveBeenCalled();
 });
 it('does not accept a forged initData header',()=>{
  const res=response(),next=vi.fn();userIdentity({get:()=> 'tma user=42',method:'GET',path:'/liked'} as any,res,next);
  expect(res.status).toHaveBeenCalledWith(401);expect(next).not.toHaveBeenCalled();
 });
 it('hides playlists owned by a different verified user',async()=>{
  vi.mocked(prisma.playlist.findUnique).mockResolvedValue({userId:'telegram:2'} as any);
  const res=response(1),next=vi.fn();await ownPlaylist({method:'PATCH',params:{id:'a'}} as any,res,next);
  expect(res.status).toHaveBeenCalledWith(404);expect(next).not.toHaveBeenCalled();
 });
 it('allows public playlist reads but never another owner’s writes',async()=>{
  vi.mocked(prisma.playlist.findUnique).mockResolvedValue({userId:'telegram:2',isPublic:true} as any);
  const read=response(1),next=vi.fn();await ownPlaylist({method:'GET',params:{id:'public'}} as any,read,next);expect(next).toHaveBeenCalledOnce();
  const write=response(1),deny=vi.fn();await ownPlaylist({method:'PATCH',params:{id:'public'}} as any,write,deny);expect(write.status).toHaveBeenCalledWith(404);expect(deny).not.toHaveBeenCalled();
 });
 it('hides private playlist contents from other users',async()=>{
  vi.mocked(prisma.playlist.findUnique).mockResolvedValue({userId:'telegram:2',isPublic:false} as any);
  const res=response(1),next=vi.fn();await ownPlaylist({method:'GET',params:{id:'private'}} as any,res,next);expect(res.status).toHaveBeenCalledWith(404);expect(next).not.toHaveBeenCalled();
 });
 it('cannot send from the unsigned desktop profile',async()=>{
  const res=response();await telegramController.sendProfileTrack({body:{trackId:'deezer:1',chat_id:555}} as any,res,vi.fn());
  expect(res.status).toHaveBeenCalledWith(401);
 });
 it('sends only to the verified user and deduplicates retries after process state is discarded',async()=>{
  vi.mocked(trackController.resolveTrack).mockResolvedValue({id:'deezer:111',access:'playable',title:'Test',artist:{name:'Artist'}} as any);
  vi.mocked(studioMasterService.prepareExportAudio).mockResolvedValue({path:'/test',size:1000,mime:'audio/mp4',extension:'m4a'});
  const fetcher=vi.fn(async(_url:any,options:any)=>{expect(options.body.get('chat_id')).toBe('888');return {json:async()=>({ok:true,result:{message_id:7}})};});
  vi.stubGlobal('fetch',fetcher);
  const req:any={body:{trackId:'deezer:111',chat_id:555}},res=response(888);
  await telegramController.sendProfileTrack(req,res,vi.fn());vi.resetModules();const restarted=await import('../server/src/controllers/TelegramController.js');await restarted.telegramController.sendProfileTrack(req,res,vi.fn());
  expect(fetcher).toHaveBeenCalledTimes(1);expect(res.json).toHaveBeenCalledWith({data:{status:'sent',chatUrl:'https://t.me/oskolokplayerbot',messageId:7}});
 });
 it('does not send an incomplete audio file',async()=>{
  vi.mocked(trackController.resolveTrack).mockResolvedValue({id:'deezer:222',access:'playable'} as any);vi.mocked(studioMasterService.prepareExportAudio).mockRejectedValue(new Error('Download incomplete'));
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const res=response(999);
  const next=vi.fn();await telegramController.sendProfileTrack({body:{trackId:'deezer:222'}} as any,res,next);
  expect(next).toHaveBeenCalledWith(expect.any(Error));expect(fetcher).not.toHaveBeenCalled();
 });
});

describe('durable Telegram delivery',()=>{
 const track={id:'spotify:personal',access:'metadata',source:'spotify',title:'Personal',artist:{name:'Artist'}};
 it('exports the owner’s personal file even if the catalog source cannot export',async()=>{
  vi.mocked(trackController.resolveTrack).mockResolvedValue(track as any);
  vi.mocked(prisma.personalTrack.findUnique).mockResolvedValue({audioFileId:'own-file'} as any);
  vi.mocked(prisma.userFile.findFirst).mockResolvedValue({id:'own-file',path:'/private/audio.mp3',fileName:'audio.mp3',mime:'audio/mpeg',size:1000} as any);
  const fetcher=vi.fn(async()=>({json:async()=>({ok:true,result:{message_id:88}})}));vi.stubGlobal('fetch',fetcher);
  const res=response(11);await telegramController.sendProfileTrack({body:{trackId:track.id}} as any,res,vi.fn());
  expect(prisma.userFile.findFirst).toHaveBeenCalledWith({where:{id:'own-file',userId:'telegram:11',trackId:track.id,kind:'audio'}});
  expect(studioMasterService.prepareExportAudio).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce();
  expect([...durable.jobs.values()][0].status).toBe('track_sent');
 });
 it('never resends an uncertain delivery after timeout and restart',async()=>{
  vi.mocked(trackController.resolveTrack).mockResolvedValue({...track,access:'playable'} as any);
  vi.mocked(studioMasterService.prepareExportAudio).mockResolvedValue({path:'/test',size:1000,mime:'audio/mp4',extension:'m4a'});
  const fetcher=vi.fn(async()=>{throw new Error('timeout');});vi.stubGlobal('fetch',fetcher);
  const req={body:{trackId:track.id}} as any,res=response(12);
  await telegramController.sendProfileTrack(req,res,vi.fn());
  expect([...durable.jobs.values()][0].status).toBe('track_uncertain');
  vi.resetModules();const restarted=await import('../server/src/controllers/TelegramController.js');await restarted.telegramController.sendProfileTrack(req,res,vi.fn());
  expect(fetcher).toHaveBeenCalledOnce();expect(res.json).toHaveBeenLastCalledWith({error:expect.objectContaining({code:'TELEGRAM_TRANSFER_UNCERTAIN'})});
 });
 it('does not replay a process interrupted after recording sendAudio intent',async()=>{
  const {claimTrackDelivery,markTrackDelivery}=await import('../server/src/services/telegramTrackDelivery.js');
  const claim=await claimTrackDelivery('telegram:13',track.id);await markTrackDelivery(claim.job.id,'track_sending');
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const res=response(13);
  await telegramController.sendProfileTrack({body:{trackId:track.id}} as any,res,vi.fn());
  expect(fetcher).not.toHaveBeenCalled();expect(res.status).toHaveBeenCalledWith(409);
 });
 it('allows retry only after a definitive Telegram rejection',async()=>{
  vi.mocked(trackController.resolveTrack).mockResolvedValue({...track,access:'playable'} as any);
  vi.mocked(studioMasterService.prepareExportAudio).mockResolvedValue({path:'/test',size:1000,mime:'audio/mp4',extension:'m4a'});
  const fetcher=vi.fn().mockResolvedValueOnce({json:async()=>({ok:false,error_code:403})}).mockResolvedValueOnce({json:async()=>({ok:true,result:{message_id:99}})});vi.stubGlobal('fetch',fetcher);
  const req={body:{trackId:track.id}} as any,res=response(14);
  await telegramController.sendProfileTrack(req,res,vi.fn());expect([...durable.jobs.values()][0].status).toBe('track_failed');
  await telegramController.sendProfileTrack(req,res,vi.fn());expect(fetcher).toHaveBeenCalledTimes(2);expect([...durable.jobs.values()][0].status).toBe('track_sent');
 });
 it('atomically claims concurrent requests across independent callers',async()=>{
  const {claimTrackDelivery}=await import('../server/src/services/telegramTrackDelivery.js');
  const claims=await Promise.all([claimTrackDelivery('telegram:15',track.id),claimTrackDelivery('telegram:15',track.id)]);
  expect(claims.filter(c=>c.claimed)).toHaveLength(1);expect(durable.jobs.size).toBe(1);
 });
});
