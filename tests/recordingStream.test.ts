import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('node:fs',()=>({default:{existsSync:()=>false,mkdirSync:vi.fn()}}));
vi.mock('../server/src/database/client.js',()=>({prisma:{}}));
vi.mock('../server/src/services/SoundCloudService.js',()=>({soundCloudService:{getPlaybackInfo:vi.fn()}}));
vi.mock('../server/src/services/StreamResolverService.js',()=>({streamResolverService:{}}));
vi.mock('../server/src/repositories/trackCacheRepository.js',()=>({trackCacheRepository:{}}));
import {StudioMasterService} from '../server/src/services/StudioMasterService.js';
import {soundCloudService} from '../server/src/services/SoundCloudService.js';
import type {Track} from '../server/src/types/index.js';
const track=(source:Track['source']):Track=>({id:`${source}:1:playback:${source}:exact`,source,sourceId:'1',title:'Song',artist:{id:'a',source,sourceId:'a',name:'Artist'},duration:180,access:'playable'});
beforeEach(()=>vi.clearAllMocks());
afterEach(()=>vi.useRealTimers());

describe('exact recording streams',()=>{
  it('never searches for a substitute when the chosen YouTube upload fails',async()=>{
    const service=new StudioMasterService();
    const worker=vi.spyOn(service as any,'sendWorkerRequest').mockResolvedValue({success:false});
    expect(await service.resolveStudioStream(track('youtube'),'youtube',true)).toBeNull();
    expect(worker).toHaveBeenCalledTimes(1);
    expect(worker).toHaveBeenCalledWith({action:'resolve_url',url:'https://www.youtube.com/watch?v=1'});
  });

  it('never substitutes a full recording for a preview-only SoundCloud upload',async()=>{
    const service=new StudioMasterService(),worker=vi.spyOn(service as any,'sendWorkerRequest');
    vi.mocked(soundCloudService.getPlaybackInfo).mockResolvedValue({available:true,url:'https://audio.test/preview/clip.mp3'} as any);
    expect(await service.resolveStudioStream(track('soundcloud'),'soundcloud',true)).toBeNull();
    expect(worker).not.toHaveBeenCalled();
  });

  it('retries a temporary failure after thirty seconds and keeps the recovered stream warm',async()=>{
    vi.useFakeTimers();
    const service=new StudioMasterService(),worker=vi.spyOn(service as any,'sendWorkerRequest').mockResolvedValueOnce({success:false}).mockResolvedValue({success:true,candidate:{streamUrl:'https://audio.test/selected.m4a'}});
    vi.spyOn(service as any,'cacheStreamToDisk').mockImplementation(()=>{});
    const selected=track('youtube');
    expect(await service.resolveStudioStream(selected,'youtube',true)).toBeNull();
    expect(await service.resolveStudioStream(selected,'youtube',true)).toBeNull();expect(worker).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31000);
    expect(await service.resolveStudioStream(selected,'youtube',true)).toMatchObject({audioSource:'youtube',streamUrl:'https://audio.test/selected.m4a'});
    await service.resolveStudioStream(selected,'youtube',true);expect(worker).toHaveBeenCalledTimes(2);
  });
});
