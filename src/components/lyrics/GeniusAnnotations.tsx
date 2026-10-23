import React, {createElement,Fragment,useEffect,useRef,useState} from 'react';
import {apiClient} from '../../api/apiClient.js';
import UniqueLoading from '../ui/morph-loading.js';
import {GeniusMark} from './GeniusMark.js';
import type {MouseEvent,ReactNode} from 'react';
import {X,ExternalLink,ThumbsUp,BadgeCheck,Languages} from 'lucide-react';
import {confirmLeave} from '../common/LeaveWarning.js';
import {scopedStorageKey} from '../../telegram/runtime.js';
import {useLanguageStore} from '../../stores/useLanguageStore.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {paletteFromArtwork,type Rgb} from '../../utils/releasePalette.js';
import type {GeniusAnnotationSet,GeniusDomNode,GeniusReferent} from '../../utils/geniusAnnotations.js';

const TAGS=new Set(['p','em','i','strong','b','blockquote','ul','ol','li','small','code','sup','sub','s','u']);
const safeUrl=(value?:string,images=false)=>{try{const url=new URL(value||'');return url.protocol==='https:'||(!images&&url.protocol==='http:')?url.href:undefined;}catch{return undefined;}};

/** Genius `dom` bodies arrive pre-sanitised; they are still rebuilt from a
 * whitelist here, so no markup string ever reaches the document. */
