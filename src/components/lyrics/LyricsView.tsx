import LumaSpin from '../ui/luma-spin.js';
import {Modal} from '../common/Modal.js';
import {FileUploader} from '../common/FileUploader.js';
import {useReportStore} from '../common/ReportDialog.js';
import {contentApi} from '../../api/userContentClient.js';
import {useTranslation,useLanguageStore} from '../../stores/useLanguageStore.js';
import { scopedStorageKey } from '../../telegram/runtime.js';
import React, {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import { Upload, Download, Minus, Plus, Crosshair, Pencil, Undo2, X, Settings2, Languages, MoreHorizontal } from 'lucide-react';
import type { LyricLine, LyricsAuthor, LyricsData } from '../../types/index.js';
import { apiClient } from '../../api/apiClient.js';
import { parseLrc, parseLyricsFile, normalizeLyricTimings, getActiveLyricIndex } from '../../utils/lyricsParser.js';
import { getPreferredSource, getRecording } from '../../utils/playbackPreferences.js';
import { readLocalLyrics, saveLocalLyrics, deleteLocalLyrics } from '../../utils/lyricsStorage.js';
import { audioManager } from '../../audio/AudioManager.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { LyricsLine, PlainLyricLine } from './LyricsLine.js';
import { CreditsList, useTrackInfo } from '../tracks/TrackCredits.js';
import { AuthorCard } from '../profile/AuthorCard.js';
import { paintTimedLine, paintTimedWordSegments, paintLyricGap, lyricGaps, WORD_PULL_RELEASE_SECONDS } from '../../utils/lyricMotion.js';
import UniqueLoading from '../ui/morph-loading.js';
import { GeniusDrawer } from './GeniusAnnotations.js';
import { createPortal } from 'react-dom';
import { NotesSlotContext } from './notesSlot.js';
import { annotationRanges, type GeniusAnnotationSet, type GeniusReferent } from '../../utils/geniusAnnotations.js';
import {LoadingState} from '../common/LoadingState.js';

interface Props {enabled?:boolean;trackId:string;trackName?:string;artistName?:string;duration?:number;currentTime:number;onSeek:(time:number)=>void}
export const LyricsView=React.memo(function LyricsView({enabled=true,trackId,trackName,artistName,duration,currentTime,onSeek}:Props){
  const t=useTranslation(),[settings,setSettings]=useState(false),[saveState,setSaveState]=useState('');
  const offsetTimer=useRef<ReturnType<typeof setTimeout>>();
  const [raw,setRaw]=useState<LyricLine[]>([]),[plain,setPlain]=useState(''),[provider,setProvider]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [loadFailed,setLoadFailed]=useState(false);
  const [author,setAuthor]=useState<LyricsAuthor|null>(null);
  const [attribution,setAttribution]=useState<LyricsData['attribution']>();
  const [viaSpicy,setViaSpicy]=useState(false);
  const [offset,setOffset]=useState(0),[follow,setFollow]=useState(true),[reload,setReload]=useState(0);
  const [editor,setEditor]=useState(false),[draft,setDraft]=useState(''),[stamps,setStamps]=useState<number[]>([]),[recording,setRecording]=useState(false);
  const [clock,setClock]=useState(currentTime);
  const [notes,setNotes]=useState<GeniusAnnotationSet|null>(null),[note,setNote]=useState<{line:number;referent:number}|null>(null),shownNote=useRef<{line:number;referent:number}>({line:-1,referent:-1});
  // Docked notes (full player, wide screens): the drawer renders in the player's left column.
  const notesHost=React.useContext(NotesSlotContext),wide=useWideScreen(),notesSlot=wide?notesHost?.slot??null:null;
  // Machine translation under each line; the target is the UI language, or English when the song already is in it.
  const language=useLanguageStore(s=>s.language),[translateOn,setTranslateOn]=useState(()=>localStorage.getItem(scopedStorageKey('lyrics-translate'))==='1'),[translated,setTranslated]=useState<{key:string;lines:string[];target:string}|null>(null),[translating,setTranslating]=useState(false);
  const playing=usePlayerStore(s=>s.isPlaying),buffering=usePlayerStore(s=>s.isBuffering),artwork=usePlayerStore(s=>s.currentTrack?.id===trackId?s.currentTrack.artworkUrl:undefined);
  // The chosen source (and recording) of this track: each one keeps its own timing offset.
  const [timingSource,setTimingSource]=useState(()=>timingSourceOf(trackId));
  useEffect(()=>{const sync=()=>setTimingSource(timingSourceOf(trackId));sync();window.addEventListener('oskolok-source-change',sync);return()=>window.removeEventListener('oskolok-source-change',sync);},[trackId]);
  const fileRef=useRef<HTMLInputElement>(null),containerRef=useRef<HTMLDivElement>(null),activeRef=useRef<HTMLDivElement>(null),generation=useRef(0);
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();
    const id=++generation.current;setRaw([]);setPlain('');setProvider('');setAuthor(null);setAttribution(undefined);setViaSpicy(false);setLoading(true);setError('');setLoadFailed(false);setEditor(false);setRecording(false);setStamps([]);setFollow(true);
    try{setOffset(Number(localStorage.getItem(scopedStorageKey(`interference-offset:${trackId}`)))||0);}catch{setOffset(0);}
    (async()=>{
      try{
        const data=await apiClient.getLyrics(trackId,trackName,artistName,duration,controller.signal,timingSource);
        if(id!==generation.current)return;
        setOffset(data.timingOffset||0);setRaw(data?.syncedLyrics||parseLrc(data?.plainLyrics||''));setPlain(data?.plainLyrics||'');setProvider(data?.provider||'');setAuthor(data?.author||null);setAttribution(data?.attribution);setViaSpicy(data?.apiSource==='spicy_lyrics');
      }catch{
        if(controller.signal.aborted||id!==generation.current)return;
        const local=await readLocalLyrics(trackId).catch(()=>undefined);
        if(id!==generation.current)return;
        if(local?.length){setRaw(local);setProvider('Ваш файл');}
        else {setLoadFailed(true);setError(t('Не удалось загрузить текст. Попробуйте ещё раз.','Could not load lyrics. Try again.'));}
      }
      finally{if(id===generation.current)setLoading(false);}
    })();
    return()=>{controller.abort();generation.current++;};
  },[trackId,trackName,artistName,duration,reload,enabled,timingSource]);
  const lines=useMemo(()=>{
    const normalized=normalizeLyricTimings(raw,duration);
    return normalized.flatMap(line=>[line,...(line.background||[]).map(bg=>({...bg,role:'background' as const}))]).sort((a,b)=>a.time-b.time);
  },[raw,duration]);
  // Position among lead-vocal lines, so the glow alternates line by line.
  const mainIndex=useMemo(()=>{let n=0;return lines.map(line=>line.role==='background'?-1:n++);},[lines]);
  const boundaries=useMemo(()=>[...new Set(lines.flatMap(line=>[line.time,line.end]))].sort((a,b)=>a-b),[lines]);
  const gaps=useMemo(()=>lyricGaps(lines),[lines]),gapByLine=useMemo(()=>new Map(gaps.map(gap=>[gap.index,gap])),[gaps]);
  // Genius referents: fetched per song, matched to the lines shown here.
  // A new track's lyrics surface softly instead of replacing the old ones in one frame.
  const fadedFor=useRef('');
  useEffect(()=>{
    if(!lines.length||fadedFor.current===trackId)return;
    fadedFor.current=trackId;
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)containerRef.current?.animate([{opacity:0,filter:'blur(6px)'},{opacity:1,filter:'none'}],{duration:480,easing:'cubic-bezier(.2,.8,.2,1)'});
  },[lines,trackId]);
  const [notesLoading,setNotesLoading]=useState(false);
  useEffect(()=>{
    setNotes(null);setNote(null);setNotesLoading(false);
    if(!enabled||!trackName||!artistName)return;
    setNotesLoading(true);
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    // Genius can be slow or briefly unreachable; a failed lookup is asked again twice before giving up.
    const load=(attempt:number)=>apiClient.getLyricsAnnotations(trackId,trackName,artistName,controller.signal).then(data=>{
      if(controller.signal.aborted)return;
      if(data?.referents?.length){setNotes(data);setNotesLoading(false);}
      else if(data?.transient&&attempt<2)timer=setTimeout(()=>load(attempt+1),2500*(attempt+1));
      else setNotesLoading(false);
    }).catch(()=>{if(controller.signal.aborted)return;if(attempt<2)timer=setTimeout(()=>load(attempt+1),2500*(attempt+1));else setNotesLoading(false);});
    void load(0);
    return()=>{controller.abort();clearTimeout(timer);};
  },[trackId,trackName,artistName,enabled]);
  // Unsynced text (Genius) is annotated line by line just like timed lyrics.
  const plainLines=useMemo(()=>lines.length||!plain?[]:plain.split('\n').map(text=>({text:text.trim(),time:0,end:0})),[lines.length,plain]);
  const noteLines=lines.length?lines:plainLines;
  const lineNotes=useMemo(()=>notes?annotationRanges(noteLines,notes.referents):new Map<number,ReturnType<typeof annotationRanges> extends Map<number,infer R>?R:never>(),[noteLines,notes]);
  const openNote=useCallback((line:number,referent:number)=>setNote(open=>open&&open.line===line&&open.referent===referent?null:{line,referent}),[]),closeNote=useCallback(()=>setNote(null),[]);
  if(note)shownNote.current=note;
  // The clicked fragment first (with any fragment that shares its badge), then the other notes on the same line.
  const drawerReferents=useMemo(()=>{const {line,referent}=shownNote.current;if(!notes||referent<0)return [];const ranges=lineNotes.get(line)||[],own=ranges.find(range=>range.referent===referent||range.also?.includes(referent));const ids=[referent,...(own?.also||[]),...ranges.flatMap(range=>[range.referent,...(range.also||[])])];// Genius sometimes holds the same fragment twice; its notes then share one quote instead of repeating it.
    const same=(a:string,b:string)=>a.replace(/\s+/g,' ').trim()===b.replace(/\s+/g,' ').trim(),out:GeniusReferent[]=[];
    for(const referent of [...new Set(ids)].map(r=>notes.referents[r]).filter(Boolean)){const at=out.findIndex(other=>same(other.fragment,referent.fragment));if(at<0)out.push(referent);else out[at]={...out[at],annotations:[...out[at].annotations,...referent.annotations.filter(note=>!out[at].annotations.some(known=>known.id===note.id))]};}
    return out;},[notes,lineNotes,note]);
  const docked=!!notesSlot&&note!==null&&lineNotes.size>0&&!editor;
  useEffect(()=>{notesHost?.setOpen(docked);},[notesHost,docked]);
  useEffect(()=>()=>notesHost?.setOpen(false),[notesHost]);
  // Every line the open fragment touches shows it as selected, so the text under the panel still says what it is about.
  const openReferent=note?.referent;
  const leadTexts=useMemo(()=>noteLines.map(line=>line.text),[noteLines]),translateKey=useMemo(()=>`${trackId}:${language}:${leadTexts.join('\u0001')}`,[trackId,leadTexts,language]);
  useEffect(()=>{localStorage.setItem(scopedStorageKey('lyrics-translate'),translateOn?'1':'0');},[translateOn]);
  useEffect(()=>{
    if(!translateOn||!enabled||!leadTexts.length||translated?.key===translateKey)return;
    const controller=new AbortController();setTranslating(true);setError('');
    const request=(target:string)=>apiClient.translateLyrics(leadTexts,target,controller.signal);
    request(language).then(result=>result.sameLanguage?request(language==='en'?'ru':'en').then(other=>({...other,target:language==='en'?'ru':'en'})):{...result,target:language})
      .then(result=>{if(!controller.signal.aborted)setTranslated({key:translateKey,lines:result.translations,target:result.target});})
      .catch(()=>{if(!controller.signal.aborted)setError(t('Перевод временно недоступен. Попробуйте ещё раз.','Translation is temporarily unavailable. Try again.'));})
      .finally(()=>{if(!controller.signal.aborted)setTranslating(false);});
    return()=>{controller.abort();setTranslating(false);};
  },[translateOn,enabled,leadTexts,translateKey,language,translated?.key]);
  const lineTranslations=translateOn&&translated?.key===translateKey?translated.lines:undefined;
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
    if(!enabled||editor)return;
    let frame=0,settleFrame=0,previous=-2;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const slots=Array.from(containerRef.current?.querySelectorAll<HTMLElement>('.lyric-slot')||[]),gapNodes=Array.from(containerRef.current?.querySelectorAll<HTMLElement>('.lyric-gap')||[]);
    const paint=(time:number,force=false)=>{
      for(const gap of gapNodes)if(time>=Number(gap.dataset.gapStart)-.1&&time<=Number(gap.dataset.gapEnd)+.1)paintLyricGap(gap,time);
      for(const slot of slots){
        const start=Number(slot.dataset.start),end=Number(slot.dataset.end);
        if(force||(time>=start&&time<end&&slot.dataset.visible!=='false'))paintTimedLine(slot,time,reduced);
        else if(slot.dataset.wordSettling==='true'||(time>=end&&time<=end+WORD_PULL_RELEASE_SECONDS+.3))paintTimedWordSegments(slot,time,reduced);
      }
    };
    const update=(position=audioManager.getSmoothTime(),force=false)=>{const time=position+offset;let lo=0,hi=boundaries.length;while(lo<hi){const middle=(lo+hi)>>>1;if(boundaries[middle]<=time)lo=middle+1;else hi=middle;}if(force||lo!==previous){previous=lo;setClock(position);}paint(time,force);};
    const tick=()=>{update();frame=requestAnimationFrame(tick);};
    const start=()=>{cancelAnimationFrame(frame);if(playing&&!buffering&&!document.hidden)frame=requestAnimationFrame(tick);};
    const visibility=()=>{cancelAnimationFrame(frame);update(audioManager.getCurrentTime(),true);start();};
    update(audioManager.getCurrentTime(),true);start();
    document.addEventListener('visibilitychange',visibility);
    const unsubscribe=audioManager.subscribe({onTimeUpdate:(position)=>{if(!playing||buffering)update(position,true);},onSeek:(position)=>{update(position,true);cancelAnimationFrame(settleFrame);settleFrame=requestAnimationFrame(()=>update(position));}});
    return()=>{cancelAnimationFrame(frame);cancelAnimationFrame(settleFrame);document.removeEventListener('visibilitychange',visibility);unsubscribe();};
  },[boundaries,offset,playing,buffering,editor,loading,enabled]);
  const seekLine=useCallback((t:number)=>{onSeek(Math.max(0,t-offset));setFollow(true);},[onSeek,offset]);
  const time=clock+offset,active=getActiveLyricIndex(lines,time);
  // The view follows the lead vocal: a backing line («(yeah)», ad-libs) lights up in place but never moves the text.
  const focus=useMemo(()=>{let f=-1;for(let i=0;i<=active&&i<lines.length;i++)if(lines[i].role!=='background')f=i;return f;},[lines,active]);
  // Cooldown: the intro before the first line or a long instrumental break.
  const openGap=gaps.find(gap=>time>=gap.start&&time<gap.end);
  // A critically damped spring carries the scroll between lines. Retargeting
  // mid-flight keeps the current velocity, so fast lines never jerk the view
  // the way restarted native smooth scrolls do.
  const glide=useRef({frame:0,x:0,v:0,target:0});
  const stopGlide=useCallback(()=>{cancelAnimationFrame(glide.current.frame);glide.current.frame=0;glide.current.v=0;},[]);
  const glideTo=useCallback((top:number,instant=false)=>{
    const container=containerRef.current,g=glide.current;
    if(!container)return;
    g.target=Math.max(0,Math.min(top,container.scrollHeight-container.clientHeight));
    if(instant||matchMedia('(prefers-reduced-motion: reduce)').matches){stopGlide();container.scrollTop=g.target;return;}
    if(g.frame)return;
    g.x=container.scrollTop;g.v=0;
    let last=performance.now();
    const omega=7.5;
    const step=(now:number)=>{
      const dt=Math.min(1/30,(now-last)/1000);last=now;
      g.v+=(omega*omega*(g.target-g.x)-2*omega*g.v)*dt;
      g.x+=g.v*dt;
      if(Math.abs(g.target-g.x)<1&&Math.abs(g.v)<14){container.scrollTop=g.target;g.frame=0;g.v=0;return;}
      container.scrollTop=g.x;
      g.frame=requestAnimationFrame(step);
    };
    g.frame=requestAnimationFrame(step);
  },[stopGlide]);
  // Line change: the text lands at its new place at once, then each line catches up on its own — the ones leaving
  // first, the next lines a beat later — so the lyrics flow up like a wave instead of scrolling as one sheet.
  // Long jumps (seeking, the first line) keep the plain glide.
  const cascadeTo=useCallback((top:number)=>{
    const container=containerRef.current;
    if(!container)return;
    const target=Math.max(0,Math.min(top,container.scrollHeight-container.clientHeight)),delta=target-container.scrollTop;
    if(Math.abs(delta)<2)return;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||Math.abs(delta)>container.clientHeight*.8){glideTo(top);return;}
    stopGlide();
    const view=container.getBoundingClientRect();
    const slots=[...container.querySelectorAll<HTMLElement>(':scope > .lyric-slot, :scope > .lyric-gap')].filter(el=>{const r=el.getBoundingClientRect();return r.bottom>view.top-delta-200&&r.top<view.bottom+Math.abs(delta)+200;});
    const anchor=Math.max(0,slots.indexOf(activeRef.current as HTMLElement));
    const carried=slots.map(el=>{const m=getComputedStyle(el).transform;return m&&m!=='none'?new DOMMatrixReadOnly(m).m42:0;});
    container.scrollTop=target;
    slots.forEach((el,k)=>{el.style.transition='none';el.style.transform=`translateY(${delta+carried[k]}px)`;});
    void container.offsetHeight;
    slots.forEach((el,k)=>{
      const step=Math.min(7,Math.max(0,k-anchor+1));
      el.style.transition=`transform 760ms cubic-bezier(.22,1,.36,1) ${step*45}ms`;
      el.style.transform='';
    });
  },[glideTo,stopGlide]);
  const lineTarget=(el:HTMLElement,container:HTMLElement)=>el.offsetTop-container.clientHeight*.42+(Number(el.dataset.height)||el.clientHeight)/2;
  useEffect(()=>stopGlide,[stopGlide]);
  useEffect(()=>{if(!follow)stopGlide();},[follow,stopGlide]);
  useEffect(()=>{
    if(!follow||!activeRef.current||!containerRef.current)return;
    cascadeTo(lineTarget(activeRef.current,containerRef.current));
    // Gap indicators open and collapse over ~.5s; settle on the final layout.
    const timer=setTimeout(()=>{if(activeRef.current&&containerRef.current)glideTo(lineTarget(activeRef.current,containerRef.current));},620);
    return()=>clearTimeout(timer);
  },[focus,openGap?.index,follow,editor,glideTo,cascadeTo]);
  useEffect(()=>{
    const container=containerRef.current;
    if(!follow||!container||editor)return;
    let frame=0,disposed=false;
    const center=()=>{
      if(disposed)return;
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const el=activeRef.current;
        if(el)glideTo(lineTarget(el,container),true);
      });
    };
    const observer=new ResizeObserver(center);
    observer.observe(container);center();
    void document.fonts?.ready.then(center);
    return()=>{disposed=true;observer.disconnect();cancelAnimationFrame(frame);};
  },[follow,editor,lines,glideTo]);
  const commit=async(next:LyricLine[])=>{
    const id=trackId,request=++generation.current;
    try{setSaveState(t('Сохраняем…','Saving…'));await contentApi.save(id,{lines:next,offset,source:timingSource,trackTitle:trackName,artistName});await saveLocalLyrics(id,next).catch(()=>{});setSaveState(t('Сохранено в вашем аккаунте','Saved to your account'));if(generation.current!==request)return;setRaw(next);setPlain('');setProvider('Ваш файл');setAuthor(null);setAttribution(undefined);setViaSpicy(false);setLoading(false);setError('');setEditor(false);setRecording(false);}
    catch(e){if(generation.current===request){const message=e instanceof Error?e.message:t('Не удалось сохранить','Could not save');setError(message);setSaveState(message);throw e;}}
  };
  const upload=async(file?:File)=>{
    if(!file)return;
    const id=generation.current;
    try{if(file.size>1000000)throw new Error(t('Максимальный размер файла — 1 МБ.','Maximum file size is 1 MB.'));const text=await file.text();if(id!==generation.current)return;await commit(parseLyricsFile(text,file.name));}
    catch(e){setError(e instanceof Error?e.message:t('Не удалось прочитать файл.','Could not read the file.'));}
    finally{if(fileRef.current)fileRef.current.value='';}
  };
  const setTiming=(value:number)=>{const next=Math.round(Math.max(-10,Math.min(10,value))*10)/10;setOffset(next);setSaveState(t('Сохраняем…','Saving…'));clearTimeout(offsetTimer.current);const selectedTrack=trackId,source=timingSource;offsetTimer.current=setTimeout(()=>{void contentApi.save(selectedTrack,{offset:next,source,trackTitle:trackName,artistName}).then(()=>setSaveState(t('Сохранено в вашем аккаунте','Saved to your account'))).catch(e=>{setSaveState(e.message);setError(e.message);});},350);};
  const report=(kind:'timing'|'lyrics')=>{const track=usePlayerStore.getState().currentTrack;setSettings(false);useReportStore.getState().open({track:track?.id===trackId?track:undefined,kind,offset,lines:raw});};
  const exportFile=()=>{const blob=new Blob([JSON.stringify({version:1,trackId,lines:raw},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${(trackName||'interference').replace(/[^\p{L}\p{N} -]/gu,'')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const tokens=useMemo(()=>draft.split('\n').flatMap((line,lineIndex)=>(line.match(/\S+/g)||[]).map(text=>({text,lineIndex}))),[draft]);
  const stampWord=()=>{
    const now=audioManager.getCurrentTime();
    if(!playing){setError(t('Сначала включите трек, затем отмечайте слова.','Start the track first, then mark the words.'));return;}
    if(stamps.length&&now<=stamps.at(-1)!){setError(t('Время должно идти вперёд. Отмените последнюю отметку или начните заново.','Time must move forward. Undo the last mark or start over.'));return;}
    if(stamps.length<tokens.length){setStamps([...stamps,now]);setError('');return;}
    const next:LyricLine[]=[];
    tokens.forEach((token,i)=>{const word={text:token.text,start:stamps[i],end:stamps[i+1]??now};let line=next.at(-1);if(!i||token.lineIndex!==tokens[i-1].lineIndex){line={time:word.start,text:token.text,words:[],end:word.end};next.push(line);}else{line!.text+=' '+token.text;}line!.words!.push(word);line!.end=word.end;});
    void commit(next).catch(()=>{});
  };
  const timingLabel=lines.some(line=>line.timingMode==='syllable')?t('по словам и слогам','word & syllable sync'):lines.length?t('по строкам','line sync'):plain?t('без синхронизации','not synced'):'';
  // Who provided the text: under the lyrics on desktop, at the end of the text on phones (where screen height is the content's).
  const attributionInner=!editor&&(author?<div className="lyrics-attribution"><span>{t("Текст предоставлен: ","Lyrics provided by: ")}{provider==='Ваш файл'?t('Ваш файл','Your file'):provider}{viaSpicy&&provider!=="Spicy Lyrics"?t(" через: Spicy Lyrics"," via: Spicy Lyrics"):""}</span><AuthorCard author={author}/></div>:provider&&provider!=='none'?<div className="lyrics-attribution lyrics-attribution-plain"><span>{t('Текст предоставлен: ','Lyrics provided by: ')}{provider==='Ваш файл'?t('Ваш файл','Your file'):provider}{viaSpicy&&provider!=='Spicy Lyrics'?t(' через: Spicy Lyrics',' via: Spicy Lyrics'):''}</span>{attribution?.uploader&&<AuthorCard label={t('Загрузил','Uploaded by')} author={{id:attribution.uploader.id,username:null,displayName:attribution.uploader.name,avatarUrl:attribution.uploader.avatarUrl,credit:attribution.uploader.name}}/>}{attribution?.maker&&<AuthorCard label={t('Разметил','Timed by')} author={{id:attribution.maker.id,username:null,displayName:attribution.maker.name,avatarUrl:attribution.maker.avatarUrl,credit:attribution.maker.name}}/>}</div>:null);
  // Who provided, uploaded and timed the text: behind one «⋯» under the lyrics instead of a plate.
  const attributionNode=attributionInner?<div className="lyrics-attribution lyrics-attribution--more"><LyricsCreditMore>{attributionInner}</LyricsCreditMore></div>:null;
  const drawer=lineNotes.size>0&&!editor?<GeniusDrawer open={note!==null} line={noteLines[shownNote.current.line]?.text} referents={drawerReferents} song={notes?.song} onClose={closeNote} translateTo={translateOn?(translated?.target||language):undefined} artwork={artwork}/>:null;
  return <section className="interference-lyrics lyrics-v3" data-notes-open={note?'true':undefined} data-notes-docked={notesSlot?'true':undefined} data-translated={lineTranslations?'true':undefined}>
    <div className="lyrics-toolbar"><div><span className="eyebrow">{t('Текст песни','Lyrics')}</span>{timingLabel&&<p>{timingLabel}</p>}{notesLoading&&lines.length>0&&<p className="lyrics-notes-loading" role="status"><LumaSpin size="sm"/>{t('Подготовка аннотаций…','Preparing annotations…')}</p>}</div><div className="lyrics-toolbar-actions"><button className={`text-button lyrics-translate-toggle${translateOn?' is-on':''}`} onClick={()=>setTranslateOn(v=>!v)} disabled={!leadTexts.length&&!translateOn} aria-pressed={translateOn} aria-busy={translating} title={translateOn?t('Скрыть перевод','Hide translation'):t('Перевести текст','Translate lyrics')}>{translating?<UniqueLoading size="sm" label={t('Переводим…','Translating…')}/>:<Languages size={17}/>}<span>{t('Перевод','Translate')}</span></button><button className="text-button" onClick={()=>setSettings(true)} aria-label={t('Настройки текста','Lyrics settings')}><Settings2 size={17}/></button></div></div>
    {error&&<p className="lyrics-error" role="alert">{error}</p>}
    {loadFailed&&<button type="button" className="text-button" onClick={()=>setReload(value=>value+1)}>{t('Повторить загрузку','Retry loading')}</button>}
    <div ref={containerRef} className={`lyrics-scroll ${follow?'':'is-manual'}`} onWheel={()=>setFollow(false)} onTouchMove={()=>setFollow(false)}>
      {loading&&!lines.length?<LoadingState size="md" label={t('Ищем слова…','Finding lyrics…')}/>:lines.length?lines.map((line,i)=>{const glow=line.role!=='background'&&mainIndex[i]%2===1;const singing=time>=line.time&&time<line.end,sung=time>=line.end,gap=gapByLine.get(i),gapOpen=gap!==undefined&&gap===openGap;return <React.Fragment key={`${line.time}:${i}`}>{gap&&<div className="lyric-gap" data-open={gapOpen?'true':'false'} data-gap-start={gap.start} data-gap-end={gap.end} data-height="76" aria-hidden={!gapOpen} ref={gapOpen?activeRef:undefined}><span className="lyric-gap-dots" role="img" aria-label={t('Проигрыш, ждём следующую строку','Instrumental, waiting for the next line')}><i style={{'--dot':0} as React.CSSProperties}/><i style={{'--dot':1} as React.CSSProperties}/><i style={{'--dot':2} as React.CSSProperties}/></span></div>}<div className="lyric-slot" data-active={singing?'true':'false'} data-start={line.time} data-end={line.end} data-line-index={i} ref={i===focus&&!openGap?activeRef:undefined}><LyricsLine line={line} isActive={singing} isSung={sung} currentTime={time} onSeek={seekLine} glow={glow} notes={lineNotes.get(i)} lineIndex={i} onAnnotate={openNote} selected={openReferent!==undefined&&lineNotes.get(i)?.some(range=>range.referent===openReferent||range.also?.includes(openReferent))?openReferent:undefined} translation={lineTranslations?.[i]}/></div></React.Fragment>}):plain?<div className="plain-lyrics plain-lyrics--lines">{plainLines.map((line,i)=><PlainLyricLine key={i} text={line.text} translation={lineTranslations?.[i]} notes={lineNotes.get(i)} lineIndex={i} onAnnotate={openNote} selected={openReferent!==undefined&&lineNotes.get(i)?.some(range=>range.referent===openReferent||range.also?.includes(openReferent))?openReferent:undefined}/>)}</div>:<div className="lyrics-empty"><h3>{t('Добавьте текст','Add lyrics')}</h3><p>{t('Загрузите файл с временными метками или создайте разметку по словам.','Upload a timed lyrics file or time the words yourself.')}</p><button className="primary-button" onClick={()=>setSettings(true)}><Upload size={16}/> {t('Загрузить файл','Upload file')}</button></div>}
      {!editor&&(lines.length>0||!!plain)&&<div className="lyrics-attribution-inline">{attributionNode}</div>}
      {!editor&&(lines.length>0||!!plain)&&<LyricsCredits trackId={trackId} enabled={enabled}/>}
    </div>
    {attributionNode}
    {lineNotes.size>0&&!editor&&(notesSlot?createPortal(drawer,notesSlot):drawer)}
    <div className="lyrics-footer"><button className="text-button" onClick={()=>setSettings(true)}><Settings2 size={15}/>{t('Настройки текста','Lyrics settings')}</button><button className="text-button" onClick={()=>setFollow(true)} disabled={follow}><Crosshair size={14}/>{follow?t('Следуем за музыкой','Following music'):t('К текущей строке','Current line')}</button></div>
    <Modal isOpen={settings} onClose={()=>{setSettings(false);setEditor(false);setRecording(false);}} title={t('Настройки текста','Lyrics settings')}><div className="content-form">
      <label>{t('Смещение тайминга','Timing offset')} <output>{offset>0?'+':''}{offset.toFixed(1)} {t('с','s')}</output><input type="range" min={-10} max={10} step={0.1} value={offset} onChange={e=>setTiming(Number(e.target.value))}/></label><small>{t('Положительное значение показывает текст раньше.','Positive values show lyrics earlier.')}</small><button className="text-button" onClick={()=>setTiming(0)}>{t('Сбросить смещение','Reset offset')}</button>
      <FileUploader kind="lyrics" trackId={trackId} onLyrics={commit}/>
      {editor?<div className="lyrics-editor"><div className="section-heading"><h3>{t('Своё исполнение','Your own timing')}</h3><button onClick={()=>{setEditor(false);setRecording(false);}} aria-label={t('Закрыть редактор','Close editor')}><X size={18}/></button></div>
      <p>{t('Вставьте текст. Включите трек и отмечайте начало каждого слова кнопкой. После последнего слова отметьте окончание.','Paste the lyrics. Play the track and press the button as each word starts. After the last word, mark the ending.')}</p>
      {!recording?<><textarea className="glass-input" value={draft} maxLength={20000} onChange={e=>setDraft(e.target.value)} rows={7} placeholder={t('Каждая строка — новая фраза','Each line is a new phrase')}/><button className="primary-button" disabled={!tokens.length} onClick={()=>{setRecording(true);setStamps([]);}}>{t(`Разметить ${tokens.length} слов`,`Time ${tokens.length} words`)}</button></>:<><span className="eyebrow">{stamps.length} / {tokens.length}</span><h3 className="record-word">{tokens[stamps.length]?.text||t('Окончание','Ending')}</h3><button className="primary-button" onClick={stampWord}>{stamps.length<tokens.length?t('Слово начинается сейчас','Word starts now'):t('Закончить и сохранить','Finish and save')}</button><button className="text-button" onClick={()=>setStamps(stamps.slice(0,-1))}>{t('Отменить последнюю отметку','Undo last mark')}</button></>}
      <small>{t('Текст и тайминг сохраняются в вашем аккаунте.','Lyrics and timing are saved to your account.')}</small>
    </div> :<button className="secondary-button" onClick={()=>{setDraft(raw.map(l=>l.text).join('\n')||plain);setEditor(true);setRecording(false);setStamps([]);}}><Pencil size={16}/>{t('Редактировать / разметить слова','Edit / time words')}</button>}
      {raw.length>0&&<button className="text-button" onClick={exportFile}><Download size={16}/>{t('Скачать разметку','Download timing')}</button>}
      {provider==='Ваш файл'&&<button className="text-button" onClick={async()=>{try{await contentApi.save(trackId,{lines:null});await deleteLocalLyrics(trackId);setReload(v=>v+1);}catch(e){setError((e as Error).message);}}}>{t('Вернуть текст из каталога','Restore catalog lyrics')}</button>}
      {saveState&&<p role="status">{saveState}</p>}<hr/>
      <button className="secondary-button" onClick={()=>report('timing')}>{t('Предложить тайминг администратору','Submit timing for review')}</button>
      <button className="secondary-button" disabled={!raw.length} onClick={()=>report('lyrics')}>{t('Предложить текст / исправление','Submit lyrics / correction')}</button>
      <small>{t('Личные изменения сохраняются для вашего аккаунта. Отправка на проверку требует отдельного подтверждения.','Personal changes are saved to your account. Submitting for review requires separate confirmation.')}</small>
    </div></Modal>
  </section>;
},(a,b)=>a.enabled===b.enabled&&a.trackId===b.trackId&&a.trackName===b.trackName&&a.artistName===b.artistName&&a.duration===b.duration&&a.onSeek===b.onSeek);

function timingSourceOf(trackId:string):string|undefined{
  const source=getPreferredSource(trackId);
  if(source==='auto')return undefined;
  const recording=getRecording(trackId,source);
  return recording?`${source}:${recording}`:source;
}

/** «Над треком работали»: the Genius credits, closing every text. */
function LyricsCredits({trackId,enabled}:{trackId:string;enabled:boolean}){
  const t=useTranslation(),info=useTrackInfo(trackId,enabled),genius=info.data?.genius;
  if(!genius||(!genius.credits.length&&!genius.featuredArtists.length&&!genius.labels.length))return null;
  return <section className="lyrics-credits" aria-label={t('Над треком работали','Credits')}><h3>{t('Над треком работали','Credits')}</h3><CreditsList info={genius} compact/></section>;
}

/** Notes dock into the full player's column only where there is room for two columns. */
function useWideScreen(){
  const query='(min-width: 701px)';
  const [wide,setWide]=useState(()=>typeof window!=='undefined'&&window.matchMedia(query).matches);
  useEffect(()=>{const list=window.matchMedia(query),update=()=>setWide(list.matches);list.addEventListener('change',update);return()=>list.removeEventListener('change',update);},[]);
  return wide;
}

function LyricsCreditMore({children}:{children:React.ReactNode}){
  const t=useTranslation(),[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const away=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
    const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);}};
    document.addEventListener('pointerdown',away);document.addEventListener('keydown',esc,true);
    return()=>{document.removeEventListener('pointerdown',away);document.removeEventListener('keydown',esc,true);};
  },[open]);
  return <div className="lyrics-credit-more" ref={root}>
    <button type="button" className="lyrics-credit-more__button" onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-label={t('Кто предоставил текст','Who provided the lyrics')} title={t('Кто предоставил текст','Who provided the lyrics')}><MoreHorizontal size={18}/></button>
    {open&&<div className="lyrics-credit-more__panel" role="dialog" aria-label={t('Источник текста','Lyrics source')}>{children}</div>}
  </div>;
}
