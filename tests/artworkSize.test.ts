import {describe,expect,it} from 'vitest';
import {sizedArtwork} from '../src/utils/artworkSource.js';

describe('sizedArtwork',()=>{
  it('asks Deezer for the smallest size that still covers the box',()=>{
    expect(sizedArtwork('https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg',96)).toBe('https://cdn-images.dzcdn.net/images/cover/abc/120x120-000000-80-0-0.jpg');
    expect(sizedArtwork('https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg',400)).toBe('https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg');
  });
  it('switches Spotify album and artist image variants',()=>{
    expect(sizedArtwork('https://i.scdn.co/image/ab67616d0000b2736e4c425d715e0bbcbd50c22e',96)).toBe('https://i.scdn.co/image/ab67616d00001e026e4c425d715e0bbcbd50c22e');
    expect(sizedArtwork('https://i.scdn.co/image/ab6761610000e5ebaaaa',150)).toBe('https://i.scdn.co/image/ab6761610000f178aaaa');
  });
  it('leaves unknown hosts and SoundCloud sizes it cannot shrink alone',()=>{
    expect(sizedArtwork('https://images.genius.com/x.1000x1000x1.png',96)).toBe('https://images.genius.com/x.1000x1000x1.png');
    expect(sizedArtwork('https://i1.sndcdn.com/artworks-abc-t500x500.jpg',96)).toBe('https://i1.sndcdn.com/artworks-abc-large.jpg');
  });
});
