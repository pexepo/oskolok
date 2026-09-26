import React,{useRef,useState} from 'react';
import {MusicAccounts} from '../components/discovery/MusicAccounts.js';
import {useNavigate} from 'react-router-dom';
import {ArrowDownToLine,Link2,Upload,Check} from 'lucide-react';
import {apiClient} from '../api/apiClient.js';
import {usePlaylistStore} from '../stores/usePlaylistStore.js';
import type {Track,ImportPreview} from '../types/index.js';
import {parseImportList,ImportRow} from '../utils/importList.js';
import {TrackRow} from '../components/tracks/TrackRow.js';
import LumaSpin from '../components/ui/luma-spin.js';

export function ImportPage(){
 const [url,setUrl]=useState(''),[preview,setPreview]=useState<ImportPreview|null>(null),[title,setTitle]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('');
 const [unmatched,setUnmatched]=useState<Array<ImportRow&{candidates:Track[]}>>([]),[selected,setSelected]=useState<Set<string>>(new Set());
 const generation=useRef(0),navigate=useNavigate();
 React.useEffect(()=>()=>{generation.current++;},[]);
 const accept=(data:ImportPreview)=>{setPreview(data);setTitle(data.title);setSelected(new Set(data.tracks.map(t=>t.id)));};
 const load=async()=>{if(busy)return;const id=++generation.current;setBusy(true);setError('');setPreview(null);setUnmatched([]);try{const data=await apiClient.previewImport(url);if(id===generation.current)accept(data);}catch(e){if(id===generation.current)setError((e as Error).message);}finally{if(id===generation.current)setBusy(false);}};
 const file=async(f?:File)=>{
  if(!f||busy)return;const id=++generation.current;setBusy(true);setError('');setPreview(null);setUnmatched([]);
  try{
   if(f.size>1000000)throw new Error('Максимум 1 МБ.');const rows=parseImportList(await f.text());const found:Track[]=[],missing:Array<ImportRow&{candidates:Track[]}>=[];let cursor=0,done=0;
   await Promise.all(Array.from({length:3},async()=>{while(cursor<rows.length&&id===generation.current){const row=rows[cursor++];try{const result=await apiClient.matchImport(row.artist,row.title);if(result.track)found.push(result.track);else missing.push({...row,candidates:result.candidates});}catch{missing.push({...row,candidates:[]});}done++;if(id===generation.current)setProgress(`${done} / ${rows.length}`);}}));
   if(id!==generation.current)return;
   accept({title:f.name.replace(/\.[^.]+$/,''),source:'CSV / TXT',tracks:[...new Map(found.map(t=>[t.id,t])).values()],total:rows.length,warning:'Автоматически выбраны точные совпадения названия и исполнителя. Остальные можно сопоставить вручную ниже.'});setUnmatched(missing);
  }catch(e){if(id===generation.current)setError((e as Error).message);}finally{if(id===generation.current){setBusy(false);setProgress('');}}
 };
 const save=async()=>{if(!preview||busy)return;setBusy(true);setError('');try{const tracks=preview.tracks.filter(t=>selected.has(t.id));const pl=await apiClient.createPlaylist(title.trim(),`Перенесено из ${preview.source}`,preview.artworkUrl||tracks[0]?.artworkUrl,tracks);await usePlaylistStore.getState().fetchPlaylists();navigate(`/playlist/${pl.id}`);}catch(e){setError((e as Error).message);setBusy(false);}};
 return <div className="import-page page-crystal"><header className="page-intro"><span className="eyebrow">ВАША МУЗЫКА, ВМЕСТЕ</span><h1>Принесите свои <em>плейлисты.</em></h1><p>Любимые треки с других площадок — в вашей коллекции Осколка.</p></header>
 <MusicAccounts onImport={data=>{setUnmatched([]);accept(data);}}/><div className="import-options"><section className="frost-panel"><Link2 size={24}/><h2>По ссылке</h2><p>Публичный трек, альбом или плейлист Spotify, SoundCloud, Deezer.</p><form onSubmit={e=>{e.preventDefault();void load();}}><input aria-label="Ссылка для импорта" className="glass-input" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://open.spotify.com/playlist/…" disabled={busy}/><button className="primary-button" disabled={busy||!url.trim()}><ArrowDownToLine size={17}/>Показать треки</button></form></section>
 <section className="frost-panel"><Upload size={24}/><h2>Из файла</h2><p>CSV или TXT из Spotify, Яндекс Музыки и других сервисов. Колонки Artist / Track Name или «Исполнитель — Название».</p><label className="secondary-button">Выбрать список<input type="file" accept=".csv,.txt,.tsv" disabled={busy} onChange={e=>{void file(e.target.files?.[0]);e.target.value='';}}/></label><small>Аккаунт Яндекс Музыки можно подключить выше по коду устройства.</small></section></div>
 {busy&&<p role="status" className="import-status"><LumaSpin size="sm" label="Подготавливаем коллекцию"/> Подготавливаем коллекцию… {progress}</p>}{error&&<p role="alert" className="lyrics-error">{error}</p>}
 {preview&&<section className="frost-panel import-preview"><div className="section-heading"><h2>Проверить и сохранить</h2><span>{selected.size} выбрано / {preview.total??preview.tracks.length} в источнике</span></div>{preview.warning&&<p>{preview.warning}</p>}<label>Название плейлиста<input className="glass-input" value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <div>{preview.tracks.map((t,i)=><div className="import-row" key={t.id}><input aria-label={`Импортировать ${t.title}`} type="checkbox" checked={selected.has(t.id)} onChange={()=>setSelected(old=>{const next=new Set(old);next.has(t.id)?next.delete(t.id):next.add(t.id);return next;})}/><TrackRow track={t} index={i} collection={preview.tracks}/></div>)}</div>
 {!!unmatched.length&&<div className="unmatched"><h3>Нужно проверить · {unmatched.length}</h3>{unmatched.map((row,i)=><div key={`${row.artist}:${row.title}`}><strong>{row.artist} — {row.title}</strong><select aria-label={`Совпадение для ${row.title}`} defaultValue="" onChange={e=>{const track=row.candidates.find(t=>t.id===e.target.value);if(!track)return;setPreview(prev=>prev?{...prev,tracks:[...new Map([...prev.tracks,track].map(t=>[t.id,t])).values()]}:prev);setSelected(prev=>new Set([...prev,track.id]));setUnmatched(prev=>prev.filter((_,idx)=>idx!==i));}}><option value="">Пропустить · {row.candidates.length?'выберите соответствие':'не найдено'}</option>{row.candidates.map(t=><option value={t.id} key={t.id}>{t.artist.name} — {t.title}</option>)}</select></div>)}</div>}
 <button className="primary-button" disabled={busy||!selected.size||!title.trim()} onClick={save}><Check size={17}/>Сохранить {selected.size} треков в коллекцию</button></section>}
 </div>;
}
