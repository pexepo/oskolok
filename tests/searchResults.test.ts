import { describe, expect, it } from 'vitest';
import { bestSearchArtist, selectBestSearchResult } from '../src/utils/searchRanking.js';
import { deduplicateSearchAlbums, mergeSearchArtists, rankAlbum, rankArtist } from '../server/src/services/trackRanking.js';
import type { Artist, Release, Track } from '../src/types/index.js';

const artist = (name: string, followersCount = 0, source: 'spotify' | 'deezer' | 'soundcloud' = 'deezer', id = `${source}:${followersCount}`): Artist => ({ id, name, source, sourceId: id, followersCount });
const track = (title: string, name: string, popularity = 0): Track => ({ id: `${title}:${name}`, source: 'deezer', sourceId: title, title, artist: artist(name), duration: 180, access: 'playable', popularity });
const album = (title: string, name: string, source = 'deezer'): Release => ({ id: `${source}:album:${title}`, title, type: 'album', artist: artist(name) });

describe('best search result', () => {
  it('chooses the popular homonym regardless of provider order', () => {
    const obscure = artist('Rizza', 12, 'spotify'), popular = artist('rizza', 120_000, 'deezer');
    expect(bestSearchArtist([obscure, popular], 'rizza')).toBe(popular);
    expect(bestSearchArtist([popular, obscure], 'rizza')).toBe(popular);
    expect(rankArtist(popular, 'rizza')).toBeGreaterThan(rankArtist(obscure, 'rizza', 30));
    expect(mergeSearchArtists([obscure, popular], 'rizza')[0].id).toBe(popular.id);
    expect(mergeSearchArtists([obscure, popular], 'rizza')).toHaveLength(1);
  });
  it('retains a popular profile after merging less popular Spotify metadata', () => {
    const popular = artist('Artist', 2_000_000, 'soundcloud');
    const other = artist('Artist', 100, 'spotify');
    const [merged] = mergeSearchArtists([other, popular], 'artist');
    expect(merged.id).toBe(popular.id);
    expect(merged.followersCount).toBe(2_000_000);
    expect(merged.alsoOn).toMatchObject([{ source: 'spotify', id: other.id }]);
    expect(popular).not.toHaveProperty('alsoOn');
  });
  it('keeps an exact small artist ahead of a famous partial name', () => {
    const exact = artist('Rizza', 10), partial = artist('Rizzardo', 100_000_000);
    expect(bestSearchArtist([partial, exact], 'rizza')).toBe(exact);
    expect(rankArtist(exact, 'rizza')).toBeGreaterThan(rankArtist(partial, 'rizza'));
  });
  it('uses provider popularity if follower metrics are unavailable', () => {
    const popular = { ...artist('Artist'), popularity: 90 }, other = { ...artist('Artist'), popularity: 5 };
    expect(bestSearchArtist([other, popular], 'artist')).toBe(popular);
  });
  it('does not replace an exact track with a popular partial artist match', () => {
    const recording = track('Crystal', 'Unknown', 5);
    expect(selectBestSearchResult({ tracks: [recording], artists: [artist('Crystals', 10_000_000)] }, 'crystal')).toEqual({ type: 'track', track: recording });
  });
  it('selects the popular recording among exact titles', () => {
    const obscure = track('Lose Yourself', 'Unknown', 3), popular = track('Lose Yourself', 'Eminem', 95);
    expect(selectBestSearchResult({ tracks: [obscure, popular], artists: [] }, 'lose yourself')).toEqual({ type: 'track', track: popular });
  });
  it('shows an exact album when there are no tracks or artists', () => {
    const release = album('Random Access Memories', 'Daft Punk');
    expect(selectBestSearchResult({ tracks: [], artists: [], albums: [release] }, 'Daft Punk Random Access Memories')).toEqual({ type: 'album', album: release });
  });
  it('never selects unavailable tracks ahead of a release', () => {
    const release = album('Crystal', 'Artist');
    expect(selectBestSearchResult({ tracks: [{ ...track('Crystal', 'Artist', 90), access: 'blocked' }], artists: [], albums: [release] }, 'crystal')?.type).toBe('album');
  });
  it('normalizes punctuation, case, Cyrillic and spaces consistently', () => {
    const match = artist('17 SEVENTEEN', 1000);
    expect(bestSearchArtist([match], '17seventeen')).toBe(match);
    expect(bestSearchArtist([artist('Ёлка', 1000)], 'елка')?.name).toBe('Ёлка');
  });
});

describe('album ranking', () => {
  it('finds releases by title and artist while dropping unrelated popular albums', () => {
    const release = album('Random Access Memories', 'Daft Punk');
    expect(rankAlbum(release, 'random access memories')).toBeGreaterThan(500);
    expect(rankAlbum(release, 'daft punk')).toBeGreaterThan(400);
    expect(rankAlbum(release, 'daft punk random access memories')).toBeGreaterThan(500);
    expect(rankAlbum({ ...album('Unknown', 'Different'), popularity: 100 }, 'random access memories')).toBe(0);
  });
  it('merges duplicate albums across catalogs while retaining editions and artists', () => {
    const spotify = album('Album', 'Artist', 'spotify');
    const releases = deduplicateSearchAlbums([album('Album', 'Artist'), spotify, album('Album Deluxe', 'Artist'), album('Album', 'Other')]);
    expect(releases).toHaveLength(3);
    expect(releases[0].id).toBe(spotify.id);
  });
});
it('prefers a popular exact song over an unknown namesake profile, and a real artist over a fan page',async()=>{
  const {selectBestSearchResult}=await import('../src/utils/searchRanking.js');
  const song={id:'s',title:'Gurenge',artist:{id:'l',name:'LiSA'},popularity:69,access:'playable'} as any;
  expect(selectBestSearchResult({artists:[{id:'a',name:'Gurenge',followersCount:40} as any],tracks:[song],albums:[]},'gurenge')).toMatchObject({type:'track'});
  const fan={id:'f',name:'boulevard dep',source:'soundcloud',followersCount:12} as any,real={id:'r',name:'BOULEVARD DEPO',followersCount:900000} as any;
  expect(selectBestSearchResult({artists:[fan,real],tracks:[],albums:[]},'boulevard dep')).toMatchObject({type:'artist',artist:{id:'r'}});
});
