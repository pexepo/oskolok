import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {DndContext,closestCenter,KeyboardSensor,PointerSensor,TouchSensor,useSensor,useSensors,type DragEndEvent} from '@dnd-kit/core';
import {arrayMove,SortableContext,rectSortingStrategy,sortableKeyboardCoordinates,useSortable} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';
import {Play,Plus,GripVertical,Trash2,Type,Music2,Disc3,ListMusic,ImagePlus,StickyNote,Search,Check,Crop,ZoomIn,ZoomOut,MoveDiagonal2} from 'lucide-react';
import {formatLayout,parseLayout,type TileLayout} from './showcaseLayout.js';
import {apiClient} from '../../api/apiClient.js';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {usePlaylistStore} from '../../stores/usePlaylistStore.js';
import {useToastStore} from '../../stores/useToastStore.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {Modal} from '../common/Modal.js';
import {ArtworkImage} from '../common/ArtworkImage.js';
import type {Release,Track} from '../../types/index.js';
import './showcase.css';

/** A preset (`s`…`tall`) or a custom span and frame, see showcaseLayout.ts. */
export type ShowcaseSize=string;
export type ShowcaseItem={id:string;kind:'track'|'album'|'playlist'|'image'|'note';size:ShowcaseSize;caption:string;track?:Track;album?:{id:string;title:string;artistName:string;artworkUrl?:string;date?:string};playlist?:{playlistId:string;title:string;artworkUrl?:string;tracks:Track[]};image?:{url:string;mime:string};text?:string};
type NewItem={kind:'track';trackId:string}|{kind:'album';album:NonNullable<ShowcaseItem['album']>}|{kind:'playlist';playlistId:string}|{kind:'image';fileId:string}|{kind:'note';text:string};

const SIZES:Array<[ShowcaseSize,string,string]>=[['s','S','Маленькая'],['m','M','Средняя'],['l','L','Большая'],['wide','▭','Широкая'],['tall','▯','Высокая']];
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);

/** The profile showcase: a grid of tiles the owner sizes, captions and orders by hand. */
export function Showcase({items,editable=false,canPlay=true,onChange}:{items:ShowcaseItem[];editable?:boolean;canPlay?:boolean;onChange?:(items:ShowcaseItem[])=>void}){
  const t=useTranslation(),[editing,setEditing]=useState(false),[adding,setAdding]=useState(false);
  const toast=(message:string)=>useToastStore.getState().addToast(message,'error');
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}),useSensor(TouchSensor,{activationConstraint:{delay:180,tolerance:8}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  const tracks=useMemo(()=>items.flatMap(item=>item.track?[item.track]:[]),[items]);
  const update=async(id:string,patch:Partial<Pick<ShowcaseItem,'size'|'caption'|'text'>>)=>{
    const before=items;onChange?.(items.map(item=>item.id===id?{...item,...patch}:item));
    try{const saved=await apiClient.request<ShowcaseItem>(`/profile/showcase/${id}`,{method:'PATCH',body:JSON.stringify(patch)});onChange?.(before.map(item=>item.id===id?saved:item));}
    catch(e){onChange?.(before);toast(errorText(e));}
  };
  const remove=async(id:string)=>{const before=items;onChange?.(items.filter(item=>item.id!==id));try{await apiClient.request(`/profile/showcase/${id}`,{method:'DELETE'});}catch(e){onChange?.(before);toast(errorText(e));}};
  const dragEnd=async({active,over}:DragEndEvent)=>{
    if(!over||active.id===over.id)return;
    const before=items,next=arrayMove(items,items.findIndex(i=>i.id===active.id),items.findIndex(i=>i.id===over.id));onChange?.(next);
    try{await apiClient.request('/profile/showcase/order',{method:'PUT',body:JSON.stringify({ids:next.map(i=>i.id)})});}catch(e){onChange?.(before);toast(errorText(e));}
  };
  const grid=<div className="showcase-grid" data-editing={editing||undefined}>
    {items.map(item=><ShowcaseTile key={item.id} item={item} editing={editing} canPlay={canPlay} tracks={tracks} onUpdate={patch=>void update(item.id,patch)} onRemove={()=>void remove(item.id)}/>)}
    {editable&&<button type="button" className="showcase-add-tile" onClick={()=>setAdding(true)}><Plus size={22}/><span>{t('Добавить плитку','Add a tile')}</span></button>}
  </div>;
  return <section className="showcase" aria-label={t('Витрина','Showcase')}>
    <header className="showcase-head"><h2>{t('Витрина','Showcase')}</h2>{editable&&items.length>0&&<button type="button" className={`profile-btn${editing?' profile-btn--primary':''}`} onClick={()=>setEditing(v=>!v)} aria-pressed={editing}>{editing?<><Check size={15}/>{t('Готово','Done')}</>:t('Настроить','Arrange')}</button>}</header>
    {editing&&<p className="showcase-hint">{t('Перетаскивайте плитки, меняйте размер и подписи. Всё сохраняется сразу.','Drag tiles, change sizes and captions. Everything saves at once.')}</p>}
    {!items.length&&!editable&&<p className="profile-empty">{t('Витрина пока пустая.','The showcase is empty for now.')}</p>}
    {/* Always mounted: toggling arrange mode must not remount tiles (covers would blink). Tiles opt out via useSortable({disabled}). */}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e=>void dragEnd(e)}><SortableContext items={items.map(i=>i.id)} strategy={rectSortingStrategy}>{grid}</SortableContext></DndContext>
    {editable&&<ShowcaseAddDialog open={adding} onClose={()=>setAdding(false)} existing={items} onAdded={item=>{onChange?.([...items,item]);}}/>}
  </section>;
}

