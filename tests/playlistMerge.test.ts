import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Track} from '../server/src/types/index.js';

const db=vi.hoisted(()=>({findMany:vi.fn(),create:vi.fn(),update:vi.fn(),transaction:vi.fn(),userUpsert:vi.fn(),playlistCreate:vi.fn(),playlistFindMany:vi.fn(),playlistUpdate:vi.fn(),profileDelete:vi.fn(),profileUpdate:vi.fn(),showcaseDelete:vi.fn()}));
vi.mock('../server/src/database/client.js',()=>({prisma:{
  user:{upsert:db.userUpsert},
  playlistTrack:{findMany:db.findMany,create:db.create,update:db.update},
  playlist:{create:db.playlistCreate,findMany:db.playlistFindMany,update:db.playlistUpdate},
  profilePlaylist:{deleteMany:db.profileDelete,updateMany:db.profileUpdate},
  profileShowcaseItem:{deleteMany:db.showcaseDelete},
  $transaction:db.transaction,
}}));
import {playlistRepository} from '../server/src/repositories/playlistRepository.js';

const song=(id:string,source='spotify',title='Что тебя гложет',artist='Артист'):Track=>({
  id,source:source as Track['source'],sourceId:id.split(':')[1],title,duration:180,
  artist:{id:`${source}:a`,name:artist,source:source as Track['source'],sourceId:'a'},access:'playable',
});
const row=(track:Track,position:number)=>({trackId:track.id,trackData:JSON.stringify(track),position});
const playlist=(tracks:any[]=[])=>({id:'p',userId:'telegram:1',title:'Плейлист',isPublic:false,tracks,createdAt:new Date(),updatedAt:new Date()});

beforeEach(()=>vi.resetAllMocks());
describe('playlist catalogue merge',()=>{
  it('replaces an uploader copy with canonical metadata without moving it or duplicating it',async()=>{
    db.findMany.mockResolvedValue([row(song('soundcloud:1','soundcloud','Что тебя гложет','uploader'),7)]);
    const canonical=song('spotify:1');
    expect(await playlistRepository.addTracksToPlaylist('p',[canonical,canonical])).toEqual({added:0,total:1});
    expect(db.create).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledWith({where:{playlistId_trackId:{playlistId:'p',trackId:'soundcloud:1'}},data:{trackId:'spotify:1',trackData:JSON.stringify(canonical)}});
  });

  it('keeps canonical metadata when an upload is added later and preserves remixes',async()=>{
    db.findMany.mockResolvedValue([row(song('spotify:1'),4)]);
    const remix=song('soundcloud:2','soundcloud','Что тебя гложет (Remix)');
    expect(await playlistRepository.addTracksToPlaylist('p',[song('soundcloud:1','soundcloud'),remix])).toEqual({added:1,total:2});
    expect(db.update).not.toHaveBeenCalled();
    expect(db.create).toHaveBeenCalledTimes(1);
    expect(db.create).toHaveBeenCalledWith({data:{playlistId:'p',trackId:remix.id,trackData:JSON.stringify(remix),position:5}});
  });

  it('deduplicates copies on creation and keeps the catalogue ID for lyrics',async()=>{
    db.playlistCreate.mockResolvedValue(playlist());
    await playlistRepository.createPlaylist('telegram:1','Плейлист',undefined,undefined,[song('soundcloud:1','soundcloud'),song('spotify:1')]);
    expect(db.playlistCreate.mock.calls[0][0].data.tracks.create).toEqual([{trackId:'spotify:1',trackData:JSON.stringify(song('spotify:1')),position:0}]);
  });

  it('loads one cover track per playlist while returning the full count',async()=>{
    db.playlistFindMany.mockResolvedValue([{...playlist(),_count:{tracks:500}}]);
    const result=await playlistRepository.getPlaylistsByUser('telegram:1');
    expect(result[0].trackCount).toBe(500);
    expect(db.playlistFindMany.mock.calls[0][0].include.tracks.take).toBe(1);
  });

  it('removes published profile entries when a playlist becomes private',async()=>{
    db.playlistUpdate.mockResolvedValue(playlist());
    await playlistRepository.updatePlaylist('p',{isPublic:false});
    expect(db.profileDelete).toHaveBeenCalledWith({where:{playlistId:'p'}});
    expect(db.showcaseDelete).toHaveBeenCalledWith({where:{kind:'playlist',refId:'p'}});
    expect(db.profileUpdate).not.toHaveBeenCalled();
  });
});
