import {describe,expect,it,vi} from 'vitest';
import {backoffDelay,classifyTelegramError,createLatestQueue,floodWaitSeconds,retry,setHealth,getHealth} from '../server/src/services/telegramReliability.js';

const flood=(seconds:number)=>Object.assign(new Error(`A wait of ${seconds} seconds is required (caused by account.SaveMusic)`),{errorMessage:'FLOOD',seconds});
const tick=(ms:number)=>new Promise(r=>setTimeout(r,ms));

describe('Telegram error classification',()=>{
  it('reads FLOOD_WAIT seconds from every shape Telegram uses',()=>{
    expect(floodWaitSeconds(flood(42))).toBe(42);
    expect(floodWaitSeconds(new Error('420: FLOOD_WAIT_17'))).toBe(17);
    expect(floodWaitSeconds({retryAfter:5})).toBe(5);
    expect(floodWaitSeconds(new Error('ECONNRESET'))).toBe(null);
  });
  it('separates revoked sessions, flood, network and file references',()=>{
    expect(classifyTelegramError(Object.assign(new Error('401'),{errorMessage:'AUTH_KEY_UNREGISTERED'}))).toBe('revoked');
    expect(classifyTelegramError(new Error('SESSION_REVOKED'))).toBe('revoked');
    expect(classifyTelegramError(flood(3))).toBe('flood');
    expect(classifyTelegramError(new Error('Connection closed'))).toBe('network');
    expect(classifyTelegramError(new Error('fetch failed'))).toBe('network');
    expect(classifyTelegramError(new Error('FILE_REFERENCE_EXPIRED'))).toBe('file_reference');
    expect(classifyTelegramError(new Error('MUSIC_INVALID'))).toBe('other');
  });
});

describe('backoff with jitter',()=>{
  it('stays within [exp/2, exp] and respects the cap',()=>{
    for(const attempt of [0,1,2,3,8]){
      const exp=Math.min(30000,1000*2**attempt);
      expect(backoffDelay(attempt,{base:1000,max:30000,random:()=>0})).toBe(exp/2);
      expect(backoffDelay(attempt,{base:1000,max:30000,random:()=>1})).toBe(exp);
    }
  });
  it('spreads concurrent retries apart',()=>{
    const delays=new Set(Array.from({length:20},()=>backoffDelay(3,{base:1000})));
    expect(delays.size).toBeGreaterThan(5);
  });
});

describe('retry',()=>{
  it('retries network failures with backoff and then succeeds',async()=>{
    const waits:number[]=[];let calls=0;
    const value=await retry(async()=>{if(++calls<3)throw new Error('ETIMEDOUT');return 'ok';},{attempts:3,base:100,random:()=>0,wait:async ms=>{waits.push(ms);}});
    expect(value).toBe('ok');expect(calls).toBe(3);expect(waits).toEqual([50,100]);
  });
  it('waits exactly the FLOOD_WAIT time when it is short, and gives up immediately when it is long',async()=>{
    const waits:number[]=[];let calls=0;
    await retry(async()=>{if(++calls===1)throw flood(2);return 1;},{maxFloodWait:30,random:()=>0,wait:async ms=>{waits.push(ms);}});
    expect(waits).toEqual([2000]);
    await expect(retry(async()=>{throw flood(600);},{maxFloodWait:30,wait:async()=>{}})).rejects.toThrow(/600 seconds/);
  });
  it('never retries non-transient errors',async()=>{
    const fn=vi.fn(async()=>{throw new Error('AUTH_KEY_UNREGISTERED');});
    await expect(retry(fn,{wait:async()=>{}})).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('per-user latest queue',()=>{
  it('debounces a burst of track changes into one run that sees the last state',async()=>{
    let state='',seen:string[]=[];
    const q=createLatestQueue(async()=>{seen.push(state);},{debounceMs:20});
    for(const id of ['a','b','c','d']){state=id;void q.schedule('u1');await tick(3);}
    await tick(60);
    expect(seen).toEqual(['d']);
  });
  it('never runs two tasks of one user at once and coalesces calls made during a run into one rerun',async()=>{
    let active=0,maxActive=0,runs=0,release!:()=>void;
    const q=createLatestQueue(async()=>{active++;maxActive=Math.max(maxActive,active);runs++;if(runs===1)await new Promise<void>(r=>{release=r;});active--;},{debounceMs:0});
    void q.now('u1');await tick(5);
    void q.now('u1');void q.now('u1');void q.now('u1');await tick(5);
    expect(runs).toBe(1);
    release();await tick(10);
    expect(runs).toBe(2);expect(maxActive).toBe(1);
  });
  it('keeps users independent',async()=>{
    const order:string[]=[];let release!:()=>void;
    const q=createLatestQueue(async key=>{if(key==='slow')await new Promise<void>(r=>{release=r;});order.push(key);},{debounceMs:0});
    void q.now('slow');void q.now('fast');await tick(10);
    expect(order).toEqual(['fast']);
    release();await tick(5);
    expect(order).toEqual(['fast','slow']);
  });
  it('resolves the caller promise after the run and reports errors without breaking the queue',async()=>{
    const errors:unknown[]=[];let calls=0;
    const q=createLatestQueue(async()=>{if(++calls===1)throw new Error('boom');},{debounceMs:0,onError:(_k,e)=>errors.push(e)});
    await q.now('u1');await q.now('u1');
    expect(calls).toBe(2);expect(errors).toHaveLength(1);expect(q.pending('u1')).toBe(false);
  });
  it('does not pull a long FLOOD_WAIT retry earlier with retryLater',async()=>{
    let runs=0;
    const q=createLatestQueue(async()=>{runs++;},{debounceMs:0});
    void q.schedule('u1',200);q.retryLater('u1',10);await tick(40);
    expect(runs).toBe(0);
    q.cancel('u1');
  });
});

describe('session health',()=>{
  it('reports state changes once',()=>{
    expect(setHealth('telegram:1','reconnecting','NETWORK')).toBe(true);
    expect(setHealth('telegram:1','reconnecting','NETWORK')).toBe(false);
    expect(setHealth('telegram:1','connected')).toBe(true);
    expect(getHealth('telegram:1')?.state).toBe('connected');
  });
});
