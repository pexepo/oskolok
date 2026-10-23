import {describe,it,expect} from 'vitest';
import {blendOwnership,blendTastes,interleaveByOwner} from '../server/src/services/wave/blendWave.js';
import {seedWeights} from '../server/src/services/wave/personalWave.js';
import {artistKey,type Taste} from '../server/src/services/wave/profile.js';
import type {Track} from '../server/src/types/index.js';

const track=(id:string,artist:string)=>({id,title:id,artist:{id:artist,name:artist},duration:200,access:'playable'} as unknown as Track);
const taste=(likes:Track[],extra:Partial<Taste>={}):Taste&{version:string}=>({artists:new Map(),tracks:new Map(),likes,library:[],history:[],recent:[],version:'v1',...extra});
const noSession={liked:[],finished:[],skips:new Map<string,number>()};

describe('«Волна на двоих»: смешивание сидов',()=>{
  it('берёт сиды обоих слушателей и чередует их лайки',()=>{
    const anna=taste([track('a1','Земфира'),track('a2','Мумий Тролль'),track('a3','Сплин')]);
    const boris=taste([track('b1','Radiohead'),track('b2','Muse')]);
    const blend=blendTastes(anna,boris);
    expect(blend.likes.map(t=>t.id)).toEqual(['a1','b1','a2','b2','a3']);
    const seeds=[...seedWeights(blend,noSession).keys()];
    expect(seeds).toEqual(expect.arrayContaining(['Земфира','Radiohead','Muse','Сплин'].map(artistKey)));
  });

  it('не даёт большой библиотеке заглушить маленькую',()=>{
    const heavy=taste(Array.from({length:3000},(_,i)=>track(`h${i}`,`Артист ${i%40}`)));
    const light=taste([track('l1','Molchat Doma'),track('l2','Molchat Doma'),track('l3','Буерак')]);
    const blend=blendTastes(heavy,light);
    expect(blend.likes.length).toBeLessThanOrEqual(123);
    const ranked=[...seedWeights(blend,noSession).entries()].sort((a,b)=>b[1].w-a[1].w).map(([k])=>k);
    // The light listener's favourite sits among the strongest seeds, not at the bottom of three thousand likes.
    expect(ranked.slice(0,4)).toContain(artistKey('Molchat Doma'));
  });

  it('нормирует вес каждой стороны и поднимает общих артистов',()=>{
    const a=taste([],{artists:new Map([['кино',10],['сплин',90]])}),b=taste([],{artists:new Map([['кино',500],['muse',500]])});
    const w=blendTastes(a,b).artists;
    expect(w.get('сплин')).toBeCloseTo(90);
    expect(w.get('muse')).toBeCloseTo(50);
    expect(w.get('кино')!).toBeCloseTo((10+50)*1.5);
  });

  it('объединяет недавно слушанное, чтобы не повторять ни одному из двоих',()=>{
    expect(blendTastes(taste([],{recent:['x','y']}),taste([],{recent:['y','z']})).recent.sort()).toEqual(['x','y','z']);
  });

  it('знает, чей вкус у трека: свой, друга или общий',()=>{
    const a=taste([track('a1','Земфира'),track('s1','Кино')]),b=taste([track('b1','Muse'),track('s2','Кино')]);
    const owner=blendOwnership(a,b);
    expect(owner(track('a1','Земфира'))).toBe('a');
    expect(owner(track('new','Muse'))).toBe('b');
    expect(owner(track('new2','Кино'))).toBe('both');
    expect(owner(track('new3','Незнакомец'),'Земфира')).toBe('a');
    expect(owner(track('new4','Незнакомец'))).toBeUndefined();
  });

  it('чередует «ваше» и «друга», общее — в начале и через раз',()=>{
    const out=interleaveByOwner(['a1','a2','a3','b1','b2','s1','s2'],i=>i[0]==='a'?'a':i[0]==='b'?'b':'both');
    expect(out).toEqual(['s1','a1','b1','s2','a2','b2','a3']);
    expect(interleaveByOwner(['a1','a2','b1'],i=>i[0] as 'a'|'b')).toEqual(['a1','b1','a2']);
    expect(interleaveByOwner([],()=>'a')).toEqual([]);
  });
});
