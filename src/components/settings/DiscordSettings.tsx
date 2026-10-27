import React from 'react';
import {Check} from 'lucide-react';
import {startDiscord,type DiscordUser} from '../../discord/discordAuth.js';
import {apiClient} from '../../api/apiClient.js';
import {useToastStore} from '../../stores/useToastStore.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {desktopExtrasAvailable,desktopInfo,getDesktopPrefs,setDesktopPrefs} from '../../desktop/desktopBridge.js';

/** Discord: the linked account (sign-in on the site) and where the «Слушает» status comes from. */
export function DiscordSettings(){
  const t=useTranslation();
  const [linked,setLinked]=React.useState<DiscordUser|null|undefined>(undefined),[busy,setBusy]=React.useState(false);
  React.useEffect(()=>{const load=()=>void apiClient.request<{linked:DiscordUser|null}>('/discord').then(d=>setLinked(d.linked)).catch(()=>setLinked(null));load();window.addEventListener('oskolok-discord',load);return()=>window.removeEventListener('oskolok-discord',load);},[]);
  const unlink=async()=>{setBusy(true);try{await apiClient.request('/discord/link',{method:'DELETE'});setLinked(null);}finally{setBusy(false);}};
  return <section className="set-group">
    <h4>Discord</h4>
    <div className="set-row discord-account">
      {linked?<img src={linked.avatarUrl||''} alt="" className="discord-avatar" hidden={!linked.avatarUrl}/>:null}
      <span>{linked?t(`Подключён: ${linked.globalName||linked.username}`,`Connected: ${linked.globalName||linked.username}`):t('Аккаунт Discord','Discord account')}
        <small>{linked?t(`@${linked.username} · теперь можно входить в Осколок через Discord`,`@${linked.username} · you can now sign in to Oskolok with Discord`):t('Подключите, чтобы входить в Осколок через Discord','Connect to sign in to Oskolok with Discord')}</small></span>
      {linked===undefined?null:linked?<button type="button" className="sg-btn" disabled={busy} onClick={()=>void unlink()}>{t('Отключить','Disconnect')}</button>
        :<button type="button" className="sg-btn sg-btn--primary" disabled={busy} onClick={()=>{setBusy(true);void startDiscord('link').catch(e=>useToastStore.getState().addToast((e as Error).message,'warning')).finally(()=>setBusy(false));}}>{busy?t('Ждём Discord…','Waiting for Discord…'):t('Подключить','Connect')}</button>}
    </div>
    <DiscordStatusRow/>
  </section>;
}

/** «Слушает Осколок» in Discord: only the desktop app may set it (Discord lets a program on the same computer do so). */
function DiscordStatusRow(){
  const t=useTranslation();
  const [prefs,setPrefs]=React.useState(getDesktopPrefs);
  const [info,setInfo]=React.useState<{discord:boolean;discordUser?:{username:string;globalName?:string}|null}|null>(null);
  React.useEffect(()=>{if(desktopExtrasAvailable())void desktopInfo().then(setInfo);},[]);
  const update=(patch:Partial<typeof prefs>)=>{setDesktopPrefs(patch);setPrefs(getDesktopPrefs());};
  if(!desktopExtrasAvailable())return <div className="set-row"><span>{t('Статус в Discord','Discord status')}<small>{t('«Слушает Осколок» ставит только приложение для компьютера: Discord разрешает менять статус лишь программе на том же компьютере.','Only the desktop app sets “Listening to Oskolok”: Discord lets only a program on the same computer change your status.')}</small></span><DesktopDownloads/></div>;
  return <>
    {info?.discord?<label className={`set-row set-check ${prefs.discord?'is-on':''}`}>
      <span>{t('Статус в Discord','Discord status')}<small>{info.discordUser===undefined?null:info.discordUser?t(`Discord на этом компьютере: ${info.discordUser.globalName||info.discordUser.username}. `,`Discord on this computer: ${info.discordUser.globalName||info.discordUser.username}. `):t('Discord не запущен или ещё не подключился. ','Discord is not running or not connected yet. ')}{t('«Слушает Осколок»: трек, артист и кнопка «Слушать в Осколке» в профиле Discord','“Listening to Oskolok”: track, artist and a “Listen in Oskolok” button on your Discord profile')}</small></span>
      <input type="checkbox" checked={prefs.discord} onChange={e=>update({discord:e.target.checked})}/>
      <i className="set-check-box" aria-hidden="true"><Check size={14} strokeWidth={3}/></i>
    </label>:info&&<div className="set-row"><span>{t('Статус в Discord','Discord status')}<small>{t('В этой версии приложения его нет. Скачайте новую — настройки и вход сохранятся.','This app version does not have it. Download the new one — settings and sign-in stay.')}</small></span><DesktopDownloads/></div>}
  </>;
}

/** Public builds (see DEPLOY.md, /downloads): the current platform first. */
export function DesktopDownloads(){
  const mac=/Mac/i.test(navigator.platform||navigator.userAgent);
  const links:Array<[string,string]>=[['Windows','/downloads/Oskolok-Setup.exe'],['macOS · Apple Silicon','/downloads/Oskolok-arm64.dmg'],['macOS · Intel','/downloads/Oskolok-x64.dmg']];
  if(mac)links.push(links.shift()!);
  return <span className="set-downloads">{links.map(([label,href])=><a key={href} className="set-download" href={href} download>{label}</a>)}</span>;
}
