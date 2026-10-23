import {describe,expect,it} from 'vitest';
import {isReupload,performerNames} from '../src/utils/trackArtists.js';
import type {Track} from '../src/types/index.js';

const sc=(artist:string,uploader:string)=>({id:'soundcloud:1',source:'soundcloud',sourceId:'1',title:'Песня',artist:{id:'soundcloud:777',source:'soundcloud',sourceId:'777',name:artist},duration:100,access:'playable',uploader:{name:uploader}} as Track);

describe('who a track link leads to',()=>{
 it('spots a SoundCloud re-upload by someone else',()=>{
  expect(isReupload(sc('Слава КПСС','random_rip_2007'))).toBe(true);
  expect(isReupload(sc('Слава КПСС','Слава КПСС'))).toBe(false);
 });
 it('splits featured artists',()=>{
  expect(performerNames('Sqwore, Rizza & Lida feat. pyrokinesis')).toEqual(['Sqwore','Rizza','Lida','pyrokinesis']);
  expect(performerNames('Слава КПСС')).toEqual(['Слава КПСС']);
 });
});
