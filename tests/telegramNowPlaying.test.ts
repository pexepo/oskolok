import {beforeEach,describe,expect,it,vi} from 'vitest';

const mock=vi.hoisted(()=>({
  profile:{telegramFullIntegration:true,currentTrackData:null as string|null,playbackSessionId:null as string|null,playbackSeenAt:null as Date|null,telegramStatusTemplate:null as string|null},
  row:null as any,
  add:vi.fn(),save:vi.fn(),remove:vi.fn(),resolve:vi.fn(),
}));
vi.mock('../server/src/database/client.js',()=>({prisma:{
  creatorProfile:{upsert:vi.fn(async()=>mock.profile),findUnique:vi.fn(async()=>mock.profile),update:vi.fn(async({data}:any)=>Object.assign(mock.profile,data)),updateMany:vi.fn(async()=>({count:0}))},
  telegramNowPlaying:{findUnique:vi.fn(async()=>mock.row),upsert:vi.fn(async({create,update}:any)=>{mock.row={...mock.row,...(mock.row?update:create)};return mock.row;}),update:vi.fn(async({data}:any)=>{Object.assign(mock.row,data);return mock.row;}),updateMany:vi.fn(async({data}:any)=>{if(mock.row?.trackId)Object.assign(mock.row,data);return {count:1};}),findMany:vi.fn(async()=>[])},
  telegramConnection:{findUnique:vi.fn(async()=>({userId:'test'}))},
}}));
vi.mock('../server/src/services/StudioMasterService.js',()=>({studioMasterService:{prepareExportAudio:vi.fn(async()=>({path:'/test.m4a',extension:'m4a'}))}}));
vi.mock('../server/src/services/telegramSession.js',()=>({uploadProfileMusic:mock.add,saveProfileMusic:mock.save,removeProfileMusic:mock.remove}));
vi.mock('../server/src/services/telegramAudioAsset.js',()=>({prepareTelegramAudio:vi.fn(async(file:any)=>({path:file.path,cleanup:async()=>{}}))}));
vi.mock('../server/src/controllers/trackController.js',()=>({trackController:{resolveTrack:mock.resolve}}));
vi.mock('../server/src/utils/logger.js',()=>({logger:{warn:vi.fn(),info:vi.fn()}}));
import {updateNowPlaying,applyStatusTemplate,nowPlayingTiming} from '../server/src/services/telegramNowPlaying.js';
nowPlayingTiming.debounceMs=15;
import {studioMasterService} from '../server/src/services/StudioMasterService.js';
import {prisma} from '../server/src/database/client.js';