function ShowcaseTile({item,editing,canPlay,tracks,onUpdate,onRemove}:{item:ShowcaseItem;editing:boolean;canPlay:boolean;tracks:Track[];onUpdate:(patch:Partial<Pick<ShowcaseItem,'size'|'caption'|'text'>>)=>void;onRemove:()=>void}){
  const t=useTranslation(),sortable=useSortable({id:item.id,disabled:!editing});
  const [captioning,setCaptioning]=useState(false),[caption,setCaption]=useState(item.caption);
  useEffect(()=>setCaption(item.caption),[item.caption]);
  // Span and picture frame: edited live here, saved when the gesture ends.
  const [layout,setLayout]=useState(()=>parseLayout(item.size)),[framing,setFraming]=useState(false);
  useEffect(()=>setLayout(parseLayout(item.size)),[item.size]);
  useEffect(()=>{if(!editing)setFraming(false);},[editing]);
  const commit=(next:TileLayout)=>{setLayout(next);const size=formatLayout(next);if(size!==item.size)onUpdate({size});};
  const style={transform:CSS.Translate.toString(sortable.transform),transition:sortable.transition,'--w':layout.w,'--h':layout.h,'--fx':`${layout.fx}%`,'--fy':`${layout.fy}%`,'--z':layout.z} as React.CSSProperties;
  const player=usePlayerStore.getState;
  const play=async()=>{
    try{
      if(item.track)await player().playCollection(tracks,Math.max(0,tracks.findIndex(tr=>tr.id===item.track!.id)),undefined,'profile-showcase');
      else if(item.playlist?.tracks.length)await player().playCollection(item.playlist.tracks,0,undefined,'profile-showcase');
      else if(item.album){const release=await apiClient.getRelease(item.album.id);if(release.tracks?.length)await player().playCollection(release.tracks,0,undefined,'profile-showcase');}
    }catch(e){useToastStore.getState().addToast(errorText(e),'error');}
  };
  const cover=item.track?.artworkUrl||item.album?.artworkUrl||item.playlist?.artworkUrl;
  const title=item.track?.title||item.album?.title||item.playlist?.title;
  const subtitle=item.track?.artist.name||item.album?.artistName||(item.playlist?t(`${item.playlist.tracks.length} треков`,`${item.playlist.tracks.length} tracks`):'');
  const playable=canPlay&&!editing&&(!!item.track||!!item.album||!!item.playlist?.tracks.length);
  const KindIcon=item.kind==='album'?Disc3:item.kind==='playlist'?ListMusic:Music2;
  const href=item.album?`/release/${encodeURIComponent(item.album.id)}`:item.track?`/track/${encodeURIComponent(item.track.id)}`:undefined;
  return <article ref={sortable.setNodeRef} style={style} className={`showcase-tile showcase-tile--${item.kind}`} data-size={layout.w===1&&layout.h===1?'s':'x'} data-framing={framing||undefined} data-dragging={sortable.isDragging||undefined}>
    {item.kind==='image'&&item.image&&<img className="showcase-media" src={item.image.url} alt={item.caption||t('Картинка из витрины','Showcase picture')} loading="lazy" decoding="async" draggable={false}/>}
    {cover&&<ArtworkImage src={cover} alt="" className="showcase-media"/>}
    {item.kind==='note'&&<p className="showcase-note">{item.text}</p>}
    {title&&<div className="showcase-bar">
      <span className="showcase-kind" aria-hidden="true"><KindIcon size={13}/></span>
      <span className="showcase-titles">{href&&!editing?<Link to={href} className="showcase-title">{title}</Link>:<strong className="showcase-title">{title}</strong>}{subtitle&&<small>{subtitle}</small>}</span>
      {playable&&<button type="button" className="showcase-play" onClick={()=>void play()} aria-label={t(`Слушать: ${title}`,`Play: ${title}`)}><Play size={16} fill="currentColor"/></button>}
    </div>}
    {(item.caption||captioning)&&<div className={`showcase-caption${title?'':' is-alone'}`}>
      {captioning?<input autoFocus maxLength={200} value={caption} onChange={e=>setCaption(e.target.value)} onBlur={()=>{setCaptioning(false);if(caption.trim()!==item.caption)onUpdate({caption:caption.trim()});}} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();if(e.key==='Escape'){setCaption(item.caption);setCaptioning(false);}}} placeholder={t('Подпись','Caption')} aria-label={t('Подпись к плитке','Tile caption')}/>:<span>{item.caption}</span>}
    </div>}
    {editing&&<div className="showcase-tools" role="toolbar" aria-label={t('Настройка плитки','Tile settings')}>
      <button type="button" className="showcase-tool showcase-grip" {...sortable.attributes} {...sortable.listeners} aria-label={t('Перетащить','Drag')}><GripVertical size={15}/></button>
      {(cover||item.kind==='image')&&<button type="button" className={`showcase-tool${framing?' is-on':''}`} onClick={()=>setFraming(v=>!v)} aria-pressed={framing} aria-label={t('Область изображения','Picture area')} title={t('Область изображения','Picture area')}><Crop size={15}/></button>}
      <button type="button" className="showcase-tool" onClick={()=>setCaptioning(true)} aria-label={t('Подпись','Caption')}><Type size={15}/></button>
      <button type="button" className="showcase-tool is-danger" onClick={onRemove} aria-label={t('Убрать из витрины','Remove from showcase')}><Trash2 size={15}/></button>
    </div>}
    {editing&&framing&&<FrameEditor layout={layout} onChange={setLayout} onCommit={commit} onDone={()=>setFraming(false)}/>}
    {editing&&!framing&&<ResizeHandle layout={layout} onChange={setLayout} onCommit={commit}/>}
  </article>;
}

