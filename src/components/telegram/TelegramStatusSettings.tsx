import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Check,ChevronLeft,ChevronRight,CirclePlus,Music} from 'lucide-react';
import {apiClient} from '../../api/apiClient.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {STATUS_DEFAULT,STATUS_STYLES,renderStatusTitle,statusStyle} from '../../telegram/statusTemplate.js';
import type {Track} from '../../types/index.js';
import './telegram-status.css';

type StatusInfo={template:string;custom:boolean;defaultTemplate:string;maxLength:number;telegram:{name:string;username:string|null;avatarUrl:string}|null};
type Health={state:'connected'|'reconnecting'|'needs_relogin'|'rate_limited'|'disconnected';reason?:string;retryAt?:number;syncError:string|null};
type PreviewTrack={title:string;artist:{name:string};release?:{title:string};artworkUrl?:string};
const SAMPLE:PreviewTrack={title:'даря себя огню',artist:{name:'k0vertessence'}};

/** Средний цвет нижней полосы аватара — Telegram красит плашку музыки в тон фото. */
function useBarTint(src?:string){
  const [tint,setTint]=useState<string>();
  useEffect(()=>{
    setTint(undefined);if(!src)return;
    let alive=true;const img=new Image();
    if(!src.startsWith('data:'))img.crossOrigin='anonymous';
    img.onload=()=>{try{
      const c=document.createElement('canvas');c.width=24;c.height=24;const g=c.getContext('2d',{willReadFrequently:true});if(!g)return;
      g.drawImage(img,0,0,24,24);const d=g.getImageData(0,19,24,5).data;let r=0,gr=0,b=0;
      for(let i=0;i<d.length;i+=4){r+=d[i];gr+=d[i+1];b+=d[i+2];}
      const n=d.length/4,k=.62;if(alive)setTint(`rgba(${Math.round(r/n*k)},${Math.round(gr/n*k)},${Math.round(b/n*k)},.74)`);
    }catch{/* CORS-tainted canvas: остаётся тёплый цвет по умолчанию */}};
    img.src=src;return()=>{alive=false;};
  },[src]);
  return tint;
}

export function TelegramProfilePreview({name,avatarUrl,title,artist}:{name:string;avatarUrl?:string;title:string;artist:string}){
  const t=useTranslation(),tint=useBarTint(avatarUrl);
  const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';
  return <figure className="tg-preview" aria-label={t('Превью профиля Telegram','Telegram profile preview')}>
    <div className="tg-preview__head">
      {avatarUrl?<img className="tg-preview__photo" src={avatarUrl} alt=""/>:<div className="tg-preview__photo tg-preview__photo--empty" aria-hidden="true">{initials}</div>}
      <div className="tg-preview__shade" aria-hidden="true"/>
      <span className="tg-preview__back" aria-hidden="true"><ChevronLeft size={22} strokeWidth={2.4}/></span>
      <span className="tg-preview__edit" aria-hidden="true"><CirclePlus size={18} strokeWidth={1.8}/>{t('Изм.','Edit')}</span>
      <div className="tg-preview__who">
        <strong>{name}</strong>
        <span><svg className="tg-preview__badge" viewBox="0 0 14 16" aria-hidden="true"><path d="M7 .6 13.2 3v4.6c0 3.7-2.6 6.6-6.2 7.8C3.4 14.2.8 11.3.8 7.6V3z" fill="#fff"/><text x="7" y="10.8" textAnchor="middle" fontSize="8" fontWeight="700" fill="#1c1c1e">1</text></svg>{t('в сети','online')}</span>
      </div>
      <div className="tg-preview__music" style={tint?{background:tint}:undefined}>
        <Music size={13} strokeWidth={2.4} aria-hidden="true"/>
        <span className="tg-preview__track"><b>{title}</b><i> - {artist}</i></span>
        <ChevronRight size={13} strokeWidth={2.4} aria-hidden="true"/>
      </div>
    </div>
    <figcaption className="tg-sr">{`${name}: ${title} - ${artist}`}</figcaption>
  </figure>;
}

