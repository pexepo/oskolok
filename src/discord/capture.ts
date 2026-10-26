/* Kept free of imports: main.tsx runs it on every page, the public site included. */
export const STATE='osk-discord-state',CAUGHT='osk-discord-caught';

/** Runs before routing: takes the token out of the address bar so nothing else (or history) sees it. */
export function captureDiscordRedirect(){
 if(!location.hash.includes('state=osk-discord-'))return;
 const p=new URLSearchParams(location.hash.slice(1));
 history.replaceState(history.state,'',location.pathname+location.search);
 const state=p.get('state')||'',expected=sessionStorage.getItem(STATE);
 sessionStorage.removeItem(STATE);
 if(!expected||state!==expected)return;
 sessionStorage.setItem(CAUGHT,JSON.stringify({mode:state.startsWith('osk-discord-login-')?'login':'link',token:p.get('access_token')||'',error:p.get('error')||''}));
}
