import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {RadioTower,Check,X,Upload,Sparkles,Send,ListMusic} from 'lucide-react';
import './source-picker.css';
import {RecordingPicker} from './RecordingPicker.js';
import {inTelegramMiniApp} from '../../utils/playbackPreferences.js';
import {ServiceLogo} from '../discovery/MusicAccounts.js';
import type {Track} from '../../types/index.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {useToastStore} from '../../stores/useToastStore.js';
import {PersonalAudioDialog} from './PersonalAudioDialog.js';

type Option={id:string;label:string;hint:string;soon?:boolean};

export function PlaybackSourcePicker({value='auto',onChange,compact=false,track,appliesNow=false}:{value?:string;onChange:(v:string)=>void;compact?:boolean;deezer?:boolean;track?:Track;appliesNow?:boolean}){
 const t=useTranslation();
 const [recordings,setRecordings]=useState<string>();
 const [upload,setUpload]=useState(false),[position,setPosition]=useState<{top:number;left:number}>(),button=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 const options:Option[]=[
  {id:'auto',label:t('Автовыбор','Automatic'),hint:t('Лучшая точная версия, без цензуры','Best exact version, uncensored')},
  {id:'soundcloud',label:'SoundCloud',hint:t('Часто полная explicit-версия','Often the full explicit version')},
  {id:'youtube',label:'YouTube',hint:t('Есть почти всё, цензура разная','Has almost everything')},
 ];
 const close=()=>{setPosition(undefined);button.current?.focus();};
 const choose=(option:Option)=>{
  if(option.soon)return;
  onChange(option.id);
  useToastStore.getState().addToast(appliesNow?t('Переключаем источник…','Switching source…'):t('Источник сохранён для следующего запуска','Source saved for the next playback'),'success');close();
 };
 useEffect(()=>{if(!position)return;const close=(e:PointerEvent)=>{if(!menu.current?.contains(e.target as Node)&&!button.current?.contains(e.target as Node))setPosition(undefined);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setPosition(undefined);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};},[position]);
 useEffect(()=>{setRecordings(undefined);setUpload(false);setPosition(undefined);},[track?.id]);
 const current=options.find(o=>o.id===value);
 const POP_W=320;
 const open=()=>{const r=button.current!.getBoundingClientRect();const h=Math.min(440,innerHeight-16);const below=r.bottom+8+h<=innerHeight;setPosition({left:Math.max(8,Math.min(r.left,innerWidth-POP_W-8)),top:below?r.bottom+8:Math.max(8,r.top-8-h)});};
 return <><button ref={button} className={compact?'source-icon':'secondary-button'} aria-label={t('Источник воспроизведения','Playback source')} aria-expanded={!!position} onClick={e=>{e.stopPropagation();if(position){setPosition(undefined);return;}open();}}>{value==='telegram'?<Send size={16}/>:value!=='auto'&&value!=='personal'&&current?<ServiceLogo id={value} size={16}/>:<RadioTower size={16}/>}{!compact&&(current?.label||t('Ваш файл','Your file'))}</button>
 {position&&createPortal(<div className="src-pop" ref={menu} style={{...position,width:POP_W}} role="dialog" aria-label={t('Выбрать источник','Choose source')} onClick={e=>e.stopPropagation()}>
  <header className="src-pop-head"><div><strong>{t('Откуда играть','Play from')}</strong>{track&&<small>{track.title} · {track.artist.name}</small>}</div><button className="src-pop-x" aria-label={t('Закрыть','Close')} onClick={close}><X size={16}/></button></header>
  <div className="src-pop-list" role="radiogroup" aria-label={t('Источник','Source')}>
   {options.map(option=><div className={`src-opt${value===option.id?' is-on':''}`} key={option.id}>
    <button className="src-opt-main" role="radio" aria-checked={value===option.id} onClick={()=>choose(option)}>
     <span className="source-logo" data-source={option.id}>{option.id==='auto'?<Sparkles size={16}/>:option.id==='telegram'?<Send size={16}/>:<ServiceLogo id={option.id} size={18}/>}</span>
     <span className="src-opt-text"><strong>{option.label}</strong><small>{option.hint}</small></span>
     <i className="src-radio" aria-hidden="true"/>
    </button>
    {track&&['youtube','soundcloud'].includes(option.id)&&<button className="src-opt-rec" onClick={()=>{setPosition(undefined);setRecordings(option.id);}} title={t('Выбрать конкретную запись','Pick a specific recording')}><ListMusic size={14}/>{t('Записи','Recordings')}</button>}
   </div>)}
  </div>
  {track&&<button className="src-pop-file" onClick={()=>{setPosition(undefined);setUpload(true);}}><Upload size={16}/><span><strong>{t('Свой файл','Your own file')}</strong><small>{value==='personal'?t('Сейчас играет ваш файл','Your file is playing now'):t('Загрузить аудио для этого трека','Upload audio for this track')}</small></span>{value==='personal'&&<Check size={16}/>}</button>}
 </div>,document.body)}{track&&recordings&&<RecordingPicker track={track} source={recordings} onClose={()=>setRecordings(undefined)} onSelect={()=>onChange(recordings)}/>} {track&&<PersonalAudioDialog track={track} isOpen={upload} onClose={()=>setUpload(false)} onSaved={()=>{onChange('personal');}}/>}</>;
}