/** Drag the corner by whole grid cells (1–6 each way); arrow keys do the same. */
function ResizeHandle({layout,onChange,onCommit}:{layout:TileLayout;onChange:(l:TileLayout)=>void;onCommit:(l:TileLayout)=>void}){
  const t=useTranslation(),start=useRef<{x:number;y:number;w:number;h:number;cell:number}|null>(null),last=useRef(layout);
  last.current=layout;
  const down=(e:React.PointerEvent<HTMLButtonElement>)=>{
    const grid=e.currentTarget.closest('.showcase-grid') as HTMLElement|null;if(!grid)return;
    const cs=getComputedStyle(grid),cols=cs.gridTemplateColumns.split(' ').length,gap=parseFloat(cs.columnGap)||0;
    start.current={x:e.clientX,y:e.clientY,w:layout.w,h:layout.h,cell:(grid.clientWidth-gap*(cols-1))/cols+gap};
    e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();
  };
  const move=(e:React.PointerEvent)=>{const s=start.current;if(!s)return;const w=Math.min(6,Math.max(1,s.w+Math.round((e.clientX-s.x)/s.cell))),h=Math.min(6,Math.max(1,s.h+Math.round((e.clientY-s.y)/s.cell)));if(w!==last.current.w||h!==last.current.h)onChange({...last.current,w,h});};
  const up=()=>{if(!start.current)return;start.current=null;onCommit(last.current);};
  const key=(e:React.KeyboardEvent)=>{const d:Record<string,[number,number]>={ArrowRight:[1,0],ArrowLeft:[-1,0],ArrowDown:[0,1],ArrowUp:[0,-1]};const step=d[e.key];if(!step)return;e.preventDefault();onCommit({...layout,w:Math.min(6,Math.max(1,layout.w+step[0])),h:Math.min(6,Math.max(1,layout.h+step[1]))});};
  return <button type="button" className="showcase-resize" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
    aria-label={t(`Размер плитки: ${layout.w} × ${layout.h}. Стрелки меняют ширину и высоту`,`Tile size: ${layout.w} × ${layout.h}. Arrow keys change width and height`)}>
    <MoveDiagonal2 size={14}/><span className="showcase-resize-badge" aria-hidden="true">{layout.w}×{layout.h}</span>
  </button>;
}

