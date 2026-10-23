import React,{useEffect,useRef,useState} from 'react';
import {Check,Copy,ExternalLink,Search,ArrowRight,Link2,LogIn,X} from 'lucide-react';
import {apiClient} from '../../api/apiClient.js';
import type {ImportPreview} from '../../types/index.js';
import {LoadingState} from '../common/LoadingState.js';
import {Modal} from '../common/Modal.js';
import {ArtworkImage} from '../common/ArtworkImage.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import './music-accounts.css';
type Account={id:string;configured:boolean;connected:boolean};
type List={id:string;title:string;count?:number;artworkUrl?:string;importable?:boolean};
type Device={id:string;name:string;is_active:boolean};
export const EXPORTIFY_URL='https://exportify.app/';

export function ServiceLogo({id,size=24}:{id:string;size?:number}) {
 return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="currentColor">{id==='spotify'
  ?<><circle cx="12" cy="12" r="11"/><path d="M6.2 9.1c4.2-1.3 8.6-.9 12 1.1M6.9 12.6c3.4-1 7-.6 9.8 1M7.6 15.9c2.7-.7 5.4-.4 7.7.9" fill="none" stroke="var(--service-ink,#0b1a12)" strokeWidth="1.7" strokeLinecap="round"/></>
  :id==='deezer'?<path d="M1 17h4v3H1zm6 0h4v3H7zm0-4h4v3H7zm6 4h4v3h-4zm0-4h4v3h-4zm0-4h4v3h-4zm6 8h4v3h-4zm0-4h4v3h-4zm0-4h4v3h-4zm0-4h4v3h-4z"/>
  :id==='tidal'?<path d="M12 4.5 8.25 8.25 12 12l3.75-3.75zM4.5 4.5.75 8.25 4.5 12l3.75-3.75zm15 0-3.75 3.75L19.5 12l3.75-3.75zM12 12l-3.75 3.75L12 19.5l3.75-3.75z"/>
  :id==='youtube'?<path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.7 15.1V8.9l5.8 3.1z"/>
  :id==='soundcloud'?<path d="M1 13.6h1v4.2H1zm2.2-1.8h1v6h-1zm2.2-1.2h1v7.2h-1zm2.2-1.4h1v8.6h-1zm2.2-.6h1v9.2h-1zm2.4-.6a5.6 5.6 0 0 1 5.4 4.1 3.1 3.1 0 1 1 1.2 5.9h-6.6z"/>
  :<path d="m12 1.5 2.4 6.7 6.9-2.5-4.2 6 5.4 4.4-7.1.4.5 7.1L12 18.4l-3.9 5.2.5-7.1-7.1-.4 5.4-4.4-4.2-6 6.9 2.5z"/>}</svg>;
}

/**
 * Connected music services. Spotify needs no sign-in for public links, which
 * keeps it open to every listener; signing in is optional (Spotify limits
 * test apps to a handful of invited accounts).
 */
