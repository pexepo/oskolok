import {describe,it,expect} from 'vitest';
import {selectRecordingCandidates,recordingMetadata} from '../server/src/services/recordingCandidates.js';
import type {Track} from '../server/src/types/index.js';
const track=(id:string,title:string,artist:string,source:Track['source']='youtube',duration=180):Track=>({id,source,sourceId:id,title,artist:{id:artist,name:artist,source,sourceId:artist},duration,access:'playable'});
describe('alternate audio recording matching',()=>{
 const original=track('spotify:original','Lose Yourself','Eminem','spotify');
 it('accepts a full upload with official-video decoration and canonical artist credit',()=>{
  const upload=track('youtube:one','Eminem — Lose Yourself (Official Video)','Upload account');
  expect(selectRecordingCandidates(original,[upload])).toEqual([upload]);
 });
 it('rejects other artists, remixes, previews and wrong durations',()=>{
  const candidates=[track('1','Lose Yourself','Someone Else'),track('2','Lose Yourself (remix)','Eminem'),track('3','Lose Yourself','Eminem','youtube',130),{...track('4','Lose Yourself','Eminem'),access:'preview' as const}];
  expect(selectRecordingCandidates(original,candidates)).toEqual([]);
 });
 it('can identify a SoundCloud uploader by the full song title while preserving live versions',()=>{
  expect(selectRecordingCandidates(original,[track('1','Lose Yourself','Upload account','soundcloud'),track('2','Lose Yourself (live)','Upload account','soundcloud')]).map(t=>t.id)).toEqual(['1']);
  expect(recordingMetadata(track('sc','Eminem - Lose Yourself','Fan account','soundcloud'))).toEqual({artist:'Eminem',title:'Lose Yourself'});
 });
});