/** Состояние пользовательской сессии Telegram: обновляется раз в 15 с, пока раздел открыт. */
export function TelegramHealthBadge(){
  const t=useTranslation();
  const [h,setH]=useState<Health>();
  useEffect(()=>{
    let alive=true;
    const load=()=>apiClient.request<Health>('/telegram/health').then(v=>{if(alive)setH(v);}).catch(()=>{});
    void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},15000);
    return()=>{alive=false;clearInterval(timer);};
  },[]);
  if(!h||h.state==='disconnected')return null;
  const until=h.retryAt?new Date(h.retryAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'';
  const [label,hint]:[string,string]=h.state==='connected'?[t('Сессия активна','Session active'),t('Трек в профиле обновляется автоматически','Profile track updates automatically')]
    :h.state==='reconnecting'?[t('Переподключаемся…','Reconnecting…'),t('Связь с Telegram прервалась, пробуем снова','Lost connection to Telegram, retrying')]
    :h.state==='rate_limited'?[t('Telegram просит подождать','Telegram asks to wait'),until?t(`Обновим трек после ${until}`,`Will update after ${until}`):t('Обновим чуть позже','Will update a bit later')]
    :[t('Нужно войти заново','Sign in again'),t(`Telegram завершил сессию${h.reason?` (${h.reason})`:''}. Подключите её ниже.`,`Telegram ended the session${h.reason?` (${h.reason})`:''}. Reconnect below.`)];
  return <p className={`tg-health tg-health--${h.state}`} role="status"><i aria-hidden="true"/><b>{label}</b><span>{hint}</span></p>;
}

/** Текст подписи фиксирован, выбирается только стиль: шрифт и символы по краям. Выбор сохраняется сразу. */
export function TelegramStatusSettings({fallbackName,fallbackAvatar,fallbackTrack,enabled}:{fallbackName:string;fallbackAvatar?:string;fallbackTrack?:Track|null;enabled:boolean}){
  const t=useTranslation();
  const playerTrack=usePlayerStore(s=>s.currentTrack);
  const [info,setInfo]=useState<StatusInfo>(),[style,setStyle]=useState(STATUS_DEFAULT),[error,setError]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);
  const latest=useRef(0);
  useEffect(()=>{let alive=true;apiClient.request<StatusInfo>('/telegram/status-template').then(v=>{if(alive){setInfo(v);setStyle(statusStyle(v.template).id);}}).catch(e=>{if(alive)setError((e as Error).message);});return()=>{alive=false;};},[]);
  const track:PreviewTrack=playerTrack||fallbackTrack||SAMPLE;
  const title=useMemo(()=>renderStatusTitle(style,track,info?.maxLength),[style,track,info?.maxLength]);
  const pick=async(id:string)=>{
    if(id===style&&!error)return;
    const seq=++latest.current,previous=style;
    setStyle(id);setSaved(false);setError('');setBusy(true);
    try{const r=await apiClient.request<{template:string}>('/telegram/status-template',{method:'PUT',body:JSON.stringify({template:id===STATUS_DEFAULT?null:id})});if(seq===latest.current){setStyle(statusStyle(r.template).id);setSaved(true);}}
    catch(e){if(seq===latest.current){setStyle(previous);setError((e as Error).message);}}
    finally{if(seq===latest.current)setBusy(false);}
  };
  return <div className="set-row set-row--stack tg-status">
    <span>{t('Стиль подписи в профиле','Profile caption style')}<small>{t('Текст «Слушает в @oskolokplayerbot - трек» постоянный — выберите шрифт и украшения. Исполнитель добавляется после « - » автоматически.','The text “Listening in @oskolokplayerbot - track” is fixed — pick a font and decoration. The artist is appended after " - " automatically.')}</small></span>
    <TelegramHealthBadge/>
    <TelegramProfilePreview name={info?.telegram?.name||fallbackName||t('Слушатель','Listener')} avatarUrl={info?.telegram?.avatarUrl||fallbackAvatar||undefined} title={title} artist={track.artist.name}/>
    {!playerTrack&&!fallbackTrack&&<small className="tg-status__hint">{t('Пример трека — включите музыку, чтобы увидеть свою.','Sample track — play something to see yours.')}</small>}
    <div className="tg-styles" role="radiogroup" aria-label={t('Стиль подписи','Caption style')}>
      {STATUS_STYLES.map(s=><button key={s.id} type="button" role="radio" aria-checked={style===s.id} className={`tg-style ${style===s.id?'is-active':''}`} disabled={!info&&!error} onClick={()=>void pick(s.id)}>
        <span className="tg-style__sample">{renderStatusTitle(s.id,{title:'Трек'})}</span>
        <small>{t(s.label[0],s.label[1])}</small>
        {style===s.id&&<Check className="tg-style__check" size={13} aria-hidden="true"/>}
      </button>)}
    </div>
    {error&&<p className="set-note" role="alert">{error}</p>}
    {!enabled&&<p className="set-note">{t('Включите «Трек в профиле Telegram», чтобы подпись появилась.','Turn on "Track in Telegram profile" for the caption to appear.')}</p>}
    <span role="status" className="tg-status__saved">{busy?t('Сохраняем…','Saving…'):saved?t('Сохранено — Telegram обновится через пару секунд','Saved — Telegram updates in a few seconds'):''}</span>
  </div>;
}
