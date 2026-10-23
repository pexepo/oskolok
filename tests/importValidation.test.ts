import {describe,it,expect,vi} from 'vitest';
vi.mock('../server/src/services/SpicyLyricsService.js',()=>({spicyLyricsService:{}}));
vi.mock('../server/src/services/SpotifyService.js',()=>({spotifyService:{}}));
vi.mock('../server/src/services/SoundCloudService.js',()=>({soundCloudService:{}}));
vi.mock('../server/src/repositories/trackCacheRepository.js',()=>({trackCacheRepository:{}}));
import {parseImportUrl,previewImport,ImportValidationError} from '../server/src/services/LibraryTransferService.js';
describe('import link validation',()=>{
  it.each(['nonsense','http://open.spotify.com/track/abc','https://attacker.example/playlist/abc','https://open.spotify.com@attacker.example/track/abc','https://user:pass@open.spotify.com/track/abc','https://open.spotify.com:8443/track/abc'])('rejects invalid or unsupported input: %s',url=>{
    expect(()=>parseImportUrl(url)).toThrow(ImportValidationError);
  });
  it('keeps supported Spotify links valid',()=>{
    expect(parseImportUrl('https://open.spotify.com/track/abc?si=xyz').host).toBe('open.spotify.com');
  });
  it('reports unsupported resource types as user errors',async()=>{
    await expect(previewImport('https://open.spotify.com/artist/abc')).rejects.toBeInstanceOf(ImportValidationError);
    await expect(previewImport('https://music.yandex.ru/album/123')).rejects.toBeInstanceOf(ImportValidationError);
  });
});
