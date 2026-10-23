import {describe,it,expect,vi} from 'vitest';
import type {Track} from '../server/src/types/index.js';

vi.mock('../server/src/database/client.js',()=>({prisma:{artistEnrichment:{findUnique:vi.fn(async()=>null),upsert:vi.fn(async()=>null)}}}));
import {isOwnUpload,isDerivativeTitle} from '../server/src/services/canonicalRelease.js';
import {latinFold} from '../server/src/services/trackRanking.js';

const sc=(title:string,artist:string,uploader?:Track['uploader']):Track=>({id:`soundcloud:${title}`,source:'soundcloud',sourceId:'1',title,artist:{id:'soundcloud:u',source:'soundcloud',sourceId:'u',name:artist},duration:150,access:'playable',uploader});

describe('canonical release: whose upload is it',()=>{
 it('treats the artist’s own, verified or label accounts as the source',()=>{
  expect(isOwnUpload(sc('ИКАР','Слава КПСС',{name:'Слава КПСС',followers:900}))).toBe(true);
  expect(isOwnUpload(sc('Мемы 4','Слава КПСС + CMH',{name:'JET Records',followers:59646}))).toBe(true);
  expect(isOwnUpload(sc('sick','glaive',{name:'glaive',verified:true}))).toBe(true);
 });
 it('treats a small account posting someone else’s song as a copy',()=>{
  // «cupsize — 1 мая» posted by an unrelated 77-follower account
  expect(isOwnUpload(sc('1 мая','cupsize',{name:'user-61497136',followers:77}))).toBe(false);
  // the real artist hidden in brackets: «Легенда о Богине Мечей (pyrokinesis)» by RusGameChanel
  expect(isOwnUpload(sc('Легенда о Богине Мечей (pyrokinesis)','RusGameChanel',{name:'RusGameChanel',followers:0}))).toBe(false);
 });
 it('gives cached tracks without uploader data the benefit of the doubt',()=>{
  expect(isOwnUpload(sc('Песня','Кто-то'))).toBe(true);
 });
 it('keeps remixes, covers and edits as their own works',()=>{
  expect(isDerivativeTitle('1 мая (slowed)')).toBe(true);
  expect(isDerivativeTitle('легенда о богине гроз speed up')).toBe(true);
  expect(isDerivativeTitle('Кайфоград (кавер)')).toBe(true);
  expect(isDerivativeTitle('1 мая')).toBe(false);
 });
 it('compares artist names across scripts',()=>{
  expect(latinFold('Слава КПСС')).toBe(latinFold('Slava KPSS'));
  expect(latinFold('pyrokinesis')).toBe(latinFold('Pyrokinesis'));
  expect(latinFold('Слава КПСС')).not.toBe(latinFold('Слава Марлоу'));
 });
});
