/** Надёжность Telegram-интеграции: разбор ошибок MTProto/Bot API, бэкофф с джиттером, последовательные очереди с дебаунсом и здоровье сессий. Без зависимостей — удобно тестировать. */
export type ErrorKind='revoked'|'flood'|'network'|'file_reference'|'other';
export type HealthState='connected'|'reconnecting'|'needs_relogin'|'rate_limited'|'disconnected';
export type SessionHealth={state:HealthState;reason?:string;retryAt?:number;updatedAt:number};

const text=(e:unknown)=>`${(e as {errorMessage?:string})?.errorMessage||''} ${e instanceof Error?e.message:String(e)}`;
/** Секунды ожидания из FloodWaitError (teleproto: .seconds / «A wait of N seconds»), FLOOD_WAIT_N или Bot API retry_after. */
export function floodWaitSeconds(e:unknown):number|null{
  const v=e as {seconds?:unknown;retryAfter?:unknown};
  if(typeof v?.retryAfter==='number')return v.retryAfter;
  const t=text(e);
  if(typeof v?.seconds==='number'&&/FLOOD|wait/i.test(t))return v.seconds;
  const m=t.match(/FLOOD_(?:PREMIUM_)?WAIT_?(\d+)|A wait of (\d+) seconds|retry after (\d+)/i);
  return m?Number(m[1]||m[2]||m[3]):null;
}
export const REVOKED=/AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|AUTH_KEY_DUPLICATED|AUTH_KEY_PERM_EMPTY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/i;
export function classifyTelegramError(e:unknown):ErrorKind{
  if(floodWaitSeconds(e)!==null)return 'flood';
  const t=text(e);
  if(REVOKED.test(t))return 'revoked';
  if(/FILE_REFERENCE_/i.test(t))return 'file_reference';
  if(/TIMEOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|EPIPE|Connection (?:closed|dropped)|Not connected|disconnected|socket|RPC_CALL_FAIL|RPC_MCGET_FAIL|INTERNAL_SERVER|NEED_MEMBER_INVALID|fetch failed|aborted/i.test(t))return 'network';
  return 'other';
}
/** «Equal jitter»: половина экспоненты гарантирована, вторая половина случайна — повторы разных пользователей не синхронизируются. */
export function backoffDelay(attempt:number,{base=1000,max=60000,random=Math.random}:{base?:number;max?:number;random?:()=>number}={}){
  const exp=Math.min(max,base*2**Math.max(0,attempt));
  return Math.round(exp/2+random()*exp/2);
}
export const sleep=(ms:number)=>new Promise<void>(resolve=>{const t=setTimeout(resolve,ms);(t as {unref?:()=>void}).unref?.();});
export type RetryOptions={attempts?:number;base?:number;max?:number;maxFloodWait?:number;random?:()=>number;wait?:(ms:number)=>Promise<void>;shouldRetry?:(e:unknown,kind:ErrorKind)=>boolean;onRetry?:(info:{attempt:number;delay:number;kind:ErrorKind;error:unknown})=>void|Promise<void>};
/** Повтор с бэкоффом: сетевые сбои — по экспоненте с джиттером, FLOOD_WAIT — ровно указанное время (если не дольше maxFloodWait), остальное — сразу наружу. */
export async function retry<T>(fn:(attempt:number)=>Promise<T>,o:RetryOptions={}):Promise<T>{
  const attempts=o.attempts??3,wait=o.wait||sleep;
  for(let attempt=0;;attempt++){
    try{return await fn(attempt);}
    catch(error){
      const kind=classifyTelegramError(error),flood=floodWaitSeconds(error);
      const allowed=o.shouldRetry?o.shouldRetry(error,kind):kind==='network'||kind==='flood'&&flood!==null&&flood<=(o.maxFloodWait??30);
      if(!allowed||attempt+1>=attempts)throw error;
      const delay=kind==='flood'&&flood!==null?flood*1000+Math.round((o.random||Math.random)()*500):backoffDelay(attempt,{base:o.base??500,max:o.max??10000,random:o.random});
      await o.onRetry?.({attempt:attempt+1,delay,kind,error});
      await wait(delay);
    }
  }
}
/** Последовательная очередь по ключу с дебаунсом: задачи одного ключа никогда не пересекаются,
 * серия вызовов за debounceMs сливается в один запуск (последнее состояние выигрывает — задача читает его сама),
 * а вызов во время выполнения ставит ровно один повторный запуск после текущего. */
export function createLatestQueue(run:(key:string)=>Promise<void>,{debounceMs=1500,onError}:{debounceMs?:number;onError?:(key:string,error:unknown)=>void}={}){
  type Slot={timer?:ReturnType<typeof setTimeout>;due?:number;running?:Promise<void>;dirty:boolean;waiters:Array<()=>void>};
  const slots=new Map<string,Slot>();
  const start=(key:string,slot:Slot)=>{
    slot.timer=undefined;slot.due=undefined;
    if(slot.running){slot.dirty=true;return;}
    slot.dirty=false;
    const waiters=slot.waiters.splice(0);
    slot.running=Promise.resolve().then(()=>run(key)).catch(error=>onError?.(key,error)).finally(()=>{
      slot.running=undefined;waiters.forEach(w=>w());
      if(slot.dirty)start(key,slot);else if(!slot.timer&&!slot.waiters.length&&slots.get(key)===slot)slots.delete(key);
    });
  };
  const queue={
    /** Запланировать запуск через delay мс; более ранний уже запланированный срок не откладывается дальше, чем на delay. */
    schedule(key:string,delay=debounceMs):Promise<void>{
      let slot=slots.get(key);if(!slot){slot={dirty:false,waiters:[]};slots.set(key,slot);}
      const s=slot,done=new Promise<void>(resolve=>s.waiters.push(resolve));
      if(s.timer)clearTimeout(s.timer);
      s.due=Date.now()+delay;s.timer=setTimeout(()=>start(key,s),delay);
      (s.timer as {unref?:()=>void}).unref?.();
      return done;
    },
    now:(key:string)=>queue.schedule(key,0),
    /** Повтор после ошибки: не сокращает уже назначенный более поздний срок (например, FLOOD_WAIT). */
    retryLater(key:string,delay:number){const s=slots.get(key);if(s?.due&&s.due>Date.now()+delay)return;void queue.schedule(key,delay);},
    pending:(key:string)=>slots.has(key),
    cancel(key:string){const s=slots.get(key);if(!s)return;if(s.timer)clearTimeout(s.timer);s.timer=undefined;s.waiters.splice(0).forEach(w=>w());if(!s.running)slots.delete(key);},
    size:()=>slots.size,
  };
  return queue;
}
const health=new Map<string,SessionHealth>();
/** Обновляет состояние здоровья; возвращает true, если состояние сменилось (для логов без спама). */
export function setHealth(userId:string,state:HealthState,reason?:string,retryAt?:number){
  const prev=health.get(userId);
  health.set(userId,{state,reason,retryAt,updatedAt:Date.now()});
  return prev?.state!==state||prev?.reason!==reason;
}
export const getHealth=(userId:string)=>health.get(userId);
export const clearHealth=(userId:string)=>{health.delete(userId);};
