import React from 'react';
import {usePerformance,readDevice,type PerfMode} from '../../utils/performance.js';
import {Modal} from '../common/Modal.js';
import {PrivacySettings} from './PrivacySettings.js';
import {Sun, Moon, MonitorSmartphone, Sparkles, Settings2, Check, Send} from 'lucide-react';
import {getPreferredSource,setPreferredSource,recordingBetaEnabled,setRecordingBetaEnabled,inTelegramMiniApp} from '../../utils/playbackPreferences.js';
import {ServiceLogo} from '../discovery/MusicAccounts.js';
import {autoplayEnabled,setAutoplayEnabled} from '../../stores/waveSettings.js';
import {startDiscord,type DiscordUser} from '../../discord/discordAuth.js';
import {apiClient} from '../../api/apiClient.js';
import {desktopExtrasAvailable,desktopInfo,getDesktopPrefs,setDesktopPrefs,toggleMiniPlayer} from '../../desktop/desktopBridge.js';
import {useLanguageStore,useTranslation} from '../../stores/useLanguageStore.js';
import {useThemeStore, type ThemeMode} from '../../stores/useThemeStore.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** A row of mutually exclusive glass chips. */
function Segmented<T extends string>({value,options,onChange,label}:{value:T;options:Array<[T,React.ReactNode]>;onChange:(v:T)=>void;label:string}){
  return <div className="set-segmented" role="radiogroup" aria-label={label}>
    {options.map(([id,content])=><button key={id} type="button" role="radio" aria-checked={value===id} className={value===id?'is-active':''} onClick={()=>onChange(id)}>{content}</button>)}
  </div>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const {theme,setTheme}=useThemeStore();
  const {language,setLanguage}=useLanguageStore();
  const t=useTranslation();
  const tab='general';
  // TIDAL is no longer offered as the default; an old choice falls back to «Auto» here.
  const [source,setSource]=React.useState(()=>{const v=getPreferredSource();return v==='tidal'?'auto':v;});
  const [recordingBeta,setRecordingBeta]=React.useState(recordingBetaEnabled);
  const [autoplay,setAutoplay]=React.useState(autoplayEnabled);
  React.useEffect(()=>{const sync=()=>setSource(getPreferredSource());window.addEventListener('oskolok-source-change',sync);return()=>window.removeEventListener('oskolok-source-change',sync);},[]);
  if (!isOpen) return null;
  const sourceHint=source==='auto'?t('Самый быстрый источник точной версии трека','Fastest source with the exact version')
    :t('Этот источник для всех треков','This source for every track');

  return <Modal isOpen={isOpen} onClose={onClose} title={t('Настройки','Settings')}>
    {tab==='general'?<div className="set-sheet" role="tabpanel">
      <section className="set-group">
        <h4>{t('Оформление','Appearance')}</h4>
        <div className="set-row">
          <span>{t('Тема','Theme')}</span>
          <Segmented<ThemeMode> label={t('Тема','Theme')} value={theme} onChange={setTheme} options={[
            ['light',<><Sun size={14}/>{t('Светлая','Light')}</>],
            ['dark',<><Moon size={14}/>{t('Тёмная','Dark')}</>],
            ['system',<><MonitorSmartphone size={14}/>{t('Авто','Auto')}</>],
          ]}/>
        </div>
        <PerformanceRow/>
        <div className="set-row">
          <span>{t('Язык','Language')}</span>
          <Segmented<'ru'|'en'> label={t('Язык','Language')} value={language} onChange={setLanguage} options={[['ru','Русский'],['en','English']]}/>
        </div>
      </section>

      <section className="set-group">
        <h4>{t('Воспроизведение','Playback')}</h4>
        <div className="set-row set-row--stack">
          <span>{t('Источник по умолчанию','Default source')}<small>{sourceHint}</small></span>
          <Segmented label={t('Источник','Source')} value={source} onChange={value=>{setPreferredSource(value);setSource(value);}} options={[
            ['auto',<><Sparkles size={14}/>{t('Авто','Auto')}</>],
            ['soundcloud',<><ServiceLogo id="soundcloud" size={14}/>SoundCloud</>],
            ['youtube',<><ServiceLogo id="youtube" size={14}/>YouTube</>],
          ]}/>
        </div>
        <label className="set-row set-check"><span>{t('Сравнение аудиодорожек · альфа/бета','Compare recordings · alpha/beta')}<small>{t('Три превью по 15 секунд и отметки цензуры для YouTube и SoundCloud','Three 15-second previews and censorship feedback for YouTube and SoundCloud')}</small></span><input type="checkbox" checked={recordingBeta} onChange={e=>{setRecordingBeta(e.target.checked);setRecordingBetaEnabled(e.target.checked);}}/><i className="set-check-box" aria-hidden="true">{recordingBeta&&<Check size={14}/>}</i></label>
        <label className={`set-row set-check ${autoplay?'is-on':''}`}>
          <span>{t('Автопродолжение','Autoplay')}<small>{t('Когда плейлист, любимые или подборка заканчиваются, дальше играет похожая музыка','When a playlist, your likes or a selection ends, similar music keeps playing')}</small></span>
          <input type="checkbox" checked={autoplay} onChange={e=>{setAutoplayEnabled(e.target.checked);setAutoplay(e.target.checked);}}/>
          <i className="set-check-box" aria-hidden="true"><Check size={14} strokeWidth={3}/></i>
        </label>
      </section>
      <DiscordSettings/>
      {desktopExtrasAvailable()?<DesktopSettings/>:<section className="set-group"><h4>{t('Компьютер','Desktop')}</h4><div className="set-row"><span>{t('Приложение для компьютера','Desktop app')}<small>{t('Статус «Слушает Осколок» в Discord, мини-плеер поверх окон и горячая клавиша — только в приложении: Discord разрешает менять статус лишь программе на том же компьютере.','Discord “Listening to Oskolok” status, the floating mini player and a global shortcut live in the app: Discord lets only a program on the same computer set your status.')}</small></span><DesktopDownloads/></div></section>}
      <PrivacySettings/>
      <p className="set-eq-note">{t('Эквалайзер, скорость, тон и реверберация — в кнопке «Звук» на плашке плеера.','Equalizer, speed, pitch and reverb live under «Sound» on the player bar.')}</p>
    </div>:null}
    <div className="set-footer">
      <small>{t('Осколок · закрытый бета-тест','Oskolok · closed beta')}</small>
      <button type="button" className="sg-btn sg-btn--primary" onClick={onClose}>{t('Готово','Done')}</button>
    </div>
  </Modal>;
};

