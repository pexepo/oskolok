import React from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {useTranslation} from '../../stores/useLanguageStore.js';
import './carousel.css';

/** Horizontal shelf: native scroll with snap (touch, trackpad, Shift+wheel), arrow buttons on desktop. */
export function Carousel({title,count,children,className=''}:{title:React.ReactNode;count?:number;children:React.ReactNode;className?:string}){
 const t=useTranslation(),track=React.useRef<HTMLDivElement>(null);
 const [edges,setEdges]=React.useState({start:true,end:true});
 const measure=React.useCallback(()=>{const el=track.current;if(!el)return;const start=el.scrollLeft<4,end=el.scrollLeft+el.clientWidth>=el.scrollWidth-4;setEdges(e=>e.start===start&&e.end===end?e:{start,end});},[]);
 React.useEffect(()=>{const el=track.current;if(!el)return;measure();const ro=new ResizeObserver(measure);ro.observe(el);el.addEventListener('scroll',measure,{passive:true});return()=>{ro.disconnect();el.removeEventListener('scroll',measure);};},[measure,children]);
 const page=(dir:1|-1)=>{const el=track.current;if(el)el.scrollBy({left:dir*el.clientWidth*.85,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});};
 return <section className={`carousel ${className}`}>
  <div className="carousel-head">
   <h2>{title}{count!==undefined&&<small>{count}</small>}</h2>
   {!(edges.start&&edges.end)&&<div className="carousel-arrows">
    <button type="button" aria-label={t('Назад','Previous')} disabled={edges.start} onClick={()=>page(-1)}><ChevronLeft size={18}/></button>
    <button type="button" aria-label={t('Дальше','Next')} disabled={edges.end} onClick={()=>page(1)}><ChevronRight size={18}/></button>
   </div>}
  </div>
  <div className={`carousel-track${edges.start?'':' has-before'}${edges.end?'':' has-after'}`} ref={track}>{children}</div>
 </section>;
}
