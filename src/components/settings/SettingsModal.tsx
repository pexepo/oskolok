import React from 'react';
import {usePerformance,readDevice,type PerfMode} from '../../utils/performance.js';
import {Modal} from '../common/Modal.js';
import {PrivacySettings} from './PrivacySettings.js';
import {OfflineSettings} from '../../offline/OfflineUI.js';
import {Sun, Moon, MonitorSmartphone, Sparkles, Settings2, Check, Send, ChevronRight} from 'lucide-react';
import {getPreferredSource,setPreferredSource,recordingBetaEnabled,setRecordingBetaEnabled,inTelegramMiniApp} from '../../utils/playbackPreferences.js';
import {ServiceLogo} from '../discovery/MusicAccounts.js';
import {autoplayEnabled,setAutoplayEnabled} from '../../stores/waveSettings.js';
import {Link} from 'react-router-dom';
import {APP_VERSION,APP_RELEASE_DATE} from '../../version.js';
import {DesktopDownloads} from './DiscordSettings.js';
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
      <section className="set-group">
        <h4>{t('Telegram и Discord','Telegram and Discord')}</h4>
        <Link className="set-row set-row--button" to="/profile?tab=settings#listening-status" onClick={onClose}><span>{t('Статус «Слушает», аккаунты и сессия','“Listening” status, accounts and session')}<small>{t('Всё про Telegram и Discord — в профиле, в настройках','Everything about Telegram and Discord is in your profile settings')}</small></span><ChevronRight size={15}/></Link>
      </section>
      {desktopExtrasAvailable()?<DesktopSettings/>:<section className="set-group"><h4>{t('Компьютер','Desktop')}</h4><div className="set-row"><span>{t('Приложение для компьютера','Desktop app')}<small>{t('Мини-плеер поверх окон, горячая клавиша, статус в Discord и оффлайн-музыка — только в приложении.','The floating mini player, a global shortcut, Discord status and offline music live in the app.')}</small></span><DesktopDownloads/></div></section>}
      <OfflineSettings onNavigate={onClose}/>
      <PrivacySettings/>
      <p className="set-eq-note">{t('Эквалайзер, скорость, тон и реверберация — в кнопке «Звук» на плашке плеера.','Equalizer, speed, pitch and reverb live under «Sound» on the player bar.')}</p>
    </div>:null}
    <div className="set-footer">
      <VersionMark/>
      <button type="button" className="sg-btn sg-btn--primary" onClick={onClose}>{t('Готово','Done')}</button>
    </div>
  </Modal>;
};

/** The release number, drawn big: a shard-cut glass numeral with the cover-blue sheen of the brand. */
function VersionMark(){
  const t=useTranslation(),[major,minor]=APP_VERSION.split('.');
  const date=new Date(APP_RELEASE_DATE).toLocaleDateString(t('ru-RU','en-US'),{day:'numeric',month:'long',year:'numeric'});
  return <div className="set-version" aria-label={t(`Осколок, версия ${APP_VERSION}, ${date}`,`Oskolok version ${APP_VERSION}, ${date}`)}>
    <span className="set-version-num" aria-hidden="true">{major}<i>.</i>{minor}</span>
    <span className="set-version-text" aria-hidden="true"><b>{t('Осколок','Oskolok')}</b><small>{t(`Версия ${APP_VERSION} · ${date}`,`Version ${APP_VERSION} · ${date}`)}</small><small>{t('Закрытый бета-тест','Closed beta')}</small></span>
  </div>;
}

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


/** Desktop client only: the floating mini-player (Discord status lives with Telegram in the profile). */
function DesktopSettings(){
  const t=useTranslation();
  const [prefs,setPrefs]=React.useState(getDesktopPrefs);
  const [info,setInfo]=React.useState<{shortcut:string}|null>(null);
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
  </section>;
}

