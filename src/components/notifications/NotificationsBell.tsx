import React from 'react';
import {useNavigate} from 'react-router-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Bell,CheckCheck} from 'lucide-react';
import {communityApi,type AppNotification} from '../../api/communityClient.js';
import {useTranslation,useLanguageStore} from '../../stores/useLanguageStore.js';
import '../../styles/community.css';

const ago=(iso:string,language:string)=>{const m=Math.round((Date.now()-Date.parse(iso))/60000),rtf=new Intl.RelativeTimeFormat(language==='en'?'en':'ru',{numeric:'auto'});return m<60?rtf.format(-m,'minute'):m<1440?rtf.format(-Math.round(m/60),'hour'):rtf.format(-Math.round(m/1440),'day');};

/** Header indicator for follow/unreleased notifications; polling also triggers the server's release check. */
export function NotificationsBell(){
 const t=useTranslation(),language=useLanguageStore(s=>s.language),navigate=useNavigate(),client=useQueryClient();
 const [open,setOpen]=React.useState(false),wrap=React.useRef<HTMLDivElement>(null);
 const query=useQuery({queryKey:['notifications'],queryFn:communityApi.notifications,refetchInterval:5*60*1000,refetchOnWindowFocus:true,staleTime:60*1000,retry:false});
 React.useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!wrap.current?.contains(e.target as Node))setOpen(false);},esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',esc);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',esc);};},[open]);
 const unread=query.data?.unread||0,items=query.data?.items||[];
 const read=async(ids?:string[])=>{await communityApi.markRead(ids).catch(()=>{});void client.invalidateQueries({queryKey:['notifications']});};
 const pick=(n:AppNotification)=>{setOpen(false);if(!n.readAt)void read([n.id]);if(n.url)navigate(n.url);};
 return <div className="notify-wrap" ref={wrap}>
  <button className="icon-button notify-button" aria-label={unread?t(`Уведомления: ${unread} новых`,`Notifications: ${unread} new`):t('Уведомления','Notifications')} aria-expanded={open} onClick={()=>{setOpen(v=>!v);if(!open)void query.refetch();}}><Bell size={18}/>{unread>0&&<b className="notify-count">{unread>9?'9+':unread}</b>}</button>
  {open&&<div className="notify-panel" role="dialog" aria-label={t('Уведомления','Notifications')}>
   <header><strong>{t('Уведомления','Notifications')}</strong>{unread>0&&<button className="text-button" onClick={()=>void read()}><CheckCheck size={14}/>{t('Прочитать все','Mark all read')}</button>}</header>
   {items.length?<ul>{items.map(n=><li key={n.id}><button className={n.readAt?'':'is-unread'} onClick={()=>pick(n)}>
    {n.artworkUrl?<img src={n.artworkUrl} alt="" referrerPolicy="no-referrer"/>:<span className="notify-glyph" aria-hidden="true"><Bell size={14}/></span>}
    <span><strong>{n.title}</strong>{n.body&&<small>{n.body}</small>}<time dateTime={n.createdAt}>{ago(n.createdAt,language)}</time></span>
   </button></li>)}</ul>:<p className="notify-empty">{query.isPending?t('Загружаем…','Loading…'):t('Подпишитесь на артистов — здесь появятся их новые релизы и анрелизы.','Follow artists to see their new releases and unreleased tracks here.')}</p>}
  </div>}
 </div>;
}
