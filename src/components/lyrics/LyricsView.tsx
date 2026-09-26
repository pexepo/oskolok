import { scopedStorageKey } from '../../telegram/runtime.js';
import React, {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import { Upload, Download, Minus, Plus, Crosshair, Pencil, Undo2, X } from 'lucide-react';
import type { LyricLine, LyricsAuthor, LyricsData } from '../../types/index.js';
import { apiClient } from '../../api/apiClient.js';
import { parseLrc, parseLyricsFile, normalizeLyricTimings, getActiveLyricIndex } from '../../utils/lyricsParser.js';
import { readLocalLyrics, saveLocalLyrics, deleteLocalLyrics } from '../../utils/lyricsStorage.js';
import { audioManager } from '../../audio/AudioManager.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { LyricsLine } from './LyricsLine.js';
import { AuthorCard } from '../profile/AuthorCard.js';
import { paintTimedLine } from '../../utils/lyricMotion.js';
import {LoadingState} from '../common/LoadingState.js';

interface Props {trackId:string;trackName?:string;artistName?:string;duration?:number;currentTime:number;onSeek:(time:number)=>void}
export const LyricsView=React.memo(function LyricsView({trackId,trackName,artistName,duration,currentTime,onSeek}:Props){
  const [raw,setRaw]=useState<LyricLine[]>([]),[plain,setPlain]=useState(''),[provider,setProvider]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [author,setAuthor]=useState<LyricsAuthor|null>(null);
  const [attribution,setAttribution]=useState<LyricsData['attribution']>();
  const [viaSpicy,setViaSpicy]=useState(false);
  const [offset,setOffset]=useState(0),[follow,setFollow]=useState(true),[reload,setReload]=useState(0);
  const [editor,setEditor]=useState(false),[draft,setDraft]=useState(''),[stamps,setStamps]=useState<number[]>([]),[recording,setRecording]=useState(false);
  const [clock,setClock]=useState(currentTime);
  const playing=usePlayerStore(s=>s.isPlaying),buffering=usePlayerStore(s=>s.isBuffering);
  const fileRef=useRef<HTMLInputElement>(null),containerRef=useRef<HTMLDivElement>(null),activeRef=useRef<HTMLDivElement>(null),generation=useRef(0);
  useEffect(()=>{
    const id=++generation.current;setRaw([]);setPlain('');setProvider('');setAuthor(null);setAttribution(undefined);setViaSpicy(false);setLoading(true);setError('');setEditor(false);setRecording(false);setStamps([]);setFollow(true);
    try{setOffset(Number(localStorage.getItem(scopedStorageKey(`interference-offset:${trackId}`)))||0);}catch{setOffset(0);}
    (async()=>{
      const local=await readLocalLyrics(trackId).catch(()=>undefined);
      if(id!==generation.current)return;
      if(local?.length){setRaw(local);setProvider('Ваш файл');setLoading(false);return;}
      try{
        const data=await apiClient.getLyrics(trackId,trackName,artistName,duration);
        if(id!==generation.current)return;
        setRaw(data?.syncedLyrics||parseLrc(data?.plainLyrics||''));setPlain(data?.plainLyrics||'');setProvider(data?.provider||'');setAuthor(data?.author||null);setAttribution(data?.attribution);setViaSpicy(data?.apiSource==='spicy_lyrics');
      }catch{if(id===generation.current)setError('Не удалось найти текст. Можно загрузить свой файл.');}
      finally{if(id===generation.current)setLoading(false);}
    })();
    return()=>{generation.current++;};
  },[trackId,trackName,artistName,reload]);
  const lines=useMemo(()=>{
    const normalized=normalizeLyricTimings(raw,duration);
    return normalized.flatMap(line=>[line,...(line.background||[]).map(bg=>({...bg,role:'background' as const}))]).sort((a,b)=>a.time-b.time);
  },[raw,duration]);
  const boundaries=useMemo(()=>[...new Set(lines.flatMap(line=>[line.time,line.end]))].sort((a,b)=>a-b),[lines]);
  useEffect(()=>{
    const root=containerRef.current;
    if(!root||typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
      (entry.target as HTMLElement).dataset.visible=entry.isIntersecting?'true':'false';
    }),{root,rootMargin:'12% 0px'});
    root.querySelectorAll('.lyric-slot').forEach(slot=>observer.observe(slot));
    return()=>observer.disconnect();
  },[lines,editor]);
  useEffect(()=>{
    let frame=0,settleFrame=0,previous=-2;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const paint=(time:number)=>containerRef.current?.querySelectorAll<HTMLElement>('.lyric-slot[data-active="true"]:not([data-visible="false"])').forEach(slot=>paintTimedLine(slot,time,reduced));
    const update=(position=audioManager.getCurrentTime(),force=false)=>{const time=position+offset;let lo=0,hi=boundaries.length;while(lo<hi){const middle=(lo+hi)>>>1;if(boundaries[middle]<=time)lo=middle+1;else hi=middle;}if(force||lo!==previous){previous=lo;setClock(position);}paint(time);};
    const tick=()=>{update();frame=requestAnimationFrame(tick);};
    const start=()=>{cancelAnimationFrame(frame);if(playing&&!buffering&&!document.hidden)frame=requestAnimationFrame(tick);};
    const visibility=()=>{cancelAnimationFrame(frame);update(audioManager.getCurrentTime(),true);start();};
    update(audioManager.getCurrentTime(),true);start();
    document.addEventListener('visibilitychange',visibility);
    const unsubscribe=audioManager.subscribe({onTimeUpdate:(position)=>{if(!playing||buffering)update(position,true);},onSeek:(position)=>{update(position,true);cancelAnimationFrame(settleFrame);settleFrame=requestAnimationFrame(()=>update(position));}});
    return()=>{cancelAnimationFrame(frame);cancelAnimationFrame(settleFrame);document.removeEventListener('visibilitychange',visibility);unsubscribe();};
  },[boundaries,offset,playing,buffering]);
  const seekLine=useCallback((t:number)=>{onSeek(Math.max(0,t-offset));setFollow(true);},[onSeek,offset]);
  const time=clock+offset,active=getActiveLyricIndex(lines,time);
  useEffect(()=>{
    if(!follow||!activeRef.current||!containerRef.current)return;
    const el=activeRef.current,container=containerRef.current;
    container.scrollTo({top:Math.max(0,el.offsetTop-container.clientHeight/2+el.clientHeight/2),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  },[active,follow,editor]);
  useEffect(()=>{
    const container=containerRef.current;
    if(!follow||!container||editor)return;
    let frame=0,disposed=false;
    const center=()=>{
      if(disposed)return;
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const el=activeRef.current;
        if(el)container.scrollTo({top:Math.max(0,el.offsetTop-container.clientHeight/2+el.clientHeight/2),behavior:'auto'});
      });
    };
    const observer=new ResizeObserver(center);
    observer.observe(container);center();
    void document.fonts?.ready.then(center);
    return()=>{disposed=true;observer.disconnect();cancelAnimationFrame(frame);};
  },[follow,editor,lines]);
  const commit=async(next:LyricLine[])=>{
    const id=trackId,request=++generation.current;
    try{await saveLocalLyrics(id,next);if(generation.current!==request)return;setRaw(next);setPlain('');setProvider('Ваш файл');setAuthor(null);setAttribution(undefined);setViaSpicy(false);setLoading(false);setError('');setEditor(false);setRecording(false);}
    catch{if(generation.current===request)setError('Не удалось сохранить файл на этом устройстве.');}
  };
  const upload=async(file?:File)=>{
    if(!file)return;
    const id=generation.current;
    try{if(file.size>1000000)throw new Error('Максимальный размер файла — 1 МБ.');const text=await file.text();if(id!==generation.current)return;await commit(parseLyricsFile(text,file.name));}
    catch(e){setError(e instanceof Error?e.message:'Не удалось прочитать файл.');}
    finally{if(fileRef.current)fileRef.current.value='';}
  };
  const shift=(change:number)=>{const next=Math.round(Math.max(-10,Math.min(10,offset+change))*10)/10;setOffset(next);try{localStorage.setItem(scopedStorageKey(`interference-offset:${trackId}`),String(next));}catch{}};
  const exportFile=()=>{const blob=new Blob([JSON.stringify({version:1,trackId,lines:raw},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${(trackName||'interference').replace(/[^\p{L}\p{N} -]/gu,'')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const tokens=useMemo(()=>draft.split('\n').flatMap((line,lineIndex)=>(line.match(/\S+/g)||[]).map(text=>({text,lineIndex}))),[draft]);
  const stampWord=()=>{
    const now=audioManager.getCurrentTime();
    if(!playing){setError('Сначала включите трек, затем отмечайте слова.');return;}
    if(stamps.length&&now<=stamps.at(-1)!){setError('Время должно идти вперёд. Отмените последнюю отметку или начните заново.');return;}
    if(stamps.length<tokens.length){setStamps([...stamps,now]);setError('');return;}
    const next:LyricLine[]=[];
    tokens.forEach((token,i)=>{const word={text:token.text,start:stamps[i],end:stamps[i+1]??now};let line=next.at(-1);if(!i||token.lineIndex!==tokens[i-1].lineIndex){line={time:word.start,text:token.text,words:[],end:word.end};next.push(line);}else{line!.text+=' '+token.text;}line!.words!.push(word);line!.end=word.end;});
    void commit(next);
  };
  const timingLabel=lines.some(line=>line.timingMode==='syllable')?'по словам и слогам':lines.length?'по строкам':plain?'без синхронизации':'';
  return <section className="interference-lyrics">
    <div className="lyrics-toolbar"><div>{provider&&<span className="eyebrow">{provider}</span>}{timingLabel&&<p>{timingLabel}</p>}</div>
      <div className="lyrics-tools"><button onClick={()=>fileRef.current?.click()} title="Загрузить текст" aria-label="Загрузить текст"><Upload size={16}/></button><button onClick={()=>{setDraft(raw.map(l=>l.text).join('\n')||plain);setEditor(true);setRecording(false);setStamps([]);}} title="Разметить слова" aria-label="Разметить слова"><Pencil size={16}/></button>{raw.length>0&&<button onClick={exportFile} title="Скачать разметку" aria-label="Скачать разметку"><Download size={16}/></button>}
      {provider==='Ваш файл'&&<button title="Вернуть текст из каталога" aria-label="Вернуть текст из каталога" onClick={async()=>{await deleteLocalLyrics(trackId).catch(()=>setError('Не удалось удалить локальную версию.'));setReload(v=>v+1);}}><Undo2 size={16}/></button>}</div>
      <input ref={fileRef} className="sr-only" type="file" accept=".lrc,.ttml,.xml,.json" onChange={e=>upload(e.target.files?.[0])}/>
    </div>
    {error&&<p className="lyrics-error" role="alert">{error}</p>}
    {editor ? <div className="lyrics-editor"><div className="section-heading"><h3>Своё исполнение</h3><button onClick={()=>{setEditor(false);setRecording(false);}} aria-label="Закрыть редактор"><X size={18}/></button></div>
      <p>Вставьте текст. Включите трек и отмечайте начало каждого слова кнопкой. После последнего слова отметьте окончание.</p>
      {!recording?<><textarea className="glass-input" value={draft} maxLength={20000} onChange={e=>setDraft(e.target.value)} rows={7} placeholder="Каждая строка — новая фраза"/><button className="primary-button" disabled={!tokens.length} onClick={()=>{setRecording(true);setStamps([]);}}>Разметить {tokens.length} слов</button></>:<><span className="eyebrow">{stamps.length} / {tokens.length}</span><h3 className="record-word">{tokens[stamps.length]?.text||'Окончание'}</h3><button className="primary-button" onClick={stampWord}>{stamps.length<tokens.length?'Слово начинается сейчас':'Закончить и сохранить'}</button><button className="text-button" onClick={()=>setStamps(stamps.slice(0,-1))}>Отменить последнюю отметку</button></>}
      <small>Файл сохраняется на этом устройстве. Скачайте JSON, чтобы поделиться разметкой.</small>
    </div> : <div ref={containerRef} className={`lyrics-scroll ${follow?'':'is-manual'}`} onWheel={()=>setFollow(false)} onTouchMove={()=>setFollow(false)}>
      {loading&&!lines.length?<LoadingState size="md" label="Ищем слова…"/>:lines.length?lines.map((line,i)=>{const singing=time>=line.time&&time<line.end,sung=time>=line.end;return <div className="lyric-slot" data-active={singing?'true':'false'} data-start={line.time} data-end={line.end} data-line-index={i} key={`${line.time}:${i}`} ref={i===active?activeRef:undefined}><LyricsLine line={line} isActive={singing} isSung={sung} currentTime={time} focusDistance={Math.abs(i-active)} onSeek={seekLine}/></div>}):plain?<div className="plain-lyrics">{plain}</div>:<div className="lyrics-empty"><h3>Добавьте текст</h3><p>Загрузите файл с временными метками или создайте разметку по словам.</p><button className="primary-button" onClick={()=>fileRef.current?.click()}><Upload size={16}/> Загрузить файл</button></div>}
    </div>}
    {!editor&&(author?<div className="lyrics-attribution"><AuthorCard author={author}/></div>:provider&&provider!=='none'?<div className="lyrics-attribution lyrics-attribution-plain"><span>Текст · {provider}{viaSpicy&&provider!=='Spicy Lyrics'?' · через Spicy Lyrics':''}</span>{attribution?.uploader&&<AuthorCard label="Загрузил" author={{id:attribution.uploader.id,username:null,displayName:attribution.uploader.name,avatarUrl:attribution.uploader.avatarUrl,credit:attribution.uploader.name}}/>}{attribution?.maker&&<AuthorCard label="Разметил" author={{id:attribution.maker.id,username:null,displayName:attribution.maker.name,avatarUrl:attribution.maker.avatarUrl,credit:attribution.maker.name}}/>}</div>:null)}
    <div className="lyrics-footer"><div><button onClick={()=>shift(-.1)} aria-label="Текст на 0.1 секунды позже"><Minus size={13}/></button><span title="Положительное значение показывает текст раньше">{offset>0?'+':''}{offset.toFixed(1)} с</span><button onClick={()=>shift(.1)} aria-label="Текст на 0.1 секунды раньше"><Plus size={13}/></button></div><button className="text-button" onClick={()=>setFollow(true)} disabled={follow}><Crosshair size={14}/>{follow?'Следуем за музыкой':'К текущей строке'}</button></div>
  </section>;
},(a,b)=>a.trackId===b.trackId&&a.trackName===b.trackName&&a.artistName===b.artistName&&a.duration===b.duration&&a.onSeek===b.onSeek);
