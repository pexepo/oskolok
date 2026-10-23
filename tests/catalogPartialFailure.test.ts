import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('../server/src/repositories/trackCacheRepository.js',()=>({trackCacheRepository:{setCachedTrack:vi.fn(async()=>{})}}));
import {officialCatalogService} from '../server/src/services/OfficialCatalogService.js';
afterEach(()=>vi.unstubAllGlobals());
describe('catalog search under partial upstream failures',()=>{
 it('keeps the artist match needed by fallback discographies when track search times out',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(input:any)=>{
   if(String(input).includes('/search/artist?'))return new Response(JSON.stringify({data:[{id:27,name:'Daft Punk',nb_fan:1000}]}));
   throw new DOMException('timeout','TimeoutError');
  }));
  const found=await officialCatalogService.search('Daft Punk',{limit:1});
  expect(found.artists).toMatchObject([{id:'deezer:artist:27',name:'Daft Punk'}]);expect(found.tracks).toEqual([]);
 });
 it('keeps playable track metadata when artist search fails',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(input:any)=>{
   if(String(input).includes('/search/artist?'))throw new TypeError('network');
   return new Response(JSON.stringify({data:[{id:123,title:'Song',duration:180,artist:{id:27,name:'Daft Punk'},album:{id:1,title:'Album'}}]}));
  }));
  const found=await officialCatalogService.search('partial-song-test',{limit:1});
  expect(found.tracks).toMatchObject([{id:'deezer:123',title:'Song'}]);expect(found.artists).toEqual([]);
 });
});