/** Effects level: «Авто» follows the hardware check, the rest force a level. */
function PerformanceRow(){
 const t=useTranslation(),{mode,detected,measuredFps,setMode}=usePerformance();
 const device=React.useMemo(()=>readDevice(),[]);
 const names:Record<string,string>={full:t('максимум','maximum'),balanced:t('сбалансированный','balanced'),lite:t('экономный','economy')};
 const facts=[device.memory?t(`${device.memory} ГБ памяти`,`${device.memory} GB RAM`):'',device.cores?t(`${device.cores} ядер`,`${device.cores} cores`):'',measuredFps?`${measuredFps} FPS`:''].filter(Boolean).join(' · ');
 return <div className="set-row set-row--stack">
  <span>{t('Эффекты и плавность','Effects and smoothness')}<small>{t(`Для этого устройства рекомендуем: ${names[detected]}`,`Recommended for this device: ${names[detected]}`)}{facts?` (${facts})`:''}. {t('Экономный режим убирает фон, размытие и анимации — помогает на слабых телефонах.','Economy turns off the backdrop, blur and animations — helps on weak phones.')}</small></span>
  <Segmented<PerfMode> label={t('Эффекты','Effects')} value={mode} onChange={setMode} options={[['auto',t('Авто','Auto')],['full',t('Максимум','Max')],['balanced',t('Баланс','Balanced')],['lite',t('Эконом','Economy')]]}/>
 </div>;
}

