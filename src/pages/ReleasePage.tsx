import React from 'react';
import {PageSkeleton} from '../components/common/Skeleton.js';
import {Link,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {Play,ArrowUpRight,Shuffle,Info,Download,Check,Plus,MoreHorizontal} from 'lucide-react';
import {apiClient} from '../api/apiClient.js';
import {contentApi} from '../api/userContentClient.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {usePlaylistStore} from '../stores/usePlaylistStore.js';
import {ArtworkImage} from '../components/common/ArtworkImage.js';
import {TrackRow} from '../components/tracks/TrackRow.js';
import {PlaybackSourcePicker} from '../components/tracks/PlaybackSourcePicker.js';
import {LoadingState} from '../components/common/LoadingState.js';
import {Modal} from '../components/common/Modal.js';
import {setPreferredSource,getPreferredSource} from '../utils/playbackPreferences.js';
import {useTranslation} from '../stores/useLanguageStore.js';
import {GeniusReleaseSection} from '../components/discovery/GeniusPanels.js';
type ExportResult={id:string;status:string;downloadUrl?:string;prepared?:number;total?:number;delivery?:string;message?:string;unavailable?:Array<{trackId:string;reason:string}>};
/** Secondary release actions behind one "⋯" button, so the header stays calm. */
function ReleaseMore({label,items}:{label:string;items:Array<{icon:React.ReactNode;label:string;onClick?:()=>void;href?:string;disabled?:boolean}>}){
 const [open,setOpen]=React.useState(false),root=React.useRef<HTMLDivElement>(null);
 React.useEffect(()=>{if(!open)return;const close=(e:Event)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};},[open]);
 return <div className="release-more" ref={root}>
  <button className="release-icon" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><MoreHorizontal size={18}/></button>
  {open&&<div className="release-menu" role="menu">{items.map(item=>item.href
   ?<a key={item.label} role="menuitem" href={item.href} target="_blank" rel="noreferrer" onClick={()=>setOpen(false)}>{item.icon}{item.label}</a>
   :<button key={item.label} role="menuitem" disabled={item.disabled} onClick={()=>{setOpen(false);item.onClick?.();}}>{item.icon}{item.label}</button>)}</div>}
 </div>;
}

export function ReleasePage(){
 const {id=''}=useParams(),t=useTranslation(),play=usePlayerStore(s=>s.playCollection),[saved,setSaved]=React.useState(false),[busy,setBusy]=React.useState(false),[source,setSource]=React.useState(()=>getPreferredSource()),[info,setInfo]=React.useState(false),[exportOpen,setExportOpen]=React.useState(false),[job,setJob]=React.useState<ExportResult>(),[error,setError]=React.useState(''),[exporting,setExporting]=React.useState(false);
 const requestId=React.useRef(crypto.randomUUID()),exportLock=React.useRef(false);
 const query=useQuery({queryKey:['release',id],queryFn:()=>apiClient.getRelease(id)});
 React.useEffect(()=>{setSaved(false);setJob(undefined);requestId.current=crypto.randomUUID();setSource(getPreferredSource());},[id]);
 React.useEffect(()=>{if(!job||job.status!=='preparing')return;let active=true,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const next=await apiClient.request<ExportResult>(`/content/exports/${job.id}`);if(active)setJob(next);}catch(e){if(active)setError((e as Error).message);}if(active)timer=setTimeout(()=>void poll(),1800);};timer=setTimeout(()=>void poll(),500);return()=>{active=false;clearTimeout(timer);};},[job?.id,job?.status]);
 if(query.isPending)return <PageSkeleton label={t('Открываем релиз…','Loading release…')}/>;
 if(!query.data)return <div className="frost-panel"><h1>{t('Релиз недоступен','Release unavailable')}</h1><button onClick={()=>query.refetch()}>{t('Повторить','Retry')}</button></div>;
 const r=query.data,tracks=r.tracks||[];
 const type=({single:t('Сингл','Single'),ep:'EP',album:t('Альбом','Album'),compilation:t('Сборник','Compilation'),'maxi-single':t('Макси-сингл','Maxi-single')} as Record<string,string>)[r.type||'']||t('Тип не предоставлен источником','Type not supplied by source');
 const prepare=async()=>{setExportOpen(true);if(job||exportLock.current)return;exportLock.current=true;setExporting(true);setError('');try{setJob(await apiClient.request<ExportResult>(`/content/releases/${encodeURIComponent(id)}/export`,{method:'POST',body:JSON.stringify({requestId:requestId.current,trackIds:tracks.map(x=>x.id),title:r.title,sendTelegram:true})}));}catch(e){setError((e as Error).message);}finally{exportLock.current=false;setExporting(false);}};
 return <div className="page-crystal release-page"><header className="artist-hero frost-panel"><ArtworkImage src={r.artworkUrl} alt={r.title} className="release-cover" zoomable/><div className="artist-intro"><span className="eyebrow">{t('Релиз','Release')}</span><h1>{r.title}</h1>{r.artist&&<Link to={`/artist/${encodeURIComponent(r.artist.id)}`}>{r.artist.name}</Link>}<p className="release-meta">{[r.date?.slice(0,4),r.type?type:undefined,`${tracks.length} ${t((n=>n%10===1&&n%100!==11?'трек':n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)?'трека':'треков')(tracks.length),tracks.length===1?'track':'tracks')}`].filter(Boolean).join(' · ')}</p><div className="release-actions">
