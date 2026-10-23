import React from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Disc3,Play,Trash2,Upload,X} from 'lucide-react';
import {apiClient} from '../api/apiClient.js';
import {communityApi,UNRELEASED_KIND_LABELS,type UnreleasedKind,type UnreleasedSubmission} from '../api/communityClient.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {useToastStore} from '../stores/useToastStore.js';
import {useTranslation} from '../stores/useLanguageStore.js';
import {ArtworkImage} from '../components/common/ArtworkImage.js';
import {LoadingState} from '../components/common/LoadingState.js';
import type {Artist} from '../types/index.js';
import {WipPlaceholder} from '../components/common/WipPlaceholder.js';
import {UNRELEASED_OPEN} from '../config/beta.js';
import '../styles/community.css';

const AUDIO_EXT=/\.(mp3|m4a|ogg|flac)$/i,COVER_EXT=/\.(png|jpe?g|webp)$/i;
const readDuration=(file:File)=>new Promise<number>(resolve=>{const url=URL.createObjectURL(file),audio=new Audio();const done=(v:number)=>{URL.revokeObjectURL(url);resolve(Number.isFinite(v)?Math.round(v):0);};audio.preload='metadata';audio.onloadedmetadata=()=>done(audio.duration);audio.onerror=()=>done(0);setTimeout(()=>done(0),8000);audio.src=url;});
const mb=(bytes:number)=>`${(bytes/1048576).toFixed(1)} МБ`;

function ArtistPicker({name,artistId,onChange}:{name:string;artistId?:string;onChange:(name:string,artistId?:string)=>void}){
 const t=useTranslation(),[focus,setFocus]=React.useState(false),[debounced,setDebounced]=React.useState(name);
 React.useEffect(()=>{const id=setTimeout(()=>setDebounced(name.trim()),300);return()=>clearTimeout(id);},[name]);
 const search=useQuery({queryKey:['unreleased-artist-pick',debounced],queryFn:({signal})=>apiClient.search(debounced,1,8,signal),enabled:focus&&!artistId&&debounced.length>=2,staleTime:60000});
 const artists:Artist[]=search.data?.artists.slice(0,6)||[];
 return <div className="unrel-picker">
  <input className="glass-input" required maxLength={200} value={name} placeholder={t('Начните вводить имя артиста','Start typing the artist name')} onFocus={()=>setFocus(true)} onBlur={()=>setTimeout(()=>setFocus(false),150)} onChange={e=>onChange(e.target.value,undefined)}/>
  {artistId&&<small className="unrel-linked">{t('Связан с карточкой артиста','Linked to artist card')} · <button type="button" className="text-button" onClick={()=>onChange(name,undefined)}>{t('сбросить','reset')}</button></small>}
  {focus&&artists.length>0&&<ul role="listbox">{artists.map(a=><li key={a.id}><button type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(a.name,a.id);setFocus(false);}}>{a.avatarUrl?<img src={a.avatarUrl} alt="" referrerPolicy="no-referrer"/>:<span/>}{a.name}<small>{a.source}</small></button></li>)}</ul>}
 </div>;
}

