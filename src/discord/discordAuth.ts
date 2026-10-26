import {apiClient} from '../api/apiClient.js';
import {useToastStore} from '../stores/useToastStore.js';
import {tr} from '../stores/useLanguageStore.js';
import {APP_BASE} from '../routing.js';
import {STATE,CAUGHT} from './capture.js';

/** Discord sign-in and account linking (implicit grant, scope identify): Discord sends the browser back to
 * /app/#access_token=…&state=…; the token goes to the server once and is never stored here. */
export interface DiscordUser {id:string;username:string;globalName?:string;avatarUrl?:string}
type Mode='link'|'login';
const redirectUri=()=>`${location.origin}${APP_BASE}/`;

export async function startDiscord(mode:Mode){
 const {clientId}=await apiClient.request<{clientId:string}>('/auth/discord/config');
 const state=`osk-discord-${mode}-${crypto.randomUUID()}`;
 sessionStorage.setItem(STATE,state);
 const url=new URL('https://discord.com/oauth2/authorize');
 url.search=new URLSearchParams({client_id:clientId,response_type:'token',scope:'identify',redirect_uri:redirectUri(),state,prompt:'none'}).toString();
 location.assign(url.toString());
}

/** Hands a caught token to the server (before the app reads the session, so a Discord sign-in is seen at once). */
export async function finishDiscordRedirect(){
 const raw=sessionStorage.getItem(CAUGHT);
 if(!raw)return;
 sessionStorage.removeItem(CAUGHT);
 const {mode,token,error}=JSON.parse(raw) as {mode:Mode;token:string;error:string};
 const toast=useToastStore.getState().addToast;
 if(!token){if(error!=='access_denied')toast(tr('Discord не ответил. Попробуйте ещё раз.','Discord did not answer. Try again.'),'warning',5000);return;}
 try{
  if(mode==='login')await apiClient.request('/auth/discord/login',{method:'POST',body:JSON.stringify({accessToken:token})});
  else{
   const {linked}=await apiClient.request<{linked:DiscordUser}>('/discord/link',{method:'POST',body:JSON.stringify({accessToken:token})});
   toast(tr(`Discord подключён: ${linked.globalName||linked.username}`,`Discord connected: ${linked.globalName||linked.username}`),'success',4000);
  }
 }catch(e){toast((e as Error).message||tr('Не удалось подключить Discord.','Could not connect Discord.'),'warning',7000);}
}
