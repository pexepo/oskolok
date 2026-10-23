import {describe,expect,it,vi} from 'vitest';
vi.mock('../server/src/database/client.js',()=>({prisma:{}}));
vi.mock('../server/src/services/RecommendationService.js',()=>({deezerSimilar:async()=>({tracks:[],related:[]})}));
const {clusterArtists,spreadArtists,tasteProfile}=await import('../server/src/services/dailyMixes.js');
const t=(id:string,artist:string)=>({id,title:id,artist:{id:artist,name:artist},duration:180,source:'deezer',sourceId:id}) as any;

describe('daily mixes',()=>{
  it('weights liked artists above played ones and keeps the primary artist of a feature',()=>{
    const p=tasteProfile([t('a','Kai Angel, 9mice')],[t('b','pyrokinesis'),t('c','pyrokinesis')]);
    expect(p.map(a=>a.name)).toEqual(['Kai Angel','pyrokinesis']);
  });
  it('groups neighbouring artists and starts a new mix for an unrelated one',()=>{
    const w=(name:string)=>({name,weight:5,tracks:[]});
    const related=new Map([['kaiangel',new Set(['9mice','heronwater'])],['9mice',new Set(['kaiangel'])],['ludovicoeinaudi',new Set(['maxrichter'])]]);
    const groups=clusterArtists([w('Kai Angel'),w('Ludovico Einaudi'),w('9mice')],related);
    expect(groups.map(g=>g.map(a=>a.name))).toEqual([['Kai Angel','9mice'],['Ludovico Einaudi']]);
  });
  it('avoids the same artist twice in a row',()=>{
    const out=spreadArtists([t('1','A'),t('2','A'),t('3','B'),t('4','A'),t('5','C')]);
    for(let i=1;i<out.length-1;i++)expect(out[i].artist.name===out[i-1].artist.name).toBe(false);
  });
});
