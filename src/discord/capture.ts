/* Kept free of imports: main.tsx runs it on every page, the public site included. */
export const STATE='osk-discord-state',CAUGHT='osk-discord-caught';

/** Runs before routing: takes the token out of the address bar so nothing else (or history) sees it.
 * Returns true when Discord sent the browser here, so the caller keeps it in the player instead of the site. */
export function captureDiscordRedirect():boolean{
 if(!location.hash.includes('state=osk-discord-'))return false;
 const p=new URLSearchParams(location.hash.slice(1));
 history.replaceState(history.state,'',location.pathname+location.search);
 const state=p.get('state')||'';
 // own: this browser started the attempt (the web app); otherwise the desktop app or another tab waits for it.
 sessionStorage.setItem(CAUGHT,JSON.stringify({state,own:sessionStorage.getItem(STATE)===state,token:p.get('access_token')||'',error:p.get('error')||''}));
 return true;
}
