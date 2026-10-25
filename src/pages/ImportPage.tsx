import React,{useRef,useState} from 'react';
import {EXPORTIFY_URL} from '../components/discovery/MusicAccounts.js';
import {TransferGuide,TransferServiceTabs,type TransferService} from '../components/discovery/TransferGuide.js';
import {Navigate,useNavigate} from 'react-router-dom';
import {ArrowDownToLine,Link2,Upload,Check,ExternalLink} from 'lucide-react';
import {apiClient} from '../api/apiClient.js';
import {usePlaylistStore} from '../stores/usePlaylistStore.js';
import type {Track,ImportPreview} from '../types/index.js';
import {parseImportList,ImportRow} from '../utils/importList.js';
import {TrackRow} from '../components/tracks/TrackRow.js';
import LumaSpin from '../components/ui/luma-spin.js';
import {WipPlaceholder} from '../components/common/WipPlaceholder.js';
import {ArtworkImage} from '../components/common/ArtworkImage.js';
import {useToastStore} from '../stores/useToastStore.js';
import {useTranslation} from '../stores/useLanguageStore.js';

/** Music transfer now lives in the profile; old links land there. */
export function ImportPage(){return <Navigate to="/profile?tab=import" replace/>;}

export function MusicTransfer(){
 const t=useTranslation();
 const [url,setUrl]=useState(''),[preview,setPreview]=useState<ImportPreview|null>(null),[title,setTitle]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('');
 const [unmatched,setUnmatched]=useState<Array<ImportRow&{candidates:Track[]}>>([]),[selected,setSelected]=useState<Set<string>>(new Set());
 const [expanded,setExpanded]=useState(false),[visible,setVisible]=useState(50),[bulkNote,setBulkNote]=useState('');
 const [service,setService]=useState<TransferService>('spotify');
 // Before confirming: name, cover and visibility of the new Осколок playlist. Private unless chosen otherwise.
 const [cover,setCover]=useState(''),[isPublic,setIsPublic]=useState(false),[partialOk,setPartialOk]=useState(false),[duplicates,setDuplicates]=useState(0);
 const requestId=useRef(crypto.randomUUID()),stopSaving=useRef(false);
 const generation=useRef(0),navigate=useNavigate(),linkInput=useRef<HTMLInputElement>(null),previewRef=useRef<HTMLElement>(null);
 React.useEffect(()=>()=>{generation.current++;},[]);
 const accept=(data:ImportPreview,dupes=0)=>{requestId.current=crypto.randomUUID();setCover(data.artworkUrl||data.tracks[0]?.artworkUrl||'');setIsPublic(false);setPartialOk(false);setDuplicates(dupes);setPreview(data);setExpanded(false);setVisible(50);setTitle(data.title);setSelected(new Set(data.tracks.map(t=>t.id)));requestAnimationFrame(()=>previewRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));};
 const load=async()=>{if(busy)return;const id=++generation.current;setBusy(true);setError('');setBulkNote('');setPreview(null);setUnmatched([]);try{const data=await apiClient.previewImport(url);if(id===generation.current)accept(data);}catch(e){if(id===generation.current)setError((e as Error).message);}finally{if(id===generation.current)setBusy(false);}};
 const file=async(f?:File)=>{
  if(!f||busy)return;const id=++generation.current;setBusy(true);setError('');setBulkNote('');setPreview(null);setUnmatched([]);
  try{
   if(f.size>8000000)throw new Error(t('Максимум 8 МБ.','8 MB max.'));const rows=parseImportList(await f.text());const found:Track[]=[],missing:Array<ImportRow&{candidates:Track[]}>=[];let cursor=0,done=0;
   await Promise.all(Array.from({length:Math.min(5,rows.length)},async()=>{while(cursor<rows.length&&id===generation.current){const row=rows[cursor++];try{const result=await apiClient.matchImport(row.artist,row.title);if(result.track)found.push(result.track);else missing.push({...row,candidates:result.candidates});}catch{missing.push({...row,candidates:[]});}done++;if(id===generation.current)setProgress(`${done} / ${rows.length}`);}}));
   if(id!==generation.current)return;
   const unique=[...new Map(found.map(t=>[t.id,t])).values()];
   accept({title:f.name.replace(/\.[^.]+$/,''),source:'CSV / TXT',tracks:unique,total:rows.length,warning:t('Автоматически выбраны точные совпадения названия и исполнителя. Остальные можно сопоставить вручную ниже.','Exact title and artist matches are selected. Match the rest manually below.')});setUnmatched(missing);setDuplicates(found.length-unique.length);
  }catch(e){if(id===generation.current)setError((e as Error).message);}finally{if(id===generation.current){setBusy(false);setProgress('');}}
 };
 // Created once per confirmation (the request id makes a repeat or a network retry return the same playlist);
 // big lists go in chunks of 300, each applied once. «Остановить» keeps what was already created.
 const saving=useRef(false);
 const save=async()=>{if(!preview||busy||saving.current)return;const tracks=preview.tracks.filter(t=>selected.has(t.id));
  if(tracks.length<(preview.total??preview.tracks.length)&&!partialOk){setError(t('Отметьте, что согласны создать плейлист без части треков.','Confirm that the playlist may be created without some tracks.'));return;}
  setBusy(true);setError('');stopSaving.current=false;saving.current=true;
  try{
   const PART=300;
   const created=await apiClient.request<{playlist:{id:string};chunks:number}>('/playlist-imports',{method:'POST',body:JSON.stringify({requestId:requestId.current,title:title.trim(),description:t(`Перенесено из ${preview.source}`,`Imported from ${preview.source}`),isPublic,artworkUrl:cover||undefined,tracks:tracks.slice(0,PART)})});
   for(let index=Math.max(1,created.chunks);index*PART<tracks.length;index++){
    if(stopSaving.current){setError(t('Перенос остановлен: плейлист создан с уже добавленными треками.','Import stopped: the playlist keeps the tracks added so far.'));break;}
    setProgress(`${Math.min(index*PART,tracks.length)} / ${tracks.length}`);
    await apiClient.request(`/playlist-imports/${requestId.current}/chunks`,{method:'POST',body:JSON.stringify({index,tracks:tracks.slice(index*PART,(index+1)*PART)})});
   }
   setProgress('');await usePlaylistStore.getState().fetchPlaylists();navigate(`/playlist/${created.playlist.id}`);
  }catch(e){setError(`${(e as Error).message} ${t('Нажмите «Создать» ещё раз — повтор не создаст копию.','Press «Create» again — a retry will not make a copy.')}`);setBusy(false);setProgress('');}finally{saving.current=false;}};
 // Everything the exact match missed, in one decision: take the closest candidates, or leave them out.
 const takeClosest=()=>{
  const picked=unmatched.map(row=>row.candidates[0]).filter((c):c is Track=>!!c);
  setPreview(prev=>prev?{...prev,tracks:[...new Map([...prev.tracks,...picked].map(c=>[c.id,c])).values()]}:prev);
  setSelected(prev=>new Set([...prev,...picked.map(c=>c.id)]));
  const left=unmatched.filter(row=>!row.candidates.length);
  setUnmatched(left);
  setBulkNote(left.length?t(`Добавлено с низкой точностью: ${picked.length}. Совсем не нашли: ${left.length} — они не будут добавлены.`,`Added with low accuracy: ${picked.length}. Not found at all: ${left.length} — they will be left out.`):t(`Добавлено с низкой точностью: ${picked.length}. Проверьте их в списке треков.`,`Added with low accuracy: ${picked.length}. Check them in the track list.`));
 };
 const skipUnmatched=()=>{setBulkNote(t(`Не добавляем ${unmatched.length} ненайденных треков.`,`Leaving out ${unmatched.length} unmatched tracks.`));setUnmatched([]);};
 const focusLink=()=>{linkInput.current?.focus();linkInput.current?.scrollIntoView({behavior:'smooth',block:'center'});};
 return <div className="music-transfer">
  <TransferServiceTabs value={service} onChange={setService}/>
  {service==='yandex'?<WipPlaceholder title={t('Перенос из Яндекс Музыки на стройке','Yandex Music transfer is under construction')} text={t('Пока можно перенести из Spotify, SoundCloud или файлом CSV / TXT.','For now you can move music from Spotify, SoundCloud or a CSV / TXT file.')}/>:<>
  <TransferGuide key={service} service={service}/>

  <section className="transfer-link crystal-slab">
   <div className="transfer-link-copy"><Link2 size={20}/><div><h2>{t('По ссылке','By link')}</h2><p>{t('Плейлист, альбом или трек из Spotify и SoundCloud, или профиль SoundCloud целиком — его лайки. Без входа.','A Spotify or SoundCloud playlist, album or track, or a whole SoundCloud profile — its likes. No sign-in.')}</p></div></div>
   <form onSubmit={e=>{e.preventDefault();void load();}}>
    <input ref={linkInput} aria-label={t('Ссылка для импорта','Import link')} value={url} onChange={e=>setUrl(e.target.value)} placeholder={service==='soundcloud'?'https://soundcloud.com/…':'https://open.spotify.com/playlist/…'} disabled={busy}/>
    <button className="transfer-go" disabled={busy||!url.trim()}><ArrowDownToLine size={17}/>{t('Показать треки','Show tracks')}</button>
   </form>
  </section>

  <section className="transfer-file crystal-slab">
   <Upload size={20}/>
   <div><h2>{t('Из файла','From a file')}</h2><p>{t('CSV или TXT: колонки Artist / Track Name или строки «Исполнитель — Название». Для Spotify удобно выгрузить через','CSV or TXT with Artist / Track Name columns or "Artist — Title" lines. For Spotify, export with')} <a href={EXPORTIFY_URL} target="_blank" rel="noopener noreferrer">Exportify <ExternalLink size={11}/></a></p></div>
   <label className="transfer-pick">{t('Выбрать файл','Choose file')}<input type="file" accept=".csv,.txt,.tsv" disabled={busy} onChange={e=>{void file(e.target.files?.[0]);e.target.value='';}}/></label>
  </section>
  </>}

  {busy&&<p role="status" className="import-status"><LumaSpin size="sm" label={t('Подготавливаем коллекцию','Preparing')}/> {t('Подготавливаем коллекцию…','Preparing your collection…')} {progress}</p>}{error&&<p role="alert" className="transfer-error">{error}</p>}
  {preview&&<section ref={previewRef} className="crystal-slab import-preview"><div className="section-heading"><h2>{t('Проверить и сохранить','Review and save')}</h2><span>{selected.size} {t('выбрано','selected')} / {preview.total??preview.tracks.length} {t('в источнике','in source')}</span></div>{preview.warning&&<p className="import-warning">{preview.warning}</p>}
   {!!unmatched.length&&<div className="import-bulk" role="group" aria-label={t('Ненайденные треки','Unmatched tracks')}>
    <p><strong>{t(`Мы не смогли найти точные релизы для ${unmatched.length} ${unmatched.length===1?'трека':'треков'}.`,`We couldn't find exact releases for ${unmatched.length} tracks.`)}</strong> {t('Что сделать со всеми?','What to do with all of them?')}</p>
    <div><button type="button" className="primary-button" disabled={busy} onClick={takeClosest}>{t('Постараться найти · низкая точность','Try to find · low accuracy')}</button><button type="button" className="secondary-button" disabled={busy} onClick={skipUnmatched}>{t('Не добавлять','Leave them out')}</button><button type="button" className="text-button" onClick={()=>setExpanded(true)}>{t('Выбрать вручную','Pick by hand')}</button></div>
   </div>}
   {bulkNote&&<p role="status" className="import-warning">{bulkNote}</p>}<ImportDetails t={t} preview={preview} title={title} setTitle={setTitle} cover={cover} setCover={setCover} isPublic={isPublic} setIsPublic={setIsPublic} selected={selected.size} unmatched={unmatched.length} duplicates={duplicates} partialOk={partialOk} setPartialOk={setPartialOk} busy={busy}/>
   <div className="import-actions"><button className="primary-button" disabled={busy||!selected.size||!title.trim()} onClick={save}><Check size={17}/>{t('Создать плейлист','Create playlist')} · {selected.size}</button>{busy&&progress&&<button type="button" className="secondary-button" onClick={()=>{stopSaving.current=true;}}>{t('Остановить','Stop')}</button>}</div><button className="secondary-button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?t("Свернуть список","Collapse tracks"):t("Проверить треки","Review tracks")} · {preview.tracks.length+unmatched.length}</button>
   {expanded&&<div>{preview.tracks.slice(0,visible).map((tr,i)=><div className="import-row" key={tr.id}><input aria-label={`${t('Импортировать','Import')} ${tr.title}`} type="checkbox" checked={selected.has(tr.id)} onChange={()=>setSelected(old=>{const next=new Set(old);next.has(tr.id)?next.delete(tr.id):next.add(tr.id);return next;})}/><TrackRow track={tr} index={i} collection={preview.tracks}/></div>)}{visible<preview.tracks.length&&<button className="secondary-button" onClick={()=>setVisible(v=>v+50)}>{t("Показать ещё 50","Show 50 more")}</button>}</div>}
   {expanded&&!!unmatched.length&&<div className="unmatched"><h3>{t('Нужно проверить','Needs review')} · {unmatched.length}</h3>{unmatched.slice(0,visible).map((row,i)=><div key={`${row.artist}:${row.title}`}><strong>{row.artist} — {row.title}</strong><select aria-label={`${t('Совпадение для','Match for')} ${row.title}`} defaultValue="" onChange={e=>{const track=row.candidates.find(c=>c.id===e.target.value);if(!track)return;setPreview(prev=>prev?{...prev,tracks:[...new Map([...prev.tracks,track].map(c=>[c.id,c])).values()]}:prev);setSelected(prev=>new Set([...prev,track.id]));setUnmatched(prev=>prev.filter((_,idx)=>idx!==i));}}><option value="">{t('Пропустить','Skip')} · {row.candidates.length?t('выберите соответствие','pick a match'):t('не найдено','not found')}</option>{row.candidates.map(c=><option value={c.id} key={c.id}>{c.artist.name} — {c.title}</option>)}</select></div>)}{visible<unmatched.length&&<button className="secondary-button" onClick={()=>setVisible(v=>v+50)}>{t("Показать ещё 50","Show 50 more")}</button>}</div>}
   <button className="primary-button" disabled={busy||!selected.size||!title.trim()} onClick={save}><Check size={17}/>{t('Создать плейлист','Create playlist')} · {selected.size}</button></section>}
 </div>;
}