beforeEach(()=>{vi.clearAllMocks();vi.mocked(studioMasterService.prepareExportAudio).mockResolvedValue({path:'/test.m4a',extension:'m4a'} as any);Object.assign(mock.profile,{telegramFullIntegration:true,currentTrackData:null,playbackSessionId:null,playbackSeenAt:null,telegramStatusTemplate:null});mock.row=null;mock.resolve.mockImplementation(async(id:string)=>({id,title:id,artist:{name:'Artist'},duration:180,access:'playable'}));mock.add.mockImplementation(async()=>({id:'100',accessHash:'200',fileReference:'cmVm'}));});
describe('Telegram current track',()=>{
 it('keeps the previous profile music when preparing the replacement fails',async()=>{
  const user='telegram:test-preserve';
  await updateNowPlaying(user,'spotify:previous','device-a');
  await vi.waitFor(()=>expect(mock.row.operationState).toBe('active'));
  const attempts=nowPlayingTiming.maxAttempts;nowPlayingTiming.maxAttempts=1;
  try {
    vi.mocked(studioMasterService.prepareExportAudio).mockRejectedValueOnce(new Error('Полный аудиофайл недоступен.'));
    await updateNowPlaying(user,'spotify:unavailable','device-a');
    await vi.waitFor(()=>expect(vi.mocked(prisma.creatorProfile.update).mock.calls.some(call=>Boolean((call[0] as any).data.telegramSyncError))).toBe(true));
    expect(mock.row.trackId).toBe('spotify:previous');expect(mock.remove).not.toHaveBeenCalled();expect(mock.save).toHaveBeenCalledTimes(1);
  } finally {nowPlayingTiming.maxAttempts=attempts;}
 });
 it('uses the saved status template and re-uploads when it changes',async()=>{
  const user='telegram:test-template';mock.profile.telegramStatusTemplate='note';
  await updateNowPlaying(user,'spotify:one','device-a');
  await vi.waitFor(()=>expect(mock.row.operationState).toBe('active'));
  expect(mock.add.mock.calls[0][2]).toBe('♫ Слушает в @oskolokplayerbot - spotify:one');
  mock.profile.telegramStatusTemplate='kagi';
  await applyStatusTemplate(user);
  expect(mock.add).toHaveBeenCalledTimes(2);
  expect(mock.remove).toHaveBeenCalledTimes(1);
  expect(mock.add.mock.calls[1][2]).toBe('『Слушает в @oskolokplayerbot - spotify:one』');
  expect(mock.row.operationState).toBe('active');
 });
 it('replaces the temporary song and clears it on pause',async()=>{
  const user='telegram:test-one';
  await updateNowPlaying(user,'spotify:one','device-a');
  await vi.waitFor(()=>expect(mock.add).toHaveBeenCalledTimes(1));
  await vi.waitFor(()=>expect(mock.row.operationState).toBe('active'));
  expect(mock.save).toHaveBeenCalledTimes(1);
  expect(mock.add.mock.calls[0][2]).toBe('Слушает в @oskolokplayerbot - spotify:one');
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
 it('coalesces rapid track changes: only the last track is uploaded',async()=>{
  const user='telegram:test-burst';
  for(const id of ['spotify:a','spotify:b','spotify:c','spotify:d'])await updateNowPlaying(user,id,'device-a');
  await vi.waitFor(()=>expect(mock.row.operationState).toBe('active'));
  expect(mock.add).toHaveBeenCalledTimes(1);
  expect(mock.add.mock.calls[0][2]).toContain('spotify:d');
 });
 it('respects FLOOD_WAIT: reports it and retries after the given seconds',async()=>{
  const user='telegram:test-flood';
  mock.add.mockRejectedValueOnce(Object.assign(new Error('A wait of 0 seconds is required'),{errorMessage:'FLOOD',seconds:0}));
  await updateNowPlaying(user,'spotify:flood','device-a');
  await vi.waitFor(()=>expect(prisma.creatorProfile.update).toHaveBeenCalledWith(expect.objectContaining({data:{telegramSyncError:expect.stringMatching(/ограничил частоту/)}})));
  await vi.waitFor(()=>expect(mock.row.operationState).toBe('active'),{timeout:3000});
  expect(mock.add).toHaveBeenCalledTimes(2);
  expect((mock.profile as any).telegramSyncError).toBe(null);
 });
 it('retries a dropped connection with backoff instead of giving up',async()=>{
  const user='telegram:test-network';
  nowPlayingTiming.maxAttempts=6;
  mock.add.mockRejectedValueOnce(new Error('Connection closed'));
  vi.spyOn(Math,'random').mockReturnValue(0);
  await updateNowPlaying(user,'spotify:net','device-a');
  await vi.waitFor(()=>expect((mock.profile as any).telegramSyncError).toMatch(/Нет связи/));
  await vi.waitFor(()=>expect(mock.row.operationState).toBe('active'),{timeout:4000});
  vi.mocked(Math.random).mockRestore();
 });
 it('does not retry when the session was revoked',async()=>{
  const user='telegram:test-revoked';
  mock.add.mockRejectedValue(Object.assign(new Error('SESSION_REVOKED: AUTH_KEY_UNREGISTERED'),{name:'SessionRevokedError'}));
  await updateNowPlaying(user,'spotify:dead','device-a');
  await vi.waitFor(()=>expect((mock.profile as any).telegramSyncError).toMatch(/завершил сессию/));
  await new Promise(r=>setTimeout(r,80));
  expect(mock.add).toHaveBeenCalledTimes(1);
 });
});
