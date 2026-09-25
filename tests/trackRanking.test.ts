import { describe,it,expect } from 'vitest';
import { rankSoundCloud, rankTrack, diversifyTracks, balanceRecommendationSeeds, matchesMetadataLanguage, matchesArtistSeed, deduplicateSearchTracks } from '../server/src/services/trackRanking.js';
import type { Track,SoundCloudTrackDTO } from '../server/src/types/index.js';
const track=(title:string,artist='Artist',source='soundcloud'):Track=>({id:`${source}:${title}`,source:source as any,sourceId:title,title,artist:{id:artist,name:artist,source:'soundcloud',sourceId:artist},duration:180,access:'playable'});
describe('music ranking',()=>{
 it('does not treat an unrelated song title as an artist match',()=>{
  expect(matchesArtistSeed(track('Черная речка','Lissa','deezer'),'Черная Речка')).toBe(false);
  expect(matchesArtistSeed(track('Песня','Черная Речка','deezer'),'Черная Речка')).toBe(true);
  expect(matchesArtistSeed(track('Черная Речка - Песня','Uploader'),'Черная Речка')).toBe(true);
 });
 it('keeps an English favorite out of the Russian metadata filter',()=>{
  expect(matchesMetadataLanguage(track('Believer','Imagine Dragons'),'ru')).toBe(false);
  expect(matchesMetadataLanguage(track('Можно я с тобой','AP$ENT'),'ru')).toBe(true);
  expect(matchesMetadataLanguage(track('Можно я с тобой','AP$ENT'),'foreign')).toBe(false);
 });
 it('mixes recommendation seeds even when related tracks score highest',()=>{
  const related=Array.from({length:6},(_,i)=>({...track(`Related ${i}`,`Artist ${i}`),recommendationReason:'Related seed'}));
  const other=Array.from({length:4},(_,i)=>({...track(`Discovery ${i}`,`New ${i}`),recommendationReason:`Seed ${i}`}));
  const result=balanceRecommendationSeeds([...related,...other],6);
  expect(result.filter(t=>t.recommendationReason==='Related seed')).toHaveLength(2);
  expect(result).toHaveLength(6);
 });
 it('uses available candidates when only one seed responds',()=>{
  const candidates=Array.from({length:6},(_,i)=>({...track(`Track ${i}`,`Artist ${i}`),recommendationReason:'Only seed'}));
  expect(balanceRecommendationSeeds(candidates,6)).toHaveLength(6);
 });
 it('prefers an exact small artist over an unrelated viral upload',()=>{
  const exact={id:1,title:'Crystal',duration:180000,user:{id:1,username:'Artist'},playback_count:12} as SoundCloudTrackDTO;
  const viral={...exact,id:2,title:'Something Else',user:{id:2,username:'Famous',verified:true},playback_count:10000000};
  expect(rankSoundCloud(exact,'Artist Crystal')).toBeGreaterThan(rankSoundCloud(viral,'Artist Crystal'));
 });
 it('preserves explicit remix intent',()=>{
  expect(rankTrack(track('Crystal remix'),'Crystal remix')).toBeGreaterThan(rankTrack(track('Crystal'),'Crystal remix'));
  expect(rankTrack(track('Crystal'),'Crystal')).toBeGreaterThan(rankTrack(track('Crystal remix'),'Crystal'));
 });
 it('deduplicates across catalogues and limits artist repetition',()=>{
  const result=diversifyTracks([track('A'),track('A','Artist','deezer'),track('B'),track('C'),track('D','Other')],10,2);
  expect(result.map(t=>t.title)).toEqual(['A','B','D']);
 });
 it('keeps the Spotify catalog ID when the same release appears on Deezer',()=>{
  const result=deduplicateSearchTracks([track('Crystal','Artist','deezer'),track('Crystal','Artist','spotify')]);
  expect(result).toHaveLength(1);
  expect(result[0].source).toBe('spotify');
 });
 it('demotes snippets and blocked releases',()=>{
  const full={id:1,title:'Crystal',duration:180000,user:{id:1,username:'Artist'}} as SoundCloudTrackDTO;
  expect(rankSoundCloud(full,'Crystal')).toBeGreaterThan(rankSoundCloud({...full,policy:'BLOCK'},'Crystal'));
 });
 it('groups SoundCloud reuploads by title and duration without folding remixes',()=>{
  const uploads=[track('Malo 2.0','Uploader A'),track('Malo 2.0','Uploader B'),track('Malo 2.0 remix','Uploader C')];
  uploads[1].duration=181;
  expect(deduplicateSearchTracks(uploads).map(item=>item.title)).toEqual(['Malo 2.0','Malo 2.0 remix']);
 });
 it('keeps different short titles and versions separate',()=>{
  expect(deduplicateSearchTracks([track('Home','Artist A'),track('Home','Artist B'),track('Home live','Artist A')])).toHaveLength(3);
 });
});
