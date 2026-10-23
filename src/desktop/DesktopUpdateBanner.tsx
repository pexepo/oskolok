import React,{useEffect,useState} from 'react';
import {Download,RefreshCw,X} from 'lucide-react';
import {useTranslation} from '../stores/useLanguageStore.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';

/** Desktop shell update (electron/updater.cjs): downloaded in the background, applied on «Перезапустить» or on quit. */
type UpdateState={state:'idle'|'downloading'|'ready'|'manual';version?:string;progress?:number;changelog?:string;url?:string};
interface UpdateBridge{updateState?:()=>Promise<UpdateState|null>;installUpdate?:()=>void;onUpdate?:(cb:(s:UpdateState)=>void)=>()=>void}
const bridge=():UpdateBridge|undefined=>(window as unknown as {oskolokDesktop?:UpdateBridge}).oskolokDesktop;

export function DesktopUpdateBanner(){
  const t=useTranslation(),[state,setState]=useState<UpdateState|null>(null),[hidden,setHidden]=useState('');
  const playing=usePlayerStore(s=>s.isPlaying);
  useEffect(()=>{const b=bridge();if(!b?.onUpdate)return;void b.updateState?.().then(s=>{if(s)setState(s);});return b.onUpdate(setState);},[]);
  if(!state||state.state==='idle'||state.state==='downloading'||hidden===state.version)return null;
  return <div className="desktop-update" role="status">
    <span className="desktop-update__icon" aria-hidden="true">{state.state==='ready'?<RefreshCw size={16}/>:<Download size={16}/>}</span>
    <div className="desktop-update__text">
      <b>{t(`Осколок ${state.version} готов`,`Oskolok ${state.version} is ready`)}</b>
      <small>{state.state==='ready'?(playing?t('Установится, когда закроете приложение — или перезапустите сейчас','Installs when you close the app — or restart now'):t('Перезапуск займёт пару секунд','Restart takes a couple of seconds')):t('Перенесите Осколок в «Программы», чтобы обновления ставились сами','Move Oskolok to Applications so updates install by themselves')}</small>
    </div>
    {state.state==='ready'
      ?<button type="button" className="desktop-update__go" onClick={()=>bridge()?.installUpdate?.()}>{t('Перезапустить','Restart')}</button>
      :<a className="desktop-update__go" href={state.url} target="_blank" rel="noreferrer">{t('Скачать','Download')}</a>}
    <button type="button" className="desktop-update__close" aria-label={t('Позже','Later')} title={t('Позже','Later')} onClick={()=>setHidden(state.version||'x')}><X size={15}/></button>
  </div>;
}
