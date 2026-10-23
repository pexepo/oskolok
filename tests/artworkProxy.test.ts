import {describe,it,expect,vi} from 'vitest';
import {validateArtworkUrl,fetchArtwork,ArtworkError,ARTWORK_HOSTS} from '../server/src/services/ArtworkService.js';
import {ARTWORK_HOSTS as clientHosts,artworkSource} from '../src/utils/artworkSource.js';
describe('artwork delivery',()=>{
 it('keeps the client and proxy allowlists aligned',()=>expect([...ARTWORK_HOSTS]).toEqual(clientHosts));
 it.each(['http://i.scdn.co/image/abc','https://127.0.0.1/image','https://i.scdn.co.attacker.example/image','https://user:pass@i.scdn.co/image','https://i.scdn.co:8443/image'])('blocks unsafe target %s',url=>expect(()=>validateArtworkUrl(url)).toThrow(ArtworkError));
 it('proxies catalog covers while preserving local assets',()=>{
   expect(artworkSource('https://i.scdn.co/image/abc')).toBe('/api/artwork?url=https%3A%2F%2Fi.scdn.co%2Fimage%2Fabc');
   expect(artworkSource('/logo.png')).toBe('/logo.png');
   expect(artworkSource('data:image/png;base64,ABC')).toBe('data:image/png;base64,ABC');
 });
 it('does not follow redirects into private or unknown hosts',async()=>{
   const request=vi.fn(async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}}));
   await expect(fetchArtwork('https://i.scdn.co/image/abc',request as any)).rejects.toBeInstanceOf(ArtworkError);
   expect(request).toHaveBeenCalledOnce();
 });
 it('accepts a bounded image response',async()=>{
   const request=vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}}));
   expect(await fetchArtwork('https://i.scdn.co/image/abc',request as any)).toEqual({data:Buffer.from([1,2,3]),type:'image/jpeg'});
 });
 it('rejects HTML and oversized upstream bodies',async()=>{
   await expect(fetchArtwork('https://i.scdn.co/image/abc',async()=>new Response('html',{headers:{'content-type':'text/html'}}))).rejects.toBeInstanceOf(ArtworkError);
   await expect(fetchArtwork('https://i.scdn.co/image/abc',async()=>new Response(new Uint8Array(4*1024*1024+1),{headers:{'content-type':'image/png'}}))).rejects.toBeInstanceOf(ArtworkError);
 });
});
