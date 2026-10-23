import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({resolve:vi.fn(),findUnique:vi.fn(),findMany:vi.fn(),upsert:vi.fn(),search:vi.fn(),cache:vi.fn()}));
vi.mock('../server/src/database/client.js',()=>({prisma:{artistEnrichment:{findUnique:mocks.findUnique,findMany:mocks.findMany,upsert:mocks.upsert}}}));
vi.mock('../server/src/controllers/trackController.js',()=>({trackController:{resolveTrack:mocks.resolve}}));
vi.mock('../server/src/services/StudioMasterService.js',()=>({studioMasterService:{searchTracks:mocks.search}}));
vi.mock('../server/src/services/SoundCloudService.js',()=>({soundCloudService:{search:mocks.search}}));
vi.mock('../server/src/repositories/trackCacheRepository.js',()=>({trackCacheRepository:{setCachedTrack:mocks.cache}}));
import {recordingRoutes,recordingKey} from '../server/src/controllers/recordingController.js';

const original={id:'spotify:1',source:'spotify',sourceId:'1',title:'Lose Yourself',artist:{name:'Eminem'},duration:180,access:'playable'};
const candidate={...original,id:'youtube:1',source:'youtube',title:'Eminem - Lose Yourself (Official Video)',artist:{name:'Uploader'}};
const handler=(method:string):((req:any,res:any,next:any)=>Promise<void>)=>{
  const layer=recordingRoutes.stack.find((entry:any)=>entry.route?.methods[method]);
  if(!layer?.route)throw new Error(`Recording route missing: ${method}`);
  return layer.route.stack[0].handle as (req:any,res:any,next:any)=>Promise<void>;
};
const response=()=>{const res:any={locals:{userId:'telegram:7'},statusCode:200,status(code:number){this.statusCode=code;return this;},json:vi.fn()};return res;};
beforeEach(()=>{vi.resetAllMocks();mocks.resolve.mockResolvedValue(original);mocks.findMany.mockResolvedValue([]);});

describe('recording selection and censorship votes',()=>{
  it('caches upload IDs and associates the listener’s vote with the original track',async()=>{
    mocks.findUnique.mockResolvedValue(null);mocks.search.mockResolvedValue([candidate]);
    mocks.findMany.mockResolvedValue([{data:JSON.stringify({recordingId:candidate.id,censored:false})}]);
    const res=response(),next=vi.fn();
    await handler('get')({params:{id:original.id},query:{source:'youtube'}},res,next);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.cache).toHaveBeenCalledWith(candidate);
    expect(mocks.upsert.mock.calls[0][0].where.id).toBe(recordingKey(original.id,'youtube'));
    expect(mocks.findMany.mock.calls[0][0].where.id.in).toEqual(['recording-vote:telegram:7:youtube:1']);
    expect(res.json).toHaveBeenCalledWith({data:[{...candidate,censored:false}]});
  });

  it('reuses a fresh recording list without searching again',async()=>{
    mocks.findUnique.mockResolvedValue({updatedAt:new Date(),data:JSON.stringify([candidate])});
    await handler('get')({params:{id:original.id},query:{source:'youtube'}},response(),vi.fn());
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('rejects a vote for an upload outside this track’s recording list',async()=>{
    mocks.findUnique.mockResolvedValue({data:JSON.stringify([candidate])});
    const res=response();
    await handler('post')({params:{id:original.id},body:{source:'youtube',recordingId:'youtube:other',censored:true}},res,vi.fn());
    expect(res.statusCode).toBe(400);expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('stores one vote per verified listener and upload',async()=>{
    mocks.findUnique.mockResolvedValue({data:JSON.stringify([candidate])});
    const res=response();
    await handler('post')({params:{id:original.id},body:{source:'youtube',recordingId:candidate.id,censored:true}},res,vi.fn());
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({where:{id:'recording-vote:telegram:7:youtube:1'}});
    expect(res.json).toHaveBeenCalledWith({data:{saved:true}});
  });
});