/** Pick the visible part of the picture: drag to move it, wheel or the buttons to zoom. */
function FrameEditor({layout,onChange,onCommit,onDone}:{layout:TileLayout;onChange:(l:TileLayout)=>void;onCommit:(l:TileLayout)=>void;onDone:()=>void}){
  const t=useTranslation(),drag=useRef<{x:number;y:number;fx:number;fy:number;w:number;h:number}|null>(null),last=useRef(layout),wheelTimer=useRef(0);
  last.current=layout;
  const clamp=(v:number)=>Math.min(100,Math.max(0,v));
  const zoom=(dz:number,save=true)=>{const next={...last.current,z:Math.min(3,Math.max(1,Math.round((last.current.z+dz)*100)/100))};if(save)onCommit(next);else onChange(next);};
  return <div className="showcase-frame" role="group" aria-label={t('Область изображения','Picture area')}
    onPointerDown={e=>{const r=e.currentTarget.getBoundingClientRect();drag.current={x:e.clientX,y:e.clientY,fx:layout.fx,fy:layout.fy,w:r.width,h:r.height};e.currentTarget.setPointerCapture(e.pointerId);e.stopPropagation();}}
    onPointerMove={e=>{const d=drag.current;if(!d)return;onChange({...last.current,fx:clamp(d.fx-(e.clientX-d.x)/d.w*100/last.current.z),fy:clamp(d.fy-(e.clientY-d.y)/d.h*100/last.current.z)});}}
    onPointerUp={()=>{if(drag.current){drag.current=null;onCommit(last.current);}}} onPointerCancel={()=>{drag.current=null;}}
    onWheel={e=>{zoom(e.deltaY<0?.08:-.08,false);window.clearTimeout(wheelTimer.current);wheelTimer.current=window.setTimeout(()=>onCommit(last.current),400);}}
    onKeyDown={e=>{const d:Record<string,[number,number]>={ArrowRight:[5,0],ArrowLeft:[-5,0],ArrowDown:[0,5],ArrowUp:[0,-5]};const step=d[e.key];if(step){e.preventDefault();onCommit({...layout,fx:clamp(layout.fx+step[0]),fy:clamp(layout.fy+step[1])});}if(e.key==='Escape')onDone();}} tabIndex={0}>
    <span className="showcase-frame-hint">{t('Тяните картинку · колесо — масштаб','Drag the picture · wheel to zoom')}</span>
    <span className="showcase-frame-tools" onPointerDown={e=>e.stopPropagation()}>
      <button type="button" onClick={()=>zoom(-.2)} disabled={layout.z<=1} aria-label={t('Отдалить','Zoom out')}><ZoomOut size={15}/></button>
      <button type="button" onClick={()=>zoom(.2)} disabled={layout.z>=3} aria-label={t('Приблизить','Zoom in')}><ZoomIn size={15}/></button>
      <button type="button" onClick={onDone} aria-label={t('Готово','Done')}><Check size={15}/></button>
    </span>
  </div>;
}

