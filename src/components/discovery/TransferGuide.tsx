import React from 'react';
import {Copy,ExternalLink,Heart,Link2,MoreHorizontal,Share2,Upload,UserRound,Globe2,Check} from 'lucide-react';
import {ServiceLogo,EXPORTIFY_URL} from './MusicAccounts.js';
import {SoonBadge} from '../common/SoonBadge.js';
import {useTranslation} from '../../stores/useLanguageStore.js';

export type TransferService='spotify'|'soundcloud'|'yandex'|'tidal';
type T=(ru:string,en:string)=>string;
type Step={title:string;text:React.ReactNode;mock:React.ReactNode};

/* Small drawn screens: just enough of each app to show where to tap. The
   highlighted control pulses; everything else is quiet placeholder chrome. */
const Bars=({n=3}:{n?:number})=><span className="tg-bars">{Array.from({length:n},(_,i)=><i key={i} style={{width:`${82-i*18}%`}}/>)}</span>;

function PlaylistScreen({service,t}:{service:'spotify'|'soundcloud';t:T}){
 return <div className="tg-screen">
  <div className="tg-cover"><ServiceLogo id={service} size={22}/></div>
  <div className="tg-head"><strong>{t('Мой плейлист','My playlist')}</strong><Bars n={1}/></div>
  <div className="tg-row"><span className="tg-play"/><span className="tg-hot tg-icon"><MoreHorizontal size={16}/></span></div>
  <Bars/>
 </div>;
}
function ShareMenu({t,service}:{t:T;service:'spotify'|'soundcloud'}){
 return <div className="tg-screen tg-screen--menu">
  <div className="tg-menu-item"><Bars n={1}/></div>
  <div className="tg-menu-item is-open"><Share2 size={14}/>{t('Поделиться','Share')}</div>
  <div className="tg-submenu"><div className="tg-menu-item tg-hot"><Copy size={14}/>{service==='spotify'?t('Скопировать ссылку на плейлист','Copy link to playlist'):t('Скопировать ссылку','Copy link')}</div><div className="tg-menu-item"><Bars n={1}/></div></div>
 </div>;
}
function PasteScreen({url,t}:{url:string;t:T}){
 return <div className="tg-screen tg-screen--paste">
  <div className="tg-input tg-hot"><Link2 size={14}/><span>{url}</span></div>
  <div className="tg-button">{t('Показать треки','Show tracks')}</div>
  <div className="tg-check"><Check size={13}/>{t('Проверьте список и сохраните','Review the list and save')}</div>
 </div>;
}
function ExportifyScreen({t}:{t:T}){
 return <div className="tg-screen">
  <div className="tg-head"><strong>Exportify</strong><Bars n={1}/></div>
  <div className="tg-table"><span><Heart size={13}/>{t('Любимые треки','Liked Songs')}</span><span className="tg-hot tg-chip">Export</span></div>
  <div className="tg-file"><Upload size={14}/>liked_songs.csv</div>
 </div>;
}
function ProfileUrlScreen({t}:{t:T}){
 return <div className="tg-screen">
  <div className="tg-url"><Globe2 size={13}/><span className="tg-hot">soundcloud.com/<b>{t('ваш-ник','your-name')}</b></span></div>
  <div className="tg-profile"><span className="tg-avatar"><UserRound size={18}/></span><Bars n={2}/></div>
  <div className="tg-tabs"><span>{t('Треки','Tracks')}</span><span className="is-on">{t('Лайки','Likes')}</span><span>{t('Плейлисты','Playlists')}</span></div>
 </div>;
}
function PublicLikesScreen({t}:{t:T}){
 return <div className="tg-screen">
  <div className="tg-head"><strong>{t('Настройки → Приватность','Settings → Privacy')}</strong></div>
  <div className="tg-toggle-row"><span>{t('Показывать мои лайки','Show my likes')}</span><span className="tg-toggle tg-hot is-on"><i/></span></div>
  <Bars n={2}/>
 </div>;
}

