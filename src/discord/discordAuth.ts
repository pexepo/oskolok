import {apiClient} from '../api/apiClient.js';
import {useToastStore} from '../stores/useToastStore.js';
import {tr} from '../stores/useLanguageStore.js';
import {APP_BASE} from '../routing.js';
import {STATE,CAUGHT} from './capture.js';

/** Discord sign-in and account linking (implicit grant, scope identify). The attempt lives on the server: Discord
 * may send the browser back anywhere (the desktop app opens it in the system browser), that browser hands the token
 * over, and the client that started the attempt picks up the result. The token is never stored here. */
export interface DiscordUser {id:string;username:string;globalName?:string;avatarUrl?:string}
type Mode='link'|'login';
type Status={status:'pending'|'done'|'failed'|'expired';mode?:Mode;message?:string;linked?:DiscordUser};
const redirectUri=()=>`${location.origin}${APP_BASE}/`;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const toast=(text:string,type:'success'|'warning'|'info',ms=5000)=>useToastStore.getState().addToast(text,type,ms);

/** Opens Discord. In a browser the tab goes there and comes back; in the desktop app Discord opens in the
 * system browser and this window waits for the answer (resolved with the result, or null when given up). */
export async function startDiscord(mode:Mode):Promise<Status|null>{
 const [{clientId},{state}]=await Promise.all([
  apiClient.request<{clientId:string}>('/auth/discord/config'),
  apiClient.request<{state:string}>(mode==='login'?'/auth/discord/login/start':'/discord/link/start',{method:'POST',body:'{}'}),
 ]);
 sessionStorage.setItem(STATE,state);
 const url=new URL('https://discord.com/oauth2/authorize');
 url.search=new URLSearchParams({client_id:clientId,response_type:'token',scope:'identify',redirect_uri:redirectUri(),state,prompt:'none'}).toString();
 const desktop=typeof window!=='undefined'&&('oskolokDesktop' in window||/\bElectron\//.test(navigator.userAgent));
 location.assign(url.toString());
 if(!desktop)return null;
 toast(tr('Discord открылся в браузере. Подтвердите вход там — Осколок подхватит его сам.','Discord opened in your browser. Confirm there and Oskolok will pick it up.'),'info',8000);
 for(let i=0;i<240;i++){
  await sleep(2500);
  const s=await apiClient.request<Status>(`/auth/discord/status?state=${encodeURIComponent(state)}`).catch(()=>null);
  if(!s||s.status==='pending')continue;
  report(s);
  if(s.status==='done'&&s.mode==='login')location.reload();
  return s;
 }
 return null;
}

function report(s:Status){
 if(s.status==='done')toast(s.mode==='login'?tr('Вход через Discord выполнен','Signed in with Discord'):tr(`Discord подключён: ${s.linked?.globalName||s.linked?.username||''}`,`Discord connected: ${s.linked?.globalName||s.linked?.username||''}`),'success',4000);
 else if(s.status==='failed')toast(s.message||tr('Не удалось подключить Discord.','Could not connect Discord.'),'warning',7000);
 if(typeof window!=='undefined')window.dispatchEvent(new Event('oskolok-discord'));
}

/** Hands a caught token to the server before the app reads the session, so a Discord sign-in is seen at once. */
export async function finishDiscordRedirect(){
 const raw=sessionStorage.getItem(CAUGHT);
 if(!raw)return;
 sessionStorage.removeItem(CAUGHT);
 const {state,own,token,error}=JSON.parse(raw) as {state:string;own:boolean;token:string;error:string};
 if(!token){if(error!=='access_denied')toast(tr('Discord не ответил. Попробуйте ещё раз.','Discord did not answer. Try again.'),'warning');return;}
 try{
  await apiClient.request('/auth/discord/complete',{method:'POST',body:JSON.stringify({state,accessToken:token})});
  if(own){sessionStorage.removeItem(STATE);report(await apiClient.request<Status>(`/auth/discord/status?state=${encodeURIComponent(state)}`));}
  else toast(tr('Готово! Вернитесь в приложение Осколок — оно уже знает о Discord.','Done! Go back to the Oskolok app — it already knows.'),'success',10000);
 }catch(e){toast((e as Error).message||tr('Не удалось подключить Discord.','Could not connect Discord.'),'warning',7000);}
}
