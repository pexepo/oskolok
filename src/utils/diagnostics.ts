/** Ring buffer of recent client errors attached to problem reports. Installed once on import. */
const MAX=20,buffer:string[]=[];
const stamp=()=>new Date().toISOString().slice(11,19);
const describe=(value:unknown):string=>value instanceof Error?`${value.name}: ${value.message}${value.stack?`\n${value.stack.split('\n').slice(1,4).join('\n')}`:''}`:typeof value==='string'?value:(()=>{try{return JSON.stringify(value);}catch{return String(value);}})();
function push(kind:string,parts:unknown[]){const text=parts.map(describe).join(' ').slice(0,900);if(!text.trim())return;buffer.push(`[${stamp()}] ${kind}: ${text}`);if(buffer.length>MAX)buffer.shift();}
let installed=false;
export function installDiagnostics(){
 if(installed||typeof window==='undefined')return;installed=true;
 const original=console.error.bind(console);
 console.error=(...args:unknown[])=>{push('console',args);original(...args);};
 window.addEventListener('error',e=>push('error',[e.error||`${e.message} @ ${e.filename}:${e.lineno}`]));
 window.addEventListener('unhandledrejection',e=>push('promise',[e.reason]));
}
export const recentErrors=()=>[...buffer];
installDiagnostics();

const PAGE_NAMES:Array<[RegExp,string,string]>=[[/^\/$/,'Главная','Home'],[/^\/search/,'Поиск','Search'],[/^\/(collection|library)/,'Коллекция','Collection'],[/^\/liked/,'Любимые треки','Liked tracks'],[/^\/playlists?/,'Плейлисты','Playlists'],[/^\/history/,'История','History'],[/^\/queue/,'Очередь','Queue'],[/^\/track\//,'Трек','Track'],[/^\/artist\//,'Артист','Artist'],[/^\/release\//,'Релиз','Release'],[/^\/import/,'Импорт','Import'],[/^\/admin/,'Админка','Admin'],[/^\/profile/,'Профиль','Profile'],[/^\/users\//,'Публичный профиль','Public profile'],[/^\/unreleased/,'Анрелизы','Unreleased']];
export function pageName(pathname:string,language:'ru'|'en'='ru'){const hit=PAGE_NAMES.find(([re])=>re.test(pathname));return hit?(language==='en'?hit[2]:hit[1]):pathname;}
