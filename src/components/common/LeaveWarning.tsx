import React from 'react';
import {createPortal} from 'react-dom';
import {create} from 'zustand';
import {motion,AnimatePresence,useReducedMotion} from 'framer-motion';
import {ArrowLeft,ExternalLink,ShieldAlert} from 'lucide-react';
import {useTranslation} from '../../stores/useLanguageStore.js';

/** Links inside community content (Genius annotations) leave Осколок through this page. */
export const useLeaveStore=create<{url:string|null;open:(url:string)=>void;close:()=>void}>(set=>({url:null,open:url=>set({url}),close:()=>set({url:null})}));

/** Click handler for an external anchor: stops the navigation and asks first. */
export function confirmLeave(event:React.MouseEvent<HTMLAnchorElement>){
 const href=event.currentTarget.href;
 if(!href||event.button!==0)return;
 event.preventDefault();event.stopPropagation();
 useLeaveStore.getState().open(href);
}

export function LeaveWarning(){
 const t=useTranslation(),url=useLeaveStore(s=>s.url),close=useLeaveStore(s=>s.close),reduced=useReducedMotion(),stay=React.useRef<HTMLButtonElement>(null);
 let host='';try{host=url?new URL(url).hostname.replace(/^www\./,''):'';}catch{host='';}
 React.useEffect(()=>{
  if(!url)return;
  const previous=document.activeElement as HTMLElement|null;
  requestAnimationFrame(()=>stay.current?.focus());
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}};
  document.addEventListener('keydown',key,true);
  return()=>{document.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus();};
 },[url,close]);
 const go=()=>{if(url)window.open(url,'_blank','noopener,noreferrer');close();};
 return createPortal(<AnimatePresence>{url&&<motion.div className="leave-page" role="dialog" aria-modal="true" aria-labelledby="leave-title" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduced?0:.22}}>
  <motion.div className="leave-card" initial={{y:reduced?0:16,scale:reduced?1:.97}} animate={{y:0,scale:1}} exit={{y:reduced?0:10,scale:reduced?1:.98}} transition={{duration:reduced?0:.3,ease:[.22,1,.36,1]}}>
   <span className="leave-icon" aria-hidden="true"><ShieldAlert size={26}/></span>
   <h2 id="leave-title">{t('Вы покидаете Осколок','You are leaving Oskolok')}</h2>
   <p>{t('Ссылка из аннотации ведёт на сторонний сайт. Мы не проверяем его содержимое — убедитесь, что доверяете ему.','This annotation link leads to another website. We do not check its content — make sure you trust it.')}</p>
   <div className="leave-url"><strong>{host||t('Внешний сайт','External site')}</strong><span>{url}</span></div>
   <div className="leave-actions">
    <button ref={stay} type="button" className="secondary-button" onClick={close}><ArrowLeft size={16}/>{t('Остаться','Stay')}</button>
    <button type="button" className="primary-button" onClick={go}>{t('Перейти','Continue')}<ExternalLink size={15}/></button>
   </div>
  </motion.div>
 </motion.div>}</AnimatePresence>,document.body);
}