/** Discord: the linked account (sign-in on the site) and where the «Слушает» status comes from. */
function DiscordSettings(){
  const t=useTranslation();
  const [linked,setLinked]=React.useState<DiscordUser|null|undefined>(undefined),[busy,setBusy]=React.useState(false);
  React.useEffect(()=>{void apiClient.request<{linked:DiscordUser|null}>('/discord').then(d=>setLinked(d.linked)).catch(()=>setLinked(null));},[]);
  const unlink=async()=>{setBusy(true);try{await apiClient.request('/discord/link',{method:'DELETE'});setLinked(null);}finally{setBusy(false);}};
  return <section className="set-group">
    <h4>Discord</h4>
    <div className="set-row discord-account">
      {linked?<img src={linked.avatarUrl||''} alt="" className="discord-avatar" hidden={!linked.avatarUrl}/>:null}
      <span>{linked?t(`Подключён: ${linked.globalName||linked.username}`,`Connected: ${linked.globalName||linked.username}`):t('Аккаунт Discord','Discord account')}
        <small>{linked?t(`@${linked.username} · теперь можно входить в Осколок через Discord`,`@${linked.username} · you can now sign in to Oskolok with Discord`):t('Подключите, чтобы входить в Осколок через Discord','Connect to sign in to Oskolok with Discord')}</small></span>
      {linked===undefined?null:linked?<button type="button" className="sg-btn" disabled={busy} onClick={()=>void unlink()}>{t('Отключить','Disconnect')}</button>
        :<button type="button" className="sg-btn sg-btn--primary" onClick={()=>void startDiscord('link')}>{t('Подключить','Connect')}</button>}
    </div>
  </section>;
}

/** Desktop client only: the floating mini-player and Discord status. */
function DesktopSettings(){
  const t=useTranslation();
  const [prefs,setPrefs]=React.useState(getDesktopPrefs);
  const [info,setInfo]=React.useState<{discord:boolean;discordUser?:{username:string;globalName?:string}|null;shortcut:string}|null>(null);
  React.useEffect(()=>{void desktopInfo().then(setInfo);},[]);
  const update=(patch:Partial<typeof prefs>)=>{setDesktopPrefs(patch);setPrefs(getDesktopPrefs());};
  return <section className="set-group">
    <h4>{t('Компьютер','Desktop')}</h4>
    <div className="set-row"><span>{t('Мини-плеер поверх окон','Mini player on top')}<small>{info?.shortcut?t('Сочетание: Ctrl/⌘ + Alt + M из любого приложения','Shortcut: Ctrl/⌘ + Alt + M from any app'):t('Маленькое окно с обложкой и кнопками, которое не прячется за другими','A small window with the cover and buttons that stays above other windows')}</small></span><button type="button" className="sg-btn" onClick={toggleMiniPlayer}>{t('Показать','Show')}</button></div>
    <label className={`set-row set-check ${prefs.miniOnMinimize?'is-on':''}`}>
      <span>{t('Мини-плеер при сворачивании','Mini player when minimised')}<small>{t('Свернули Осколок — музыка остаётся под рукой','Minimise Oskolok and the music stays at hand')}</small></span>
      <input type="checkbox" checked={prefs.miniOnMinimize} onChange={e=>update({miniOnMinimize:e.target.checked})}/>
      <i className="set-check-box" aria-hidden="true"><Check size={14} strokeWidth={3}/></i>
    </label>
    {info?.discord?<label className={`set-row set-check ${prefs.discord?'is-on':''}`}>
      <span>{t('Статус в Discord','Discord status')}<small>{info.discordUser===undefined?null:info.discordUser?t(`Discord на этом компьютере: ${info.discordUser.globalName||info.discordUser.username}. `,`Discord on this computer: ${info.discordUser.globalName||info.discordUser.username}. `):t('Discord не запущен или ещё не подключился. ','Discord is not running or not connected yet. ')}{t('«Слушает Осколок»: трек, артист и кнопка «Слушать в Осколке» в профиле Discord','“Listening to Oskolok”: track, artist and a “Listen in Oskolok” button on your Discord profile')}</small></span>
      <input type="checkbox" checked={prefs.discord} onChange={e=>update({discord:e.target.checked})}/>
      <i className="set-check-box" aria-hidden="true"><Check size={14} strokeWidth={3}/></i>
    </label>:info&&<div className="set-row"><span>{t('Статус в Discord','Discord status')}<small>{t('В этой версии приложения его нет. Скачайте новую — настройки и вход сохранятся.','This app version does not have it. Download the new one — settings and sign-in stay.')}</small></span><DesktopDownloads/></div>}
  </section>;
}

/** Public builds (see DEPLOY.md, /downloads): the current platform first. */
function DesktopDownloads(){
  const mac=/Mac/i.test(navigator.platform||navigator.userAgent);
  const links:Array<[string,string]>=[['Windows','/downloads/Oskolok-Setup.exe'],['macOS · Apple Silicon','/downloads/Oskolok-arm64.dmg'],['macOS · Intel','/downloads/Oskolok-x64.dmg']];
  if(mac)links.push(links.shift()!);
  return <span className="set-downloads">{links.map(([label,href])=><a key={href} className="set-download" href={href} download>{label}</a>)}</span>;
}
