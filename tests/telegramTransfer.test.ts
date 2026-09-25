import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../server/src/config/env.js', () => ({env:{TELEGRAM_BOT_TOKEN:'test-only',TELEGRAM_BOT_USERNAME:'oskolokplayerbot',TELEGRAM_MODE:true}}));
vi.mock('../server/src/database/client.js', () => ({prisma:{user:{upsert:vi.fn()},playlist:{findUnique:vi.fn()}}}));
vi.mock('../server/src/services/StudioMasterService.js', () => ({studioMasterService:{getExportAudio:vi.fn(),prepareExportAudio:vi.fn(),prefetch:vi.fn()}}));
vi.mock('../server/src/controllers/trackController.js', () => ({trackController:{resolveTrack:vi.fn()}}));
vi.mock('node:fs', () => ({openAsBlob:vi.fn(async()=>new Blob(['test'],{type:'audio/mp4'}))}));
import { telegramController } from '../server/src/controllers/TelegramController.js';
import { userIdentity, ownPlaylist } from '../server/src/middleware/userIdentity.js';
import { prisma } from '../server/src/database/client.js';
import { studioMasterService } from '../server/src/services/StudioMasterService.js';
import { trackController } from '../server/src/controllers/trackController.js';
const response=(user?:number)=>{const r:any={locals:{userId:user?`telegram:${user}`:'local-user',telegramUser:user?{id:user}:undefined},status:vi.fn(),json:vi.fn()};r.status.mockReturnValue(r);return r;};
beforeEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();});
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
 it('cannot send from the unsigned desktop profile',async()=>{
  const res=response();await telegramController.sendProfileTrack({body:{trackId:'deezer:1',chat_id:555}} as any,res,vi.fn());
  expect(res.status).toHaveBeenCalledWith(401);
 });
 it('sends only to the verified user and deduplicates retries',async()=>{
  vi.mocked(trackController.resolveTrack).mockResolvedValue({id:'deezer:111',access:'playable',title:'Test',artist:{name:'Artist'}} as any);
  vi.mocked(studioMasterService.prepareExportAudio).mockResolvedValue({path:'/test',size:1000,mime:'audio/mp4',extension:'m4a'});
  const fetcher=vi.fn(async(_url:any,options:any)=>{expect(options.body.get('chat_id')).toBe('888');return {json:async()=>({ok:true,result:{message_id:7}})};});
  vi.stubGlobal('fetch',fetcher);
  const req:any={body:{trackId:'deezer:111',chat_id:555}},res=response(888);
  await telegramController.sendProfileTrack(req,res,vi.fn());await telegramController.sendProfileTrack(req,res,vi.fn());
  expect(fetcher).toHaveBeenCalledTimes(1);expect(res.json).toHaveBeenCalledWith({data:{status:'sent',chatUrl:'https://t.me/oskolokplayerbot',messageId:7}});
 });
 it('does not send an incomplete audio file',async()=>{
  vi.mocked(trackController.resolveTrack).mockResolvedValue({id:'deezer:222',access:'playable'} as any);vi.mocked(studioMasterService.prepareExportAudio).mockRejectedValue(new Error('Download incomplete'));
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const res=response(999);
  const next=vi.fn();await telegramController.sendProfileTrack({body:{trackId:'deezer:222'}} as any,res,next);
  expect(next).toHaveBeenCalledWith(expect.any(Error));expect(fetcher).not.toHaveBeenCalled();
 });
});