/** Name, cover and visibility of the playlist to be created, plus what will and won't be imported. */
function ImportDetails({t,preview,title,setTitle,cover,setCover,isPublic,setIsPublic,selected,unmatched,duplicates,partialOk,setPartialOk,busy}:{t:(ru:string,en:string)=>string;preview:ImportPreview;title:string;setTitle:(v:string)=>void;cover:string;setCover:(v:string)=>void;isPublic:boolean;setIsPublic:(v:boolean)=>void;selected:number;unmatched:number;duplicates:number;partialOk:boolean;setPartialOk:(v:boolean)=>void;busy:boolean}){
 const total=preview.total??preview.tracks.length,missing=Math.max(0,total-selected);
 const covers=[...new Set([preview.artworkUrl,...preview.tracks.slice(0,12).map(tr=>tr.artworkUrl)].filter((u):u is string=>!!u))].slice(0,4);
 const pick=(file?:File)=>{if(!file)return;if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>1_000_000){useToastStore.getState().addToast(t('Обложка: PNG, JPEG или WebP до 1 МБ.','Cover: PNG, JPEG or WebP up to 1 MB.'),'warning');return;}const reader=new FileReader();reader.onload=()=>setCover(String(reader.result));reader.readAsDataURL(file);};
 return <div className="import-details">
  <div className="import-cover"><ArtworkImage src={cover||undefined} alt={t('Обложка плейлиста','Playlist cover')} className="import-cover-main"/>
   <div className="import-cover-options" role="radiogroup" aria-label={t('Обложка','Cover')}>{covers.map(url=><button type="button" key={url} role="radio" aria-checked={cover===url} className={cover===url?'is-active':''} onClick={()=>setCover(url)} disabled={busy}><ArtworkImage src={url} alt="" className="w-11 h-11 rounded-lg"/></button>)}
    <label className="import-cover-upload">{t('Своя','Upload')}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{pick(e.target.files?.[0]);e.target.value='';}}/></label></div></div>
  <div className="import-meta">
   <span className="eyebrow">{t('Новый плейлист в Осколке','New Oskolok playlist')} · {preview.source}</span>
   <label className="import-title">{t('Название','Name')}<input className="glass-input" value={title} maxLength={200} onChange={e=>setTitle(e.target.value)} disabled={busy}/></label>
   <div className="import-visibility" role="radiogroup" aria-label={t('Видимость','Visibility')}>
    <button type="button" role="radio" aria-checked={!isPublic} className={!isPublic?'is-active':''} onClick={()=>setIsPublic(false)} disabled={busy}>{t('Приватный','Private')}<small>{t('Видите только вы','Only you')}</small></button>
    <button type="button" role="radio" aria-checked={isPublic} className={isPublic?'is-active':''} onClick={()=>setIsPublic(true)} disabled={busy}>{t('Публичный','Public')}<small>{t('Доступен по ссылке','Anyone with the link')}</small></button>
   </div>
   <p className="import-summary">{t(`В источнике ${total} · найдено и выбрано ${selected}`,`${total} in the source · ${selected} found and selected`)}{unmatched?t(` · не найдено ${unmatched}`,` · ${unmatched} not found`):''}{duplicates?t(` · повторов ${duplicates} (в плейлисте Осколка каждый трек хранится один раз)`,` · ${duplicates} repeats (an Oskolok playlist keeps each track once)`):''}</p>
   {missing>0&&<label className="import-partial"><input type="checkbox" checked={partialOk} onChange={e=>setPartialOk(e.target.checked)} disabled={busy}/>{t(`Создать без ${missing} недостающих треков`,`Create without the ${missing} missing tracks`)}</label>}
  </div>
 </div>;
}