type AddTab='track'|'album'|'playlist'|'image'|'note';
function ShowcaseAddDialog({open,onClose,existing,onAdded}:{open:boolean;onClose:()=>void;existing:ShowcaseItem[];onAdded:(item:ShowcaseItem)=>void}){
  const t=useTranslation(),[tab,setTab]=useState<AddTab>('album'),[size,setSize]=useState<ShowcaseSize>('m'),[caption,setCaption]=useState('');
  const [query,setQuery]=useState(''),[results,setResults]=useState<{tracks:Track[];albums:Release[]}>({tracks:[],albums:[]}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [note,setNote]=useState(''),[upload,setUpload]=useState<{fileId:string;preview:string}>(),fileRef=useRef<HTMLInputElement>(null);
  const playlists=usePlaylistStore(s=>s.playlists),fetchPlaylists=usePlaylistStore(s=>s.fetchPlaylists);
  useEffect(()=>{if(open){void fetchPlaylists();setError('');}else{setQuery('');setResults({tracks:[],albums:[]});setCaption('');setNote('');setUpload(u=>{if(u)URL.revokeObjectURL(u.preview);return undefined;});}},[open]);
  const has=(kind:string,ref:string)=>existing.some(item=>item.kind===kind&&(item.track?.id===ref||item.album?.id===ref||item.playlist?.playlistId===ref));
  const add=async(input:NewItem)=>{
    setBusy(true);setError('');
    try{onAdded(await apiClient.request<ShowcaseItem>('/profile/showcase',{method:'POST',body:JSON.stringify({...input,size,caption:caption.trim()})}));onClose();}
    catch(e){setError(errorText(e));}finally{setBusy(false);}
  };
  const search=async(e:React.FormEvent)=>{e.preventDefault();if(query.trim().length<2)return;setBusy(true);setError('');try{const found=await apiClient.search(query.trim(),1,12);setResults({tracks:found.tracks||[],albums:found.albums||[]});}catch(err){setError(errorText(err));}finally{setBusy(false);}};
  const pick=async(file?:File)=>{
    if(!file)return;setError('');
    if(file.size>8*1024*1024){setError(t('Картинка или GIF — до 8 МБ.','Pictures and GIFs up to 8 MB.'));return;}
    setBusy(true);
    try{const saved=await apiClient.request<{id:string}>('/profile/showcase/media',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});setUpload({fileId:saved.id,preview:URL.createObjectURL(file)});}
    catch(e){setError(errorText(e));}finally{setBusy(false);if(fileRef.current)fileRef.current.value='';}
  };
  const tabs:Array<[AddTab,string,typeof Disc3]>=[['album',t('Альбом','Album'),Disc3],['track',t('Трек','Track'),Music2],['playlist',t('Плейлист','Playlist'),ListMusic],['image',t('Фото · GIF','Photo · GIF'),ImagePlus],['note',t('Заметка','Note'),StickyNote]];
  return <Modal isOpen={open} onClose={onClose} title={t('Новая плитка','New tile')} className="max-w-xl showcase-dialog">
    <div className="showcase-add">
      <nav className="set-segmented showcase-add-tabs" role="tablist">{tabs.map(([id,label,Icon])=><button key={id} type="button" role="tab" aria-selected={tab===id} className={tab===id?'is-active':''} onClick={()=>{setTab(id);setError('');}}><Icon size={14}/>{label}</button>)}</nav>
      {(tab==='track'||tab==='album')&&<>
        <form className="showcase-search" onSubmit={e=>void search(e)}><Search size={16} aria-hidden="true"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==='album'?t('Артист и альбом','Artist and album'):t('Артист и название','Artist and title')} aria-label={t('Поиск','Search')} autoFocus/><button className="profile-btn" disabled={busy||query.trim().length<2}>{t('Найти','Search')}</button></form>
        <div className="showcase-results">
          {tab==='album'&&results.albums.map(album=><button type="button" key={album.id} className="showcase-result" disabled={busy||has('album',album.id)} onClick={()=>void add({kind:'album',album:{id:album.id,title:album.title,artistName:album.artist?.name||'',artworkUrl:album.artworkUrl,date:album.date}})}><ArtworkImage src={album.artworkUrl} alt="" className="showcase-result-art"/><span><strong>{album.title}</strong><small>{[album.artist?.name,album.date?.slice(0,4)].filter(Boolean).join(' · ')}</small></span>{has('album',album.id)?<Check size={16}/>:<Plus size={16}/>}</button>)}
          {tab==='track'&&results.tracks.map(track=><button type="button" key={track.id} className="showcase-result" disabled={busy||has('track',track.id)} onClick={()=>void add({kind:'track',trackId:track.id})}><ArtworkImage src={track.artworkUrl} alt="" className="showcase-result-art"/><span><strong>{track.title}</strong><small>{track.artist.name}</small></span>{has('track',track.id)?<Check size={16}/>:<Plus size={16}/>}</button>)}
          {query&&!busy&&!(tab==='album'?results.albums:results.tracks).length&&<p className="profile-empty">{t('Введите запрос и нажмите «Найти».','Type a query and press Search.')}</p>}
        </div>
      </>}
      {tab==='playlist'&&<div className="showcase-results">{playlists.map(pl=><button type="button" key={pl.id} className="showcase-result" disabled={busy||has('playlist',pl.id)} onClick={()=>void add({kind:'playlist',playlistId:pl.id})}><ArtworkImage src={pl.artworkUrl} alt="" className="showcase-result-art"/><span><strong>{pl.title}</strong><small>{t('станет публичным','becomes public')}</small></span>{has('playlist',pl.id)?<Check size={16}/>:<Plus size={16}/>}</button>)}{!playlists.length&&<p className="profile-empty">{t('В коллекции пока нет плейлистов.','No playlists in your collection yet.')}</p>}</div>}
      {tab==='image'&&<div className="showcase-upload">
        {upload?<img src={upload.preview} alt="" className="showcase-upload-preview"/>:<button type="button" className="showcase-upload-drop" onClick={()=>fileRef.current?.click()} disabled={busy}><ImagePlus size={26}/><strong>{t('Выбрать фото или GIF','Choose a photo or GIF')}</strong><small>PNG, JPEG, WebP, GIF · {t('до 8 МБ','up to 8 MB')}</small></button>}
        <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>void pick(e.target.files?.[0])}/>
      </div>}
      {tab==='note'&&<textarea className="glass-input showcase-note-input" value={note} onChange={e=>setNote(e.target.value)} maxLength={600} rows={4} placeholder={t('Пара слов о себе или о музыке','A few words about you or the music')}/>}
      <label className="showcase-field">{t('Подпись','Caption')}<input value={caption} onChange={e=>setCaption(e.target.value)} maxLength={200} placeholder={t('Необязательно','Optional')}/></label>
      <div className="showcase-field"><span>{t('Размер плитки','Tile size')}</span><span className="showcase-sizes" role="radiogroup">{SIZES.map(([value,label,name])=><button key={value} type="button" role="radio" aria-checked={size===value} className={size===value?'is-on':''} onClick={()=>setSize(value)} title={t(name,value)}>{label}</button>)}</span></div>
      {error&&<p className="lyrics-error" role="alert">{error}</p>}
      {(tab==='image'||tab==='note')&&<button type="button" className="primary-button" disabled={busy||(tab==='image'?!upload:!note.trim())} onClick={()=>void add(tab==='image'?{kind:'image',fileId:upload!.fileId}:{kind:'note',text:note.trim()})}>{t('Добавить в витрину','Add to showcase')}</button>}
    </div>
  </Modal>;
}
