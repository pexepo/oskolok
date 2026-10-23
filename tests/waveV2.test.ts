import {describe,expect,it,vi} from 'vitest';
vi.mock('../server/src/database/client.js',()=>({prisma:{}}));
const {languageOf,matchesLanguage}=await import('../server/src/services/wave/language.js');
const {collectionBatch,spread}=await import('../server/src/services/wave/waveV2.js');
const {normalizeWaveRequest,waveOptionsCatalog}=await import('../server/src/services/wave/taxonomy.js');
const {scoreTaste,DEFAULT_PARAMS}=await import('../server/src/services/wave/profile.js');
const t=(id:string,artist:string,title=id,extra:Record<string,unknown>={})=>({id,title,artist:{id:artist,name:artist,source:'deezer',sourceId:artist},duration:200,source:'deezer',sourceId:id,access:'playable',...extra}) as any;

describe('track language',()=>{
  it('reads script and anchored artists, not a Latin title alone',()=>{
    expect(languageOf(t('1','ヨルシカ','ただ君に晴れ'))).toBe('ja');
    expect(languageOf(t('2','Кино','Группа крови'))).toBe('ru');
    expect(languageOf(t('3','Kai Angel','NAKED'))).toBe('ru');
    expect(languageOf(t('4','Mitski','Nobody'))).toBe('en');
    expect(languageOf(t('5','Unknown Band','Hello'))).toBe('latin');
    expect(languageOf(t('6','Гурт','Пісня про їжака'))).toBe('unknown');
  });
  it('counts Latin tracks as English only with context, and never as Japanese from the collection',()=>{
    const latin=t('5','Unknown Band','Hello');
    expect(matchesLanguage(latin,'en')).toBe(false);
    expect(matchesLanguage(latin,'en','collection')).toBe(true);
    expect(matchesLanguage(latin,'ja','collection')).toBe(false);
    expect(matchesLanguage(latin,'ja','source')).toBe(true);
  });
});

describe('settings',()=>{
  it('drops a subgenre or mood that belongs to another language',()=>{
    expect(normalizeWaveRequest({language:'ja',subgenre:'anime-op',mood:'energetic',mode:'niche'})).toEqual({language:'ja',subgenre:'anime-op',mood:'energetic',mode:'niche',activity:null});
    expect(normalizeWaveRequest({language:'ru',subgenre:'anime-op',mood:'inspiring',mode:'favorite'})).toEqual({language:'ru',subgenre:null,mood:null,mode:null,activity:null});
  });
  it('offers separate RU / EN / JA sets',()=>{
    const c=waveOptionsCatalog() as any;
    expect(c.ru.subgenres.map((s:any)=>s.id)).toContain('rock');
    expect(c.ja.subgenres.map((s:any)=>s.id)).toEqual(expect.arrayContaining(['anime-op','anime-ed','jrock','jpop','citypop','jelectronic']));
    expect(c.en.subgenres.map((s:any)=>s.id)).toContain('souljazz');
    expect(c.ja.moods.map((m:any)=>m.id)).toContain('inspiring');
  });
});

describe('collection mode',()=>{
  const taste={tracks:new Map(),artists:new Map(),version:'test'};
  it('serves unplayed tracks first, then rotates the oldest instead of alternating one pair',()=>{
    const pool=['a','b','c','d','e'].map((id,i)=>t(id,`Artist ${i}`));
    const first=collectionBatch(pool,{excludeTrackIds:[],skipped:[],recentArtists:[]},taste,5,false);
    expect(first.tracks).toHaveLength(5);expect(first.repeating).toBe(false);
    const played=['a','b','c','d','e'];
    const again=collectionBatch(pool,{excludeTrackIds:played,skipped:[],recentArtists:[]},taste,5,false);
    expect(again.repeating).toBe(true);
    // Only the 60 % played most recently stays out: c, d, e.
    expect(again.tracks.map((x:any)=>x.id).sort()).toEqual(['a','b']);
  });
  it('caps an artist per batch',()=>{
    const out=spread([t('1','A'),t('2','A'),t('3','A'),t('4','B')],2);
    expect(out.filter((x:any)=>x.artist.name==='A')).toHaveLength(2);
    expect(out[0].artist.name).not.toBe(out[1].artist.name);
  });
});

describe('taste from events',()=>{
  const now=Date.parse('2026-10-17T00:00:00Z'),at=new Date(now-3600_000);
  const listen=(id:string,data:Record<string,unknown>)=>({type:'listen',trackId:id,artist:'Artist',at,data});
  it('treats errors and never-started plays as neutral',()=>{
    const r=scoreTaste({likes:[],library:[],history:[],now,events:[listen('x',{started:false,endReason:'manual-skip',uniqueRatio:0}),listen('x',{started:true,endReason:'error',uniqueRatio:.1})]});
    expect(r.artists.get('artist')||0).toBe(0);
  });
  it('rewards a natural full listen and lowers, but never bans, after many early skips',()=>{
    const done=scoreTaste({likes:[],library:[],history:[],now,events:[listen('x',{started:true,endReason:'natural',uniqueRatio:.95})]});
    expect(done.artists.get('artist')).toBeGreaterThan(0);
    const seekedToEnd=scoreTaste({likes:[],library:[],history:[],now,events:[listen('x',{started:true,endReason:'natural',uniqueRatio:.2})]});
    expect(seekedToEnd.artists.get('artist')||0).toBe(0);
    const skips=scoreTaste({likes:[],library:[],history:[],now,events:Array.from({length:30},(_,i)=>listen(`s${i}`,{started:true,endReason:'manual-skip',uniqueRatio:.05}))});
    expect(skips.artists.get('artist')).toBe(DEFAULT_PARAMS.skipFloor);
  });
});
