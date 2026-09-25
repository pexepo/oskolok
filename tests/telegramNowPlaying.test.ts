import {beforeEach,describe,expect,it,vi} from 'vitest';

const mock=vi.hoisted(()=>({
  profile:{telegramFullIntegration:true,currentTrackData:null as string|null,playbackSessionId:null as string|null,playbackSeenAt:null as Date|null},
  row:null as any,
  add:vi.fn(),save:vi.fn(),remove:vi.fn(),resolve:vi.fn(),
}));
vi.mock('../server/src/database/client.js',()=>({prisma:{
  creatorProfile:{upsert:vi.fn(async()=>mock.profile),findUnique:vi.fn(async()=>mock.profile),update:vi.fn(async({data}:any)=>Object.assign(mock.profile,data))},
  telegramNowPlaying:{findUnique:vi.fn(async()=>mock.row),upsert:vi.fn(async({create,update}:any)=>{mock.row={...mock.row,...(mock.row?update:create)};return mock.row;}),update:vi.fn(async({data}:any)=>{Object.assign(mock.row,data);return mock.row;}),findMany:vi.fn(async()=>[])},
  telegramConnection:{findUnique:vi.fn(async()=>({userId:'test'}))},
}}));
vi.mock('../server/src/services/StudioMasterService.js',()=>({studioMasterService:{prepareExportAudio:vi.fn(async()=>({path:'/test.m4a',extension:'m4a'}))}}));
vi.mock('../server/src/services/telegramSession.js',()=>({uploadProfileMusic:mock.add,saveProfileMusic:mock.save,removeProfileMusic:mock.remove}));
vi.mock('../server/src/services/telegramAudioAsset.js',()=>({prepareTelegramAudio:vi.fn(async(file:any)=>({path:file.path,cleanup:async()=>{}}))}));
vi.mock('../server/src/controllers/trackController.js',()=>({trackController:{resolveTrack:mock.resolve}}));
vi.mock('../server/src/utils/logger.js',()=>({logger:{warn:vi.fn()}}));
import {updateNowPlaying} from '../server/src/services/telegramNowPlaying.js';
import {studioMasterService} from '../server/src/services/StudioMasterService.js';

beforeEach(()=>{vi.clearAllMocks();vi.mocked(studioMasterService.prepareExportAudio).mockResolvedValue({path:'/test.m4a',extension:'m4a'} as any);Object.assign(mock.profile,{telegramFullIntegration:true,currentTrackData:null,playbackSessionId:null,playbackSeenAt:null});mock.row=null;mock.resolve.mockImplementation(async(id:string)=>({id,title:id,artist:{name:'Artist'},duration:180,access:'playable'}));mock.add.mockImplementation(async()=>({id:'100',accessHash:'200',fileReference:'cmVm'}));});
describe('Telegram current track',()=>{
 it('replaces the temporary song and clears it on pause',async()=>{
  const user='telegram:test-one';
  await updateNowPlaying(user,'spotify:one','device-a');
  await vi.waitFor(()=>expect(mock.add).toHaveBeenCalledTimes(1));
  await vi.waitFor(()=>expect(mock.row.operationState).toBe('active'));
  expect(mock.save).toHaveBeenCalledTimes(1);
  expect(mock.add.mock.calls[0][2]).toBe('Слушает в Осколок - spotify:one');
  await updateNowPlaying(user,'spotify:two','device-a');
  await vi.waitFor(()=>expect(mock.add).toHaveBeenCalledTimes(2));
  expect(mock.remove).toHaveBeenCalledTimes(1);
  await updateNowPlaying(user,null,'device-a');
  await vi.waitFor(()=>expect(mock.remove).toHaveBeenCalledTimes(2));
  expect(mock.row.trackId).toBe(null);
 });
 it('ignores a stale heartbeat or pause from another device',async()=>{
  const user='telegram:test-two';
  await updateNowPlaying(user,'spotify:new','device-new');
  await vi.waitFor(()=>expect(mock.add).toHaveBeenCalledTimes(1));
  await updateNowPlaying(user,'spotify:old','device-old',true);
  await updateNowPlaying(user,null,'device-old');
  expect(mock.row.desiredTrackId).toBe('spotify:new');
  expect(mock.remove).not.toHaveBeenCalled();
 });
 it('does not publish a download completed after pause',async()=>{
  const user='telegram:test-three';
  let release!:(value:any)=>void;
  vi.mocked(studioMasterService.prepareExportAudio).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  await updateNowPlaying(user,'spotify:slow','device-a');
  await vi.waitFor(()=>expect(studioMasterService.prepareExportAudio).toHaveBeenCalledTimes(1));
  await updateNowPlaying(user,null,'device-a');
  release({path:'/test.m4a',extension:'m4a'});
  await vi.waitFor(()=>expect(mock.row.desiredTrackId).toBe(null));
  await new Promise(resolve=>setTimeout(resolve,20));
  expect(mock.add).not.toHaveBeenCalled();
 });
});
