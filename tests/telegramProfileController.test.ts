import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../server/src/config/env.js',()=>({env:{}}));
vi.mock('../server/src/database/client.js',()=>({prisma:{telegramConnection:{findUnique:vi.fn()},profileMusic:{upsert:vi.fn()}}}));
vi.mock('../server/src/services/StudioMasterService.js',()=>({studioMasterService:{prepareExportAudio:vi.fn()}}));
vi.mock('../server/src/controllers/trackController.js',()=>({trackController:{resolveTrack:vi.fn()}}));
vi.mock('../server/src/services/telegramSession.js',()=>({addProfileMusic:vi.fn(),hashToken:vi.fn(),sessionHealth:vi.fn()}));
vi.mock('../server/src/services/telegramNowPlaying.js',()=>({profileMusicThumbnail:vi.fn(),applyStatusTemplate:vi.fn()}));
vi.mock('../server/src/services/telegramAudioAsset.js',()=>({prepareTelegramAudio:vi.fn()}));
import {prisma} from '../server/src/database/client.js';
import {studioMasterService} from '../server/src/services/StudioMasterService.js';
import {trackController} from '../server/src/controllers/trackController.js';
import {addProfileMusic} from '../server/src/services/telegramSession.js';
import {profileMusicThumbnail} from '../server/src/services/telegramNowPlaying.js';
import {prepareTelegramAudio} from '../server/src/services/telegramAudioAsset.js';
import {AudioFileError} from '../server/src/services/audioFileCache.js';
import {telegramController} from '../server/src/controllers/TelegramController.js';
const track={id:'spotify:test',title:'Song',artist:{name:'Artist'},duration:180,access:'playable'};
const req={body:{trackId:track.id}} as any;
const response=()=>{const res:any={locals:{userId:'telegram:test-profile'},status:vi.fn(),json:vi.fn()};res.status.mockReturnValue(res);return res;};
const assetCleanup=vi.fn(),coverCleanup=vi.fn();
beforeEach(()=>{
 vi.clearAllMocks();vi.mocked(prisma.telegramConnection.findUnique).mockResolvedValue({userId:'telegram:test-profile'} as any);
 vi.mocked(trackController.resolveTrack).mockResolvedValue(track as any);
 vi.mocked(studioMasterService.prepareExportAudio).mockResolvedValue({path:'/audio.mp3',size:600000,extension:'mp3',mime:'audio/mpeg'});
 vi.mocked(profileMusicThumbnail).mockResolvedValue({file:'/cover.jpg',cleanup:coverCleanup});
 vi.mocked(prepareTelegramAudio).mockResolvedValue({path:'/prepared.mp3',cleanup:assetCleanup});
 vi.mocked(addProfileMusic).mockResolvedValue({id:'1',accessHash:'2',fileReference:'ref'});
});
describe('Telegram profile music response',()=>{
 it('adds only after a completed audio export and cleans temporary assets',async()=>{
  const res=response();await telegramController.addMusic(req,res,vi.fn());
  expect(addProfileMusic).toHaveBeenCalledWith('telegram:test-profile','/prepared.mp3','Song','Artist',180,'/cover.jpg');
  expect(res.json).toHaveBeenCalledWith({data:{status:'added'}});expect(prisma.profileMusic.upsert).toHaveBeenCalledOnce();expect(assetCleanup).toHaveBeenCalledOnce();expect(coverCleanup).toHaveBeenCalledOnce();
 });
 it('returns a useful download error and releases the request lock for retry',async()=>{
  vi.mocked(studioMasterService.prepareExportAudio).mockRejectedValueOnce(new AudioFileError('Загрузка аудио прервалась. Попробуйте ещё раз.'));
  const failed=response();await telegramController.addMusic(req,failed,vi.fn());
  expect(failed.json).toHaveBeenCalledWith({error:{code:'PROFILE_MUSIC_FAILED',message:'Загрузка аудио прервалась. Попробуйте ещё раз.'}});expect(addProfileMusic).not.toHaveBeenCalled();
  const success=response();await telegramController.addMusic(req,success,vi.fn());expect(success.json).toHaveBeenCalledWith({data:{status:'added'}});
 });
 it('does not log the listener out when their MTProto session is absent',async()=>{
  vi.mocked(prisma.telegramConnection.findUnique).mockResolvedValue(null);
  const res=response();await telegramController.addMusic(req,res,vi.fn());expect(res.status).toHaveBeenCalledWith(403);expect(addProfileMusic).not.toHaveBeenCalled();
 });
 it('prevents overlapping clicks while a file is being prepared',async()=>{
  let finish!:(value:any)=>void;vi.mocked(studioMasterService.prepareExportAudio).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const first=telegramController.addMusic(req,response(),vi.fn());await vi.waitFor(()=>expect(studioMasterService.prepareExportAudio).toHaveBeenCalledOnce());
  const duplicate=response();await telegramController.addMusic(req,duplicate,vi.fn());expect(duplicate.status).toHaveBeenCalledWith(409);
  finish({path:'/audio.mp3',extension:'mp3'});await first;expect(addProfileMusic).toHaveBeenCalledOnce();
 });
 it('reports an unconfirmed Telegram write without inviting a blind retry',async()=>{
  vi.mocked(addProfileMusic).mockRejectedValueOnce(new Error('MUSIC_SAVE TIMEOUT'));
  const res=response();await telegramController.addMusic(req,res,vi.fn());
  expect(res.json).toHaveBeenCalledWith({error:{code:'PROFILE_MUSIC_FAILED',message:expect.stringMatching(/Проверьте музыку.*перед повторной/)}});expect(prisma.profileMusic.upsert).not.toHaveBeenCalled();expect(assetCleanup).toHaveBeenCalledOnce();
 });
});