<button className="primary-button release-play" disabled={!tracks.length} onClick={()=>play(tracks,0,source)}><Play size={17} fill="currentColor"/>{t('Слушать','Play')}</button>
<button className="release-icon" aria-label={t('Перемешать','Shuffle')} title={t('Перемешать','Shuffle')} disabled={!tracks.length} onClick={()=>{const shuffled=[...tracks];for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}play(shuffled,0,source);}}><Shuffle size={17}/></button>
<button className={`release-icon ${saved?'is-on':''}`} aria-label={saved?t('В коллекции','Saved'):t('В коллекцию','Save to collection')} title={saved?t('В коллекции','Saved'):t('В коллекцию','Save to collection')} aria-pressed={saved} disabled={busy||saved||!tracks.length} onClick={async()=>{setBusy(true);try{const p=await usePlaylistStore.getState().createPlaylist(r.title,'Релиз в коллекции',r.artworkUrl,tracks);setSaved(Boolean(p));}finally{setBusy(false);}}}>{saved?<Check size={17}/>:<Plus size={17}/>}</button>
<span className="release-source"><PlaybackSourcePicker compact value={source} onChange={value=>{setSource(value);tracks.forEach(track=>setPreferredSource(value,track.id));}}/></span>
<ReleaseMore label={t('Ещё','More')} items={[
 {icon:<Info size={16}/>,label:t('Информация о релизе','Release information'),onClick:()=>setInfo(true)},
 {icon:<Download size={16}/>,label:t('Скачать релиз','Download release'),onClick:()=>void prepare(),disabled:!tracks.length||exporting},
 ...(r.url?[{icon:<ArrowUpRight size={16}/>,label:t('Открыть в источнике','Open at source'),href:r.url}]:[]),
]}/>
</div></div></header><GeniusReleaseSection artist={r.artist?.name} title={r.title}/><section className="frost-panel">{tracks.map((track,i)=><TrackRow key={track.id} track={track} index={i} collection={tracks}/>)}</section>
 <Modal isOpen={info} onClose={()=>setInfo(false)} title={t('Информация о релизе','Release information')}><div className="content-form"><h3>{r.title}</h3><p>{type}</p><p>{t('Дата выхода: ','Release date: ')}{r.date||t('Нет данных','No data')}{r.date&&r.date.length<10?` (${t('неполная дата источника','partial date supplied by source')})`:''}</p><p>{r.description||t('Описание Genius: нет данных','Genius description: no data')}</p>{r.description&&<p className="genius-credit">{t('Информация предоставлена сервисом Genius','Information provided by Genius')}</p>}{r.descriptionUrl&&<a href={r.descriptionUrl} target="_blank" rel="noreferrer">Genius ↗</a>}{r.url&&<a href={r.url} target="_blank" rel="noreferrer">{t('Метаданные источника','Source metadata')} ↗</a>}</div></Modal>
 <Modal isOpen={exportOpen} onClose={()=>setExportOpen(false)} title={t('Скачать релиз','Download release')}><div className="content-form">{exporting||job?.status==='preparing'?<LoadingState label={t('Готовим файлы и отправляем в Telegram…','Preparing files and sending to Telegram…')}/>:null}{job&&<p role="status">{t('Подготовлено','Prepared')}: {job.prepared||0}/{job.total||tracks.length} · {job.status}</p>}{job?.message&&<p>{job.message}</p>}{job?.delivery==='unknown'&&<p>{t('Доставка не подтверждена. Проверьте чат бота перед повторной отправкой.','Delivery is unconfirmed. Check the bot chat before sending again.')}</p>}{job?.downloadUrl&&<button className="primary-button" onClick={()=>void contentApi.download(job.downloadUrl!,`${r.title}.zip`).catch(e=>setError(e.message))}><Download size={17}/>{t('Скачать ZIP','Download ZIP')}</button>}{job?.unavailable?.map((item,i)=><p key={i}>{tracks.find(x=>x.id===item.trackId)?.title||item.trackId}: {item.reason}</p>)}{error&&<p role="alert">{error}</p>}{!job&&!exporting&&<button className="secondary-button" onClick={()=>void prepare()}>{t('Повторить','Retry')}</button>}</div></Modal></div>;
}