function stepsFor(service:'spotify'|'soundcloud',t:T):{title:string;lead:string;steps:Step[];extra?:Step[]}{
 if(service==='spotify')return {
  title:'Spotify',lead:t('Вход не нужен: Осколок читает публичные ссылки. Плейлисты и альбомы — по ссылке, «Любимые треки» — файлом.','No sign-in: Osk reads public links. Playlists and albums go by link, Liked Songs by file.'),
  steps:[
   {title:t('Откройте плейлист','Open the playlist'),text:t('В приложении или на open.spotify.com откройте плейлист или альбом и нажмите «⋯».','In the app or on open.spotify.com open a playlist or album and tap “⋯”.'),mock:<PlaylistScreen service="spotify" t={t}/>},
   {title:t('Скопируйте ссылку','Copy the link'),text:t('«Поделиться» → «Скопировать ссылку на плейлист». Плейлист должен быть публичным.','“Share” → “Copy link to playlist”. The playlist must be public.'),mock:<ShareMenu service="spotify" t={t}/>},
   {title:t('Вставьте её ниже','Paste it below'),text:t('Нажмите «Показать треки», уберите лишнее и сохраните — получится плейлист в коллекции.','Press “Show tracks”, untick anything you don’t want and save — it becomes a playlist in your collection.'),mock:<PasteScreen url="open.spotify.com/playlist/…" t={t}/>},
  ],
  extra:[{title:t('«Любимые треки» и большие плейлисты','Liked Songs and big playlists'),text:<>{t('Spotify не даёт открыть «Любимые» по ссылке. Выгрузите их в CSV через ','Spotify does not share Liked Songs by link. Export them to CSV with ')}<a href={EXPORTIFY_URL} target="_blank" rel="noopener noreferrer">Exportify <ExternalLink size={11}/></a>{t(' — и загрузите файл ниже, в «Из файла».',' and upload the file below under “From a file”.')}</>,mock:<ExportifyScreen t={t}/>}],
 };
 return {
  title:'SoundCloud',lead:t('Вход не нужен: достаточно ссылки на профиль — перенесём все открытые лайки. Плейлисты переносятся по своим ссылкам.','No sign-in: a profile link is enough — we move every public like. Playlists go by their own links.'),
  steps:[
   {title:t('Скопируйте адрес профиля','Copy your profile address'),text:t('Откройте свою страницу на soundcloud.com и скопируйте адрес из строки браузера.','Open your page on soundcloud.com and copy the address from the browser bar.'),mock:<ProfileUrlScreen t={t}/>},
   {title:t('Лайки должны быть открыты','Likes must be public'),text:t('Если лайки скрыты, включите их показ в настройках приватности — иначе SoundCloud их не отдаст.','If your likes are hidden, show them in privacy settings — otherwise SoundCloud won’t share them.'),mock:<PublicLikesScreen t={t}/>},
   {title:t('Вставьте ссылку ниже','Paste the link below'),text:t('Профиль → все лайки, …/tracks → ваши загрузки, ссылка на плейлист → сам плейлист.','A profile → all likes, …/tracks → your uploads, a playlist link → that playlist.'),mock:<PasteScreen url="soundcloud.com/your-name" t={t}/>},
  ],
  extra:[{title:t('Отдельный плейлист','A single playlist'),text:t('Откройте плейлист → «Share» → «Copy link» и вставьте ссылку так же.','Open the playlist → “Share” → “Copy link” and paste it the same way.'),mock:<ShareMenu service="soundcloud" t={t}/>}],
 };
}

export function TransferServiceTabs({value,onChange}:{value:TransferService;onChange:(v:TransferService)=>void}){
 const t=useTranslation();
 const items:Array<[TransferService,string,boolean]>=[['spotify','Spotify',true],['soundcloud','SoundCloud',true],['yandex',t('Яндекс Музыка','Yandex Music'),false],['tidal','TIDAL',false]];
 return <div className="transfer-tabs" role="tablist" aria-label={t('Откуда переносим','Transfer from')}>
  {items.map(([id,label,open])=><button key={id} type="button" role="tab" aria-selected={value===id} className={`transfer-tab service-${id}${value===id?' is-active':''}${open?'':' is-soon'}`} onClick={()=>onChange(id)}>
   <span className="transfer-tab-logo"><ServiceLogo id={id} size={18}/></span>{label}{!open&&<SoonBadge/>}
  </button>)}
 </div>;
}

/** Step-by-step picture guide for one service; the shared link and file inputs follow it on the page. */
export function TransferGuide({service}:{service:'spotify'|'soundcloud'}){
 const t=useTranslation(),guide=stepsFor(service,t);
 return <section className={`transfer-guide crystal-slab service-${service}`} aria-label={t(`Как перенести из ${guide.title}`,`How to move from ${guide.title}`)}>
  <p className="transfer-guide-lead">{guide.lead}</p>
  <ol className="transfer-steps">{guide.steps.map((step,i)=><li key={step.title} className="transfer-step"><div className="transfer-step-mock" aria-hidden="true">{step.mock}</div><h3><span className="transfer-step-num">{i+1}</span>{step.title}</h3><p>{step.text}</p></li>)}</ol>
  {guide.extra?.map(step=><div key={step.title} className="transfer-extra"><div className="transfer-step-mock" aria-hidden="true">{step.mock}</div><div><h3>{step.title}</h3><p>{step.text}</p></div></div>)}
 </section>;
}
