import React from 'react';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {isNewBuild,canApplyUpdate} from '../../utils/appUpdates.js';

export function AppUpdates(){
  const t=useTranslation(),playing=usePlayerStore(s=>s.isPlaying),[ready,setReady]=React.useState(false);
  React.useEffect(()=>{
    let controller:AbortController|undefined,checking=false;
    const check=async()=>{
      if(checking||document.hidden||import.meta.env.DEV)return;
      checking=true;
      controller=new AbortController();
      const timeout=setTimeout(()=>controller?.abort(),10000);
      try{
        const response=await fetch('/version.json',{cache:'no-store',signal:controller.signal});
        if(response.ok&&isNewBuild(await response.json(),import.meta.env.VITE_APP_BUILD_ID))setReady(true);
      }catch{/* Offline playback must not fail because an update check failed. */}finally{clearTimeout(timeout);checking=false;}
    };
    const first=setTimeout(()=>void check(),15000),interval=setInterval(()=>void check(),180000);
    const visible=()=>{if(!document.hidden)void check();};
    document.addEventListener('visibilitychange',visible);
    return()=>{controller?.abort();clearTimeout(first);clearInterval(interval);document.removeEventListener('visibilitychange',visible);};
  },[]);
  React.useEffect(()=>{
    if(!ready||playing)return;
    const apply=()=>{
      if(document.hidden)return;
      const active=document.activeElement;
      const dirty=!!active?.matches('input,textarea,[contenteditable=true]')||[...document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input:not([type=hidden]):not([type=range]),textarea')].some(field=>field.value!==field.defaultValue);
      if(canApplyUpdate(usePlayerStore.getState().isPlaying,dirty,!!document.querySelector('[role=dialog]')))location.reload();
    };
    const timer=setInterval(apply,10000);return()=>clearInterval(timer);
  },[ready,playing]);
  return ready?<div className="app-update-notice" role="status"><span>{t('Обновление готово','Update ready')}</span><button onClick={()=>location.reload()}>{t('Обновить','Update')}</button></div>:null;
}
