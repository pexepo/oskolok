import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../src/telegram/runtime.js',()=>({apiBase:'/api',telegramAuthHeaders:()=>({}),useTelegramStore:{setState:vi.fn()}}));
vi.mock('../src/stores/useLanguageStore.js',()=>({tr:(ru:string)=>ru}));
vi.mock('../src/utils/playbackPreferences.js',()=>({getLosslessPreferred:()=>false}));
import {apiClient} from '../src/api/apiClient.js';
import {useTelegramStore} from '../src/telegram/runtime.js';
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks();});

it('ends a stalled profile request with an actionable error and never retries automatically',async()=>{
 const fetcher=vi.fn((_url:any,{signal}:any)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))));
 vi.stubGlobal('fetch',fetcher);
 const result=apiClient.addTrackToTelegramProfile('spotify:one'),rejected=expect(result).rejects.toMatchObject({code:'PROFILE_MUSIC_TIMEOUT'});
 await vi.advanceTimersByTimeAsync(300000);await rejected;expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('clears its deadline after success',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({data:{status:'added'}}))));
 expect(await apiClient.addTrackToTelegramProfile('spotify:one')).toEqual({status:'added'});expect(vi.getTimerCount()).toBe(0);
});
it('keeps the site session when only the Telegram music session needs connecting',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{code:'SESSION_REQUIRED',message:'Подключите сессию Telegram в профиле.'}}),{status:403})));
 await expect(apiClient.addTrackToTelegramProfile('spotify:one')).rejects.toMatchObject({code:'SESSION_REQUIRED'});expect(useTelegramStore.setState).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