function SubmitForm({onDone}:{onDone:()=>void}){
 const t=useTranslation(),[params]=useSearchParams();
 const [title,setTitle]=React.useState(''),[artist,setArtist]=React.useState({name:params.get('artist')||'',id:params.get('artistId')||undefined as string|undefined});
 const [kind,setKind]=React.useState<UnreleasedKind>('leak'),[source,setSource]=React.useState(''),[description,setDescription]=React.useState('');
 const [audio,setAudio]=React.useState<{file:File;id?:string;duration:number}|null>(null),[cover,setCover]=React.useState<{file:File;id?:string;preview:string}|null>(null);
 const [busy,setBusy]=React.useState(''),[error,setError]=React.useState('');
 React.useEffect(()=>()=>{if(cover)URL.revokeObjectURL(cover.preview);},[cover]);
 const pickAudio=async(file?:File)=>{setError('');if(!file)return;if(!AUDIO_EXT.test(file.name)){setError(t('Аудио: MP3, M4A, OGG или FLAC.','Audio: MP3, M4A, OGG or FLAC.'));return;}if(file.size>30*1048576){setError(t('Аудио: максимум 30 МБ.','Audio: 30 MB max.'));return;}setAudio({file,duration:await readDuration(file)});if(!title)setTitle(file.name.replace(/\.[^.]+$/,'').replace(/^.*? - /,''));};
 const pickCover=(file?:File)=>{setError('');if(!file)return;if(!COVER_EXT.test(file.name)||file.size>8*1048576){setError(t('Обложка: PNG, JPEG или WebP до 8 МБ.','Cover: PNG, JPEG or WebP up to 8 MB.'));return;}setCover({file,preview:URL.createObjectURL(file)});};
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();if(busy||!audio)return;setError('');
  try{
   setBusy(t('Загружаем аудио…','Uploading audio…'));const audioId=audio.id||(await communityApi.uploadUnreleasedFile(audio.file,'audio')).id;setAudio(a=>a&&{...a,id:audioId});
   let coverId=cover?.id;if(cover&&!coverId){setBusy(t('Загружаем обложку…','Uploading cover…'));coverId=(await communityApi.uploadUnreleasedFile(cover.file,'cover')).id;setCover(c=>c&&{...c,id:coverId});}
   setBusy(t('Отправляем…','Submitting…'));
   await communityApi.submitUnreleased({title:title.trim(),artistName:artist.name.trim(),artistId:artist.id,audioFileId:audioId,coverFileId:coverId,kind,source:source.trim(),description:description.trim(),duration:audio.duration});
   useToastStore.getState().addToast(t('Анрелиз отправлен на проверку','Sent for review'),'success');
   setTitle('');setSource('');setDescription('');setAudio(null);setCover(null);onDone();
  }catch(err){setError(err instanceof Error?err.message:t('Не удалось отправить','Submission failed'));}finally{setBusy('');}
 };
 return <form className="crystal-slab unrel-form" onSubmit={submit}>
  <h2>{t('Предложить анрелиз','Submit an unreleased track')}</h2>
  <p className="unrel-hint">{t('Слив, сниппет или демо, которого нет на площадках. После проверки трек появится на странице артиста и в поиске.','A leak, snippet or demo that is not on streaming services. After review it appears on the artist page and in search.')}</p>
  <fieldset disabled={Boolean(busy)} className="content-form">
   <label className="unrel-drop">{audio?<span><Disc3 size={18}/>{audio.file.name} · {mb(audio.file.size)}{audio.duration?` · ${Math.floor(audio.duration/60)}:${String(audio.duration%60).padStart(2,'0')}`:''}</span>:<span><Upload size={18}/>{t('Аудиофайл: MP3, M4A, OGG, FLAC · до 30 МБ','Audio file: MP3, M4A, OGG, FLAC · up to 30 MB')}</span>}<input type="file" accept=".mp3,.m4a,.ogg,.flac,audio/mpeg,audio/mp4,audio/ogg,audio/flac" onChange={e=>void pickAudio(e.target.files?.[0])}/></label>
   <label>{t('Название','Title')}<input className="glass-input" required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
   <label>{t('Артист','Artist')}<ArtistPicker name={artist.name} artistId={artist.id} onChange={(name,id)=>setArtist({name,id})}/></label>
   <label>{t('Тип','Type')}<select className="glass-input" value={kind} onChange={e=>setKind(e.target.value as UnreleasedKind)}>{(Object.keys(UNRELEASED_KIND_LABELS) as UnreleasedKind[]).map(k=><option key={k} value={k}>{t(...UNRELEASED_KIND_LABELS[k])}</option>)}</select></label>
   <label>{t('Источник','Source')}<input className="glass-input" maxLength={500} value={source} onChange={e=>setSource(e.target.value)} placeholder={t('Где появился: ссылка, канал, эфир…','Where it surfaced: link, channel, stream…')}/></label>
   <label>{t('Описание','Description')}<textarea className="glass-input" rows={3} maxLength={4000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
   <div className="unrel-cover-row">{cover?<><img src={cover.preview} alt=""/><button type="button" className="text-button" onClick={()=>setCover(null)}><X size={14}/>{t('Убрать обложку','Remove cover')}</button></>:<label className="unrel-drop small"><span><Upload size={16}/>{t('Обложка (необязательно)','Cover (optional)')}</span><input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={e=>pickCover(e.target.files?.[0])}/></label>}</div>
   {error&&<p className="form-error" role="alert">{error}</p>}
   <button className="primary-button" disabled={!audio||!title.trim()||!artist.name.trim()||Boolean(busy)}>{busy||t('Отправить на проверку','Submit for review')}</button>
  </fieldset>
 </form>;
}