export function MusicAccounts({onImport,onSpotifyLink}:{onImport:(p:ImportPreview)=>void;onSpotifyLink?:()=>void}){
 const t=useTranslation();
 const [accounts,setAccounts]=useState<Account[]>([]),[lists,setLists]=useState<List[]>([]),[source,setSource]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState('');
 const [loadingLists,setLoadingLists]=useState(false),[importing,setImporting]=useState('');
 const [pending,setPending]=useState(''),[loginUrl,setLoginUrl]=useState(''),[copied,setCopied]=useState(false);
 const [code,setCode]=useState<{userCode:string;verificationUrl:string;expiresIn:number}>(),[devices,setDevices]=useState<Device[]>([]);
 const [device,setDevice]=useState(()=>localStorage.getItem('oskolok_spotify_device')||'');
 const locked=useRef(false),generation=useRef(0);
 const call=<T,>(path:string,method='GET',body?:unknown)=>apiClient.request<T>(`/music-accounts${path}`,{method,body:body?JSON.stringify(body):undefined});
 const refresh=async()=>{const data=await call<Account[]>('');setAccounts(data);return data;};
 useEffect(()=>{void refresh().catch(e=>setError(e.message));},[]);
 useEffect(()=>{if(!pending)return;let stopped=false,inFlight=false;const expires=Date.now()+(code?.expiresIn||1200)*1000;const timer=setInterval(async()=>{if(inFlight)return;inFlight=true;try{if(Date.now()>expires){setPending('');setCode(undefined);setError(t('Время входа истекло. Попробуйте снова.','Sign-in expired. Please try again.'));return;}if(pending==='yandex'||pending==='tidal'){const result=await call<{state:string}>(`/${pending}/status`);if(result.state==='expired')throw new Error(t('Код истёк. Начните вход снова.','Code expired. Start again.'));}const data=await refresh();if(!stopped&&data.some(a=>a.id===pending&&a.connected)){setPending('');setCode(undefined);setLoginUrl('');}}catch(e){if(!stopped)setError((e as Error).message);}finally{inFlight=false;}},3000);return()=>{stopped=true;clearInterval(timer);};},[pending,code]);
 const run=async(fn:()=>Promise<void>)=>{if(locked.current)return;locked.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}};
 const name=(id:string)=>({spotify:'Spotify',soundcloud:'SoundCloud',yandex:t('Яндекс Музыка','Yandex Music'),tidal:'TIDAL'}[id]||id);
 const openLists=async(a:Account)=>{
  const revision=++generation.current;
  setSource(a.id);setLists([]);setSearch('');setDevices([]);setError('');setLoadingLists(true);
  try{
   const data=await call<List[]>(`/${a.id}/playlists`);if(revision!==generation.current)return;setLists(data);
   if(a.id==='spotify'){const result=await call<{devices:Device[]}>('/spotify/player','POST',{method:'GET',path:'me/player/devices'}).catch(()=>({devices:[]}));if(revision===generation.current)setDevices(result.devices||[]);}
  }catch(e){if(revision===generation.current)setError((e as Error).message);}finally{if(revision===generation.current)setLoadingLists(false);}
 };
 const connect=async(a:Account)=>{
  setPending(a.id);setCode(undefined);setCopied(false);
  if(a.id==='yandex'||a.id==='tidal'){setCode(await call(`/${a.id}/connect`,'POST'));}
  else{const data=await call<{url:string}>(`/${a.id}/connect`,'POST');setLoginUrl(data.url);window.open(data.url,'_blank','noopener,noreferrer');}
 };
 const importList=async(l:List)=>{
  if(importing)return;setImporting(l.id);setError('');
  try{
   // Spotify keeps other people's playlists out of a test app's API, but the
   // public link path still reads them (first 100 tracks) for any listener.
   const data=source==='spotify'&&l.importable===false
    ?await apiClient.previewImport(`https://open.spotify.com/playlist/${l.id}`)
    :await call<ImportPreview>(`/${source}/playlists/${encodeURIComponent(l.id)}`);
   onImport({...data,title:l.title,artworkUrl:l.artworkUrl||data.artworkUrl});generation.current++;setSource('');
  }
  catch(e){setError((e as Error).message);}finally{setImporting('');}
 };
 const cancelPending=()=>{void call('/pending/cancel','POST',{provider:pending}).catch(()=>{});setPending('');setCode(undefined);setLoginUrl('');};
 const status=(a:Account)=>a.connected?t('Подключён','Connected'):!a.configured?t('Вход пока недоступен','Sign-in unavailable'):t('Не подключён','Not connected');
 const visible=lists.filter(l=>l.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 const spotify=accounts.find(a=>a.id==='spotify');
 const others=accounts.filter(a=>a.id!=='spotify');

 return <section className="transfer-services">
  <div className="transfer-services-grid">
   {/* Spotify: public links work for everyone, sign-in is an optional extra. */}
   <article className="service-card service-spotify crystal-slab">
    <div className="service-head"><span className="service-logo"><ServiceLogo id="spotify"/></span><div><h3>Spotify</h3><small className="service-state is-open">{spotify?.connected?t('Аккаунт подключён','Account connected'):t('Вход не нужен','No sign-in needed')}</small></div></div>
    <p>{t('Вставьте ссылку на публичный плейлист или альбом — подойдёт любой аккаунт. «Любимые треки» и большие плейлисты выгрузите в CSV через Exportify.','Paste a link to a public playlist or album. Export Liked Songs and big playlists to CSV with Exportify.')}</p>
    <div className="service-actions">
     <button type="button" className="service-primary" onClick={onSpotifyLink}><Link2 size={16}/>{t('Перенести по ссылке','Import by link')}</button>
     <a className="service-secondary" href={EXPORTIFY_URL} target="_blank" rel="noopener noreferrer">Exportify<ExternalLink size={13}/></a>
    </div>
    {spotify?.connected
     ?<div className="service-foot"><button type="button" className="text-button" disabled={busy} onClick={()=>void openLists(spotify)}>{t('Мои плейлисты','My playlists')}<ArrowRight size={13}/></button><button type="button" className="text-button" disabled={busy} onClick={()=>void run(async()=>{await call('/spotify','DELETE');await refresh();})}>{t('Отключить','Disconnect')}</button></div>
     :spotify?.configured&&<div className="service-foot"><button type="button" className="text-button" disabled={busy||!!pending} onClick={()=>void run(()=>connect(spotify))}><LogIn size={13}/>{t('Войти аккаунтом','Sign in')}</button><small>{t('для приглашённых тестеров','for invited testers')}</small></div>}
   </article>
   {others.map(a=><article key={a.id} className={`service-card service-${a.id} crystal-slab`}>
    <div className="service-head"><span className="service-logo"><ServiceLogo id={a.id}/></span><div><h3>{name(a.id)}</h3><small className={`service-state ${a.connected?'is-open':''}`}>{status(a)}</small></div></div>
    <p>{a.id==='soundcloud'&&!a.connected&&!a.configured?t('Без входа и без Artist Pro: вставьте ссылку на свой профиль SoundCloud — перенесём все открытые лайки (ссылка …/tracks — ваши загрузки). Плейлисты — по их ссылкам.','No sign-in and no Artist Pro: paste your SoundCloud profile link and we import all public likes (…/tracks for your uploads). Playlists go by their own links.'):a.id==='tidal'?t('Lossless FLAC с вашей подпиской TIDAL. Вход по коду устройства; затем включите «Lossless» в настройках или выберите TIDAL как источник трека.','Lossless FLAC with your own TIDAL subscription. Sign in with a device code, then turn on “Lossless” in settings or pick TIDAL as a track source.'):a.id==='yandex'?t('Вход по коду устройства: откройте страницу Яндекса, введите код — и выберите плейлист.','Device-code sign-in: open Yandex, enter the code and pick a playlist.'):t('Войдите — и перенесите свои плейлисты и лайки. Публичные ссылки работают и без входа.','Sign in to move your playlists and likes. Public links work without signing in.')}</p>
    <div className="service-actions">
     {a.connected
      ?a.id==='tidal'?<span className="service-primary service-static">FLAC · 16/44.1</span>:<button type="button" className="service-primary" disabled={busy} onClick={()=>void openLists(a)}>{t('Открыть плейлисты','Open playlists')}<ArrowRight size={16}/></button>
      :a.id==='soundcloud'&&!a.configured?<button type="button" className="service-primary" onClick={onSpotifyLink}><Link2 size={16}/>{t('По ссылке на профиль','By profile link')}</button>
      :<button type="button" className="service-primary service-slide" disabled={busy||!a.configured||!!pending} onClick={()=>void run(()=>connect(a))} aria-label={`${name(a.id)} · ${t('Войти','Sign in')}`}><span className="service-slide-track"><span>{name(a.id)}</span><span aria-hidden="true">{t('Войти','Sign in')}</span></span></button>}
     {a.connected&&<button type="button" className="service-secondary" disabled={busy} onClick={()=>void run(async()=>{await call(`/${a.id}`,'DELETE');await refresh();})}>{t('Отключить','Disconnect')}</button>}
    </div>
   </article>)}
  </div>

  {pending&&<div className="service-pending crystal-slab" role="status">
   <div><strong>{name(pending)} · {t('подтвердите вход','confirm sign-in')}</strong><p>{code?pending==='tidal'?t('Откройте страницу TIDAL и подтвердите код. Мы проверим подтверждение сами.','Open TIDAL and confirm the code. We will detect the confirmation.'):t('Откройте страницу Яндекса и введите код. Мы проверим подтверждение сами.','Open Yandex and enter the code. We will detect the confirmation.'):t('Подтвердите доступ в открывшемся окне — статус обновится автоматически.','Approve access in the new window — the status updates automatically.')}</p></div>
   <div className="service-pending-actions">
    {code?<><a className="service-primary" href={code.verificationUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>{pending==='tidal'?t('Открыть TIDAL','Open TIDAL'):t('Открыть Яндекс','Open Yandex')}</a><button type="button" className="service-code" onClick={()=>void navigator.clipboard.writeText(code.userCode).then(()=>setCopied(true)).catch(()=>setError(t('Не удалось скопировать. Выделите код вручную.','Could not copy. Select the code manually.')))}>{copied?<Check size={15}/>:<Copy size={15}/>}<strong>{code.userCode}</strong></button></>
     :loginUrl?<a href={loginUrl} target="_blank" rel="noopener noreferrer" className="service-primary"><ExternalLink size={15}/>{t('Продолжить вход','Continue sign-in')}</a>:<LoadingState size="sm" label={t('Готовим вход…','Preparing…')}/>}
    <button type="button" className="service-secondary" onClick={cancelPending}>{t('Отменить','Cancel')}</button>
   </div>
  </div>}
  {error&&!source&&<p role="alert" className="transfer-error">{error}</p>}

  <Modal isOpen={!!source} onClose={()=>{generation.current++;setSource('');}} title={`${name(source)} · ${t('плейлисты','playlists')}`}>
   <div className={`account-list-modal service-${source}`}>
    <div className="account-list-tools">
     <label className="account-list-search"><Search size={16}/><input placeholder={t('Найти плейлист','Find a playlist')} aria-label={t('Поиск плейлистов','Search playlists')} value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button type="button" aria-label={t('Очистить','Clear')} onClick={()=>setSearch('')}><X size={14}/></button>}</label>
     {devices.length>0&&<label className="account-list-device">{t("Устройство воспроизведения","Playback device")}<select value={device} onChange={e=>{setDevice(e.target.value);localStorage.setItem('oskolok_spotify_device',e.target.value);}}><option value="">{t('Активное устройство','Active device')}</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name}{d.is_active?' · ●':''}</option>)}</select></label>}
    </div>
    {error&&<p role="alert" className="transfer-error">{error}<button className="text-button" disabled={loadingLists} onClick={()=>{const a=accounts.find(x=>x.id===source);if(a)void openLists(a);}}>{t('Повторить','Retry')}</button></p>}
    {loadingLists?<LoadingState size="md" label={t('Загружаем плейлисты…','Loading playlists…')}/>
     :<div className="account-playlists">{visible.map(l=><button type="button" key={l.id} className={`account-playlist ${l.importable===false?'is-public':''}`} disabled={!!importing||(l.importable===false&&source!=='spotify')} onClick={()=>void importList(l)} title={l.importable===false?(source==='spotify'?t('Чужой плейлист: перенесём по публичной ссылке, до 100 треков','Not your playlist: imported via its public link, up to 100 tracks'):t('Площадка не отдаёт треки этого плейлиста','The service does not share this playlist')):undefined}>
      <span className="account-playlist-art">{l.id==='liked'?<span className="account-liked">♥</span>:<ArtworkImage src={l.artworkUrl} alt="" className="w-full h-full"/>}</span>
      <span className="account-playlist-copy"><strong>{l.title}</strong><small>{l.importable===false?(source==='spotify'?t('по публичной ссылке · до 100','via public link · up to 100'):t('недоступен для переноса','not importable')):l.count!==undefined?`${l.count} ${t('треков','tracks')}`:t('плейлист','playlist')}</small></span>
      <span className="account-playlist-go">{importing===l.id?<LoadingState size="sm" label={t('Загружаем','Loading')}/>:<ArrowRight size={16}/>}</span>
     </button>)}</div>}
    {!loadingLists&&!visible.length&&<p className="account-list-empty">{search?t('Ничего не нашлось','Nothing matches'):t('Плейлисты не найдены','No playlists found')}</p>}
   </div>
  </Modal>
 </section>;
}
