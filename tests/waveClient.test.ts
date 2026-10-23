import {describe,expect,it,vi} from 'vitest';
vi.mock('../src/api/apiClient.js',()=>({apiClient:{request:vi.fn()}}));
vi.mock('../src/telegram/runtime.js',()=>({scopedStorageKey:(k:string)=>k}));
const {normalizeWaveSettings,validateAgainst,waveRequest,releaseSeedOf,continuationAllowed,DEFAULT_WAVE_SETTINGS}=await import('../src/stores/waveSettings.js');
const {QueueManager}=await import('../src/audio/QueueManager.js');
const tr=(id:string,release?:string,artist='A')=>({id,title:id,artist:{id:artist,name:artist},duration:200,source:'deezer',sourceId:id,access:'playable',...(release?{release:{id:release,title:release}}:{})}) as any;

describe('wave settings',()=>{
  it('migrates the old characters to the two modes and keeps languages apart',()=>{
    expect(normalizeWaveSettings({character:'favorite'}).mode).toBe('collection');
    expect(normalizeWaveSettings({character:'discovery'}).mode).toBe('niche');
    expect(normalizeWaveSettings({character:'familiar'}).mode).toBe(null);
    const s=normalizeWaveSettings({language:'ja',mode:'niche',perLanguage:{ja:{subgenre:'anime-op',mood:'energetic'},ru:{subgenre:'indie',mood:null}}});
    expect(waveRequest(s)).toEqual({language:'ja',subgenre:'anime-op',mood:'energetic',mode:'niche',engine:'yandex',activity:null});
    // Switching to RU brings RU's own choice back, never the Japanese subgenre.
    expect(waveRequest({...s,language:'ru'})).toEqual({language:'ru',subgenre:'indie',mood:null,mode:'niche',engine:'yandex',activity:null});
  });
  it('turns ids the catalogue no longer has into «без ограничения»',()=>{
    const catalog={ru:{subgenres:[{id:'rock',ru:'',en:''}],moods:[]},en:{subgenres:[],moods:[]},ja:{subgenres:[],moods:[]}} as any;
    const s=validateAgainst(normalizeWaveSettings({language:'ru',perLanguage:{ru:{subgenre:'gone',mood:'calm'}}}),catalog);
    expect(s.perLanguage.ru).toEqual({subgenre:null,mood:null});
    expect(normalizeWaveSettings(null)).toEqual(DEFAULT_WAVE_SETTINGS);
  });
});

describe('release continuation rules',()=>{
  it('recognises a release queue only when every track is from it',()=>{
    expect(releaseSeedOf([tr('1','r'),tr('2','r')])?.trackIds).toEqual(['1','2']);
    expect(releaseSeedOf([tr('1','r'),tr('2','x')])).toBeNull();
    expect(releaseSeedOf([tr('1')])).toBeNull();
  });
  it('starts only after a natural end with repeat off',()=>{
    expect(continuationAllowed('natural','off')).toBe(true);
    expect(continuationAllowed('manual','off')).toBe(false);
    expect(continuationAllowed('natural','all')).toBe(false);
    expect(continuationAllowed('natural','one')).toBe(false);
  });
});

describe('bounded queue',()=>{
  it('keeps a fixed number of played tracks behind the cursor',()=>{
    const q=new QueueManager();
    q.setQueue(Array.from({length:100},(_,i)=>tr(`t${i}`)),90);
    q.trimPlayed(40);
    const s=q.getState();
    expect(s.currentIndex).toBe(40);expect(s.playbackQueue).toHaveLength(50);expect(q.getCurrentTrack()?.id).toBe('t90');
  });
  it('replaces only upcoming tracks, never the current one',()=>{
    const q=new QueueManager();
    q.setQueue([tr('a'),tr('b'),tr('c'),tr('d')],1);
    q.dropUpcoming(()=>true);
    expect(q.getState().playbackQueue.map((t:any)=>t.id)).toEqual(['a','b']);
    expect(q.getCurrentTrack()?.id).toBe('b');
  });
});