export function UnreleasedPage(){
 const t=useTranslation(),client=useQueryClient(),play=usePlayerStore(s=>s.playCollection);
 const mine=useQuery({queryKey:['unreleased-mine'],queryFn:communityApi.myUnreleased,enabled:UNRELEASED_OPEN});
 const status=(s:UnreleasedSubmission['status'])=>s==='approved'?t('Одобрено','Approved'):s==='rejected'?t('Отклонено','Rejected'):t('На проверке','Pending');
 const remove=async(s:UnreleasedSubmission)=>{if(!confirm(t(`Удалить «${s.title}»?`,`Delete “${s.title}”?`)))return;try{await communityApi.deleteUnreleased(s.id);void client.invalidateQueries({queryKey:['unreleased-mine']});}catch(e){useToastStore.getState().addToast((e as Error).message,'error');}};
 const rows=mine.data||[],playable=rows.filter(r=>r.status!=='rejected').map(r=>r.track);
 return <div className="unrel-page">
  <div className="collection-heading"><span className="eyebrow">{t('Сообщество','Community')}</span><h1>{t('Анрелизы','Unreleased')}</h1></div>
  {!UNRELEASED_OPEN?<WipPlaceholder title={t('Анрелизы пока на стройке','Unreleased is under construction')} text={t('Сливы, сниппеты и демо скоро можно будет предлагать и слушать здесь.','Soon you will be able to submit and play leaks, snippets and demos here.')}/>:<div className="unrel-layout">
   <SubmitForm onDone={()=>void client.invalidateQueries({queryKey:['unreleased-mine']})}/>
   <section className="crystal-slab unrel-mine">
    <h2>{t('Мои заявки','My submissions')}</h2>
    {mine.isPending?<LoadingState size="md" label={t('Загружаем…','Loading…')}/>:mine.isError?<button className="profile-btn" onClick={()=>void mine.refetch()}>{t('Повторить','Retry')}</button>:rows.length?<ul>{rows.map(s=><li key={s.id} className="unrel-row">
     <button className="unrel-play" disabled={s.status==='rejected'} aria-label={t('Слушать','Play')} onClick={()=>void play(playable,Math.max(0,playable.findIndex(tr=>tr.id===s.track.id)))}><ArtworkImage src={s.track.artworkUrl} alt="" className="w-full h-full"/><Play size={14} fill="currentColor"/></button>
     <span className="unrel-meta"><strong>{s.title}</strong><small>{s.artistId?<Link to={`/artist/${encodeURIComponent(s.artistId)}`}>{s.artistName}</Link>:s.artistName} · {t(...UNRELEASED_KIND_LABELS[s.kind])}</small>{s.reviewNote&&<small className="unrel-note">{s.reviewNote}</small>}</span>
     <span className={`unrel-status is-${s.status}`}>{status(s.status)}</span>
     {s.status!=='approved'&&<button className="icon-button" aria-label={t('Удалить','Delete')} onClick={()=>void remove(s)}><Trash2 size={15}/></button>}
    </li>)}</ul>:<p className="unrel-empty">{t('Вы ещё ничего не отправляли.','You have not submitted anything yet.')}</p>}
   </section>
  </div>}
 </div>;
}