function renderDom(nodes:GeniusDomNode[]|undefined,path=''):ReactNode[] {
  return (nodes||[]).map((node,index)=>{
    const key=`${path}${index}`;
    if(typeof node==='string')return <Fragment key={key}>{node}</Fragment>;
    const children=node.children?.length?renderDom(node.children,`${key}.`):undefined;
    switch(node.tag){
      case 'br':return <br key={key}/>;
      case 'hr':return <hr key={key}/>;
      case 'a':{const href=safeUrl(node.attributes?.href);return href?<a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" onClick={confirmLeave}>{children}</a>:<Fragment key={key}>{children}</Fragment>;}
      case 'img':{const src=safeUrl(node.attributes?.src,true);return src?<img key={key} src={src} alt={node.attributes?.alt||''} loading="lazy" decoding="async" referrerPolicy="no-referrer"/>:null;}
      default:return TAGS.has(node.tag)?createElement(node.tag,{key},children):<Fragment key={key}>{children}</Fragment>;
    }
  });
}

export {GeniusMark};


function Referent({referent,translated}:{referent:GeniusReferent;translated?:{fragment:string;bodies:string[][]}}){
  const t=useTranslation();
  return <article className="genius-referent">
    <blockquote className="genius-fragment">{referent.fragment}{translated?.fragment&&<small className="genius-translated">{translated.fragment}</small>}</blockquote>
    {referent.annotations.map((annotation,annotationIndex)=><section key={annotation.id} className="genius-annotation">
      <div className="genius-annotation-meta">
        {annotation.verified?<span className="genius-state is-verified"><BadgeCheck size={13}/>{t('Подтверждено артистом','Verified')}</span>:referent.classification==='unreviewed'||annotation.state==='pending'?<span className="genius-state is-pending">{t('Не проверено','Unreviewed')}</span>:<span className="genius-state">{t('Проверено Genius','Reviewed by Genius')}</span>}
        <span className="genius-votes" title={t('Голоса','Votes')}><ThumbsUp size={12}/>{annotation.votes>0?`+${annotation.votes}`:annotation.votes}</span>
      </div>
      <div className="genius-note-text">{translated?.bodies[annotationIndex]?.length?<>{translated.bodies[annotationIndex].map((paragraph,index)=><p key={index}>{paragraph||paragraphs(annotation.plain)[index]}</p>)}<small className="genius-machine">{t('Машинный перевод','Machine translation')}</small></>:annotation.body.length?renderDom(annotation.body):annotation.plain.split(/\n{2,}/).map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>
      {annotation.authors.length>0&&<ul className="genius-authors" aria-label={t('Авторы','Authors')}>
        {annotation.authors.slice(0,6).map((author,index)=>{const body=<>{author.avatar?<img src={author.avatar} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="genius-avatar-fallback" aria-hidden="true">{author.name.slice(0,1).toUpperCase()}</span>}<span><b>{author.name}</b><small>{[author.role,typeof author.iq==='number'?`${author.iq.toLocaleString()} IQ`:''].filter(Boolean).join(' · ')}</small></span></>;
          return <li key={`${author.login||author.name}:${index}`}>{author.url?<a href={author.url} target="_blank" rel="noopener noreferrer nofollow" onClick={confirmLeave}>{body}</a>:<div>{body}</div>}</li>;})}
      </ul>}
      {annotation.url&&<a className="genius-open" href={annotation.url} target="_blank" rel="noopener noreferrer nofollow" onClick={confirmLeave}>{t('Открыть на Genius','Open on Genius')}<ExternalLink size={12}/></a>}
    </section>)}
  </article>;
}

/** Right-hand column inside the lyrics view (a bottom sheet on phones). */
const paragraphs=(text:string)=>text.split(/\n{2,}|\n/).map(part=>part.trim()).filter(Boolean);
/** Translates fragments and annotation paragraphs in one line-preserving request. */
function useTranslatedReferents(referents:GeniusReferent[],target:string|undefined,open:boolean){
  const [state,setState]=useState<{key:string;value:Map<number,{fragment:string;bodies:string[][]}>}|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
  const key=target?`${target}:${referents.map(r=>`${r.id}:${r.fragment}:${r.annotations.map(a=>a.plain).join('|')}`).join('~')}`:'';
  useEffect(()=>{
    if(!target||!open||!referents.length||state?.key===key)return;
    const texts:string[]=[],slots:Array<[number,number,number]>=[];// [referent, annotation(-1 = fragment), paragraph]
    referents.forEach((referent,r)=>{texts.push(referent.fragment.replace(/\n+/g,' / '));slots.push([r,-1,0]);referent.annotations.forEach((annotation,a)=>paragraphs(annotation.plain).forEach((paragraph,p)=>{texts.push(paragraph);slots.push([r,a,p]);}));});
    const controller=new AbortController();setBusy(true);setFailed(false);
    apiClient.translateLyrics(texts,target,controller.signal).then(result=>{
      // Fragments and notes can be in different languages (a Russian line, an English note), so each
      // piece counts as translated only when the translation actually differs from the original.
      const same=(a:string,b:string)=>a.replace(/\s+/g,' ').trim().toLocaleLowerCase()===b.replace(/\s+/g,' ').trim().toLocaleLowerCase();
      const value=new Map<number,{fragment:string;bodies:string[][]}>();
      result.translations.forEach((text,i)=>{const [r,a,p]=slots[i],id=referents[r].id,entry=value.get(id)||{fragment:'',bodies:referents[r].annotations.map(()=>[])};const changed=!same(text,texts[i]);if(a<0)entry.fragment=changed?text:'';else entry.bodies[a][p]=changed?text:'';value.set(id,entry);});
      for(const entry of value.values())entry.bodies=entry.bodies.map(body=>body.some(Boolean)?body.map((text,p)=>text||''):[]);
      if(!controller.signal.aborted)setState({key,value});
    }).catch(()=>{if(!controller.signal.aborted)setFailed(true);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>{controller.abort();setBusy(false);};
  },[key,target,open,referents,state?.key,retry]);
  return {translated:state?.key===key?state.value:undefined,busy,failed,retry:()=>setRetry(v=>v+1)};
}

const luma=([r,g,b]:Rgb)=>r*.2126+g*.7152+b*.0722;
/** A cover colour scaled to at most `limit` luminance (white text stays readable on it), as `r g b` for rgb(). */
const shade=(color:Rgb,limit:number)=>{const k=Math.min(1,limit/Math.max(.001,luma(color)));return color.map(c=>Math.round(c*k*255)).join(' ');};
/** The light accent: the brightest cover colour lifted towards white until it reads on the dark surface. */
const lift=(color:Rgb)=>{const k=Math.max(0,.72-luma(color))/.72;return color.map(c=>Math.round((c+(1-c)*k)*255)).join(' ');};
/** The panel takes the colours of the playing cover instead of a fixed dark slate. */
function useCoverTint(artwork?:string):React.CSSProperties|undefined{
  const [palette,setPalette]=useState<Rgb[]|null>(null);
  useEffect(()=>{let live=true;setPalette(null);if(artwork)void paletteFromArtwork(artwork).then(colors=>{if(live)setPalette(colors);});return()=>{live=false;};},[artwork]);
  if(!palette||palette.length<4)return undefined;
  return {'--genius-surface-a':`rgb(${shade(palette[2],.2)} / .9)`,'--genius-surface-b':`rgb(${shade(palette[1],.12)} / .94)`,'--genius-surface-c':`rgb(${shade(palette[0],.08)} / .95)`,'--genius-accent':`rgb(${lift(palette[3])})`} as React.CSSProperties;
}

export function GeniusDrawer({open,line,referents,song,onClose,translateTo,artwork}:{open:boolean;line?:string;referents:GeniusReferent[];song?:GeniusAnnotationSet['song'];onClose:()=>void;translateTo?:string;artwork?:string}){
  const tint=useCoverTint(artwork),language=useLanguageStore(s=>s.language);
  // Notes are translated into the interface language by default; the choice is kept per account.
  const [translateNotes,setTranslateNotes]=useState(()=>{try{return localStorage.getItem(scopedStorageKey('genius-translate'))!=='0';}catch{return true;}});
  const toggleTranslate=()=>setTranslateNotes(value=>{try{localStorage.setItem(scopedStorageKey('genius-translate'),value?'0':'1');}catch{/* storage may be unavailable */}return !value;});
  const {translated,busy,failed,retry}=useTranslatedReferents(referents,translateNotes?language:undefined,open);
  const t=useTranslation(),closeRef=useRef<HTMLButtonElement>(null),bodyRef=useRef<HTMLDivElement>(null),returnTo=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(!open)return;
    returnTo.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    closeRef.current?.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();onClose();}};
    window.addEventListener('keydown',key,true);
    return()=>{window.removeEventListener('keydown',key,true);if(returnTo.current?.isConnected)returnTo.current.focus({preventScroll:true});};
  },[open,onClose]);
  useEffect(()=>{if(open)bodyRef.current?.scrollTo({top:0});},[open,referents]);
  return <aside className="genius-drawer" style={tint} data-tinted={tint?'true':undefined} data-open={open?'true':'false'} aria-hidden={!open} aria-label={t('Аннотации Genius','Genius annotations')} onClick={event=>event.stopPropagation()}>
    <header><span className="genius-drawer-title"><GeniusMark size={18}/><span><b>{t('Аннотации','Annotations')}</b>{song&&<small>{song.artist} — {song.title}</small>}</span></span><span className="genius-drawer-tools"><button type="button" className={`genius-drawer-translate${translateNotes?' is-on':''}`} onClick={toggleTranslate} tabIndex={open?0:-1} aria-pressed={translateNotes} title={translateNotes?t('Показать оригинал','Show original'):t('Перевести аннотации','Translate annotations')}><Languages size={15}/><span>{translateNotes?t('Перевод','Translated'):t('Оригинал','Original')}</span></button><button ref={closeRef} type="button" className="genius-drawer-close" onClick={onClose} tabIndex={open?0:-1} aria-label={t('Закрыть аннотации','Close annotations')}><X size={17}/></button></span></header>
    {line&&<p className="genius-drawer-line">{line}</p>}
    <div ref={bodyRef} className="genius-drawer-body">{busy&&<div className="genius-translating"><UniqueLoading size="sm" label={t('Переводим аннотацию…','Translating annotation…')}/></div>}{failed&&<button className="text-button" onClick={retry}>{t("Перевод недоступен · повторить","Translation unavailable · retry")}</button>}<div key={referents.map(referent=>referent.id).join(',')} className="genius-drawer-content">{referents.map(referent=><Referent key={referent.id} referent={referent} translated={translated?.get(referent.id)}/>)}</div></div>
  </aside>;
}
