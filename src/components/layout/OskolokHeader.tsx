import React from 'react';
import {useReportStore} from '../common/ReportDialog.js';
import {useTranslation,useLanguageStore} from '../../stores/useLanguageStore.js';
import {NavLink,useLocation,useNavigate} from 'react-router-dom';
import {Home,Search,Library,User,Users,Settings,ChevronDown,ExternalLink,LogOut,Pencil,Disc3,Bug} from 'lucide-react';
import {useQuery} from '@tanstack/react-query';
import {friendsApi} from '../../api/friendsApi.js';
import {openPageReport} from '../common/ReportProblemButton.js';
import {useTelegramStore} from '../../telegram/runtime.js';
import {apiClient} from '../../api/apiClient.js';
import {LiquidLensFilter} from '../ui/liquid-glass.js';
import {NotificationsBell} from '../notifications/NotificationsBell.js';
import {SoonBadge} from '../common/SoonBadge.js';
import {UNRELEASED_OPEN} from '../../config/beta.js';
export const OskolokHeader:React.FC<{onOpenSettings?:()=>void}>=({onOpenSettings})=>{
  const t=useTranslation(),language=useLanguageStore(s=>s.language);
  const user=useTelegramStore(s=>s.user);
  const [accountOpen,setAccountOpen]=React.useState(false);
  const [loggingOut,setLoggingOut]=React.useState(false);
  // Bumping the key replays the assembly animation, as in the reference.
  const [logoKey,setLogoKey]=React.useState(0);
  const accountRef=React.useRef<HTMLDivElement>(null);
  // The active tab is marked by one glass droplet that slides between items.
  const navRef=React.useRef<HTMLElement>(null),route=useLocation(),[lens,setLens]=React.useState<{x:number;w:number}|null>(null);
  React.useLayoutEffect(()=>{
    const nav=navRef.current;if(!nav)return;
    const place=()=>{const active=nav.querySelector<HTMLElement>('a.active'),box=active?.getBoundingClientRect();setLens(box?.width?{x:box.left-nav.getBoundingClientRect().left,w:box.width}:null);};
    place();const observer=new ResizeObserver(place);observer.observe(nav);nav.querySelectorAll('a').forEach(item=>observer.observe(item));void document.fonts?.ready.then(place);
    return()=>observer.disconnect();
  },[route.pathname,language]);
  /* iOS-style tab blob: press anywhere on the bar and drag; the droplet follows the finger, stretches with speed,
     and on release springs to the nearest tab and opens it. A plain tap still works as a normal link. */
  const navigate=useNavigate(),[drag,setDrag]=React.useState<{x:number;w:number;sx:number;pressed:boolean;dragging:boolean}|null>(null);
  const gesture=React.useRef<{id:number;startX:number;lastX:number;lastT:number;items:Array<{c:number;w:number;href:string}>;left:number;moved:boolean}|null>(null),swallowClick=React.useRef(false);
  const settleTimer=React.useRef<ReturnType<typeof setTimeout>>();
  React.useEffect(()=>()=>clearTimeout(settleTimer.current),[]);
  const itemsOf=(nav:HTMLElement)=>{const left=nav.getBoundingClientRect().left;return [...nav.querySelectorAll<HTMLAnchorElement>('a')].map(a=>{const box=a.getBoundingClientRect();return {c:box.left-left+box.width/2,w:box.width,href:a.getAttribute('href')||'/'};}).filter(item=>item.w>0);};
  const placeAt=(px:number,items:Array<{c:number;w:number}>)=>{
    const c=Math.max(items[0].c,Math.min(items[items.length-1].c,px));
    let i=0;while(i<items.length-2&&c>items[i+1].c)i++;
    const a=items[i],b=items[Math.min(i+1,items.length-1)],k=b.c===a.c?0:(c-a.c)/(b.c-a.c);
    return {c,w:a.w+(b.w-a.w)*k};
  };
  const navHandlers={
    onPointerDown:(e:React.PointerEvent<HTMLElement>)=>{
      if(e.button!==0||!navRef.current)return;
      clearTimeout(settleTimer.current);swallowClick.current=false;
      const nav=navRef.current,items=itemsOf(nav);if(items.length<2)return;
      const left=nav.getBoundingClientRect().left;
      gesture.current={id:e.pointerId,startX:e.clientX,lastX:e.clientX,lastT:performance.now(),items,left,moved:false};
      const p=placeAt(e.clientX-left,items);setDrag({x:lens?lens.x+lens.w/2:p.c,w:lens?.w||p.w,sx:1,pressed:true,dragging:false});
    },
    onPointerMove:(e:React.PointerEvent<HTMLElement>)=>{
      const g=gesture.current;if(!g||g.id!==e.pointerId)return;
      if(!g.moved&&Math.abs(e.clientX-g.startX)<6)return;
      if(!g.moved){g.moved=true;(e.currentTarget as Element).setPointerCapture(e.pointerId);}
      const now=performance.now(),v=(e.clientX-g.lastX)/Math.max(1,now-g.lastT)*1000;g.lastX=e.clientX;g.lastT=now;
      const p=placeAt(e.clientX-g.left,g.items);
      const left=g.items[0].c-g.items[0].w/2,right=g.items[g.items.length-1].c+g.items[g.items.length-1].w/2;
      const sx=1+Math.min(.18,Math.abs(v)/3600),half=p.w*sx/2;
      setDrag({x:Math.max(left+half+1,Math.min(right-half-1,p.c)),w:p.w,sx,pressed:true,dragging:true});
    },
    onPointerUp:(e:React.PointerEvent<HTMLElement>)=>{
      const g=gesture.current;if(!g||g.id!==e.pointerId)return;gesture.current=null;
      if(g.moved){
        const x=e.clientX-g.left,best=g.items.reduce((a,b)=>Math.abs(b.c-x)<Math.abs(a.c-x)?b:a);
        swallowClick.current=true;setDrag({x:best.c,w:best.w,sx:1,pressed:false,dragging:false});
        settleTimer.current=setTimeout(()=>{setDrag(null);swallowClick.current=false;},550);
        if(best.href!==route.pathname)navigate(best.href);
      }else setDrag(null);
    },
    onPointerCancel:()=>{gesture.current=null;setDrag(null);},
    onDragStart:(e:React.DragEvent)=>e.preventDefault(),
    onClickCapture:(e:React.MouseEvent)=>{if(swallowClick.current){swallowClick.current=false;e.preventDefault();e.stopPropagation();}},
  };
  const lensBox=drag?{x:drag.x-drag.w/2,w:drag.w}:lens;
  // Pending friend requests light up the round Friends tab.
  const incoming=useQuery({queryKey:['friends'],queryFn:friendsApi.lists,refetchInterval:60000,staleTime:30000,enabled:!!user}).data?.incoming.length||0;
  React.useEffect(()=>{
    const onPointerDown=(event:PointerEvent)=>{if(!accountRef.current?.contains(event.target as Node))setAccountOpen(false);};
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')setAccountOpen(false);};
    document.addEventListener('pointerdown',onPointerDown);document.addEventListener('keydown',onKeyDown);
    return()=>{document.removeEventListener('pointerdown',onPointerDown);document.removeEventListener('keydown',onKeyDown);};
  },[]);
  const logout=async()=>{if(loggingOut)return;setLoggingOut(true);try{await apiClient.request('/profile/logout',{method:'POST',body:'{}'});useTelegramStore.setState({user:null});location.reload();}catch{setLoggingOut(false);}};
  return <header className="visible-header" style={{WebkitAppRegion:'drag'} as React.CSSProperties}>
    <NavLink to="/" className="visible-brand" aria-label={t('Осколок — главная', 'Oskolok — home')} onClick={()=>setLogoKey(k=>k+1)}><span className="brand-logo" key={logoKey} aria-hidden="true"><img className="brand-logo-half brand-logo-top" src="/logo-128.png" alt="" draggable={false}/><img className="brand-logo-half brand-logo-bottom" src="/logo-128.png" alt="" draggable={false}/></span><span className="brand-word">{language==='en'?'Oskolok':'Осколок'}</span></NavLink>
    <LiquidLensFilter id="nav-liquid-glass" scale={34} edge={.16}/><LiquidLensFilter id="nav-liquid-lens" scale={22} edge={.3}/>
    <nav ref={navRef} {...navHandlers} className={`visible-nav liquid-nav${drag?.dragging?' is-dragging':''}`} aria-label={t('Основная навигация', 'Main navigation')}><span className="liquid-nav-sheen" aria-hidden="true"/>{lensBox&&<span className={`liquid-nav-lens${drag?.pressed?' is-pressed':''}${drag?.dragging?' is-dragging':''}`} aria-hidden="true" style={{width:lensBox.w,transform:`translateX(${lensBox.x}px) scale(${drag?.sx??1},${drag?.sx?1/Math.sqrt(drag.sx):1})`}}/>}{[{to:'/',title:t('Главная','Home'),icon:Home},{to:'/search',title:t('Поиск','Search'),icon:Search},{to:'/collection',title:t('Коллекция','Collection'),icon:Library},{to:'/friends',title:t('Друзья','Friends'),icon:Users}].map(({to,title,icon:Icon})=><NavLink to={to} end={to==='/'} key={to} className={to==='/friends'?'desktop-nav-friends':undefined}><Icon size={18}/><span>{title}</span>{to==='/friends'&&incoming>0&&<span className="nav-friends-badge">{incoming>9?'9+':incoming}</span>}</NavLink>)}</nav>
    <NavLink to="/friends" className="friends-orb" aria-label={incoming?t(`Друзья, заявок: ${incoming}`,`Friends, ${incoming} requests`):t('Друзья','Friends')} title={t('Друзья','Friends')}><Users size={20}/>{incoming>0&&<span className="friends-orb-badge" aria-hidden="true">{incoming>9?'9+':incoming}</span>}</NavLink>
    <div className="visible-header-actions"><NotificationsBell/><div className="account-menu-wrap" ref={accountRef}><button className="header-avatar account-avatar" aria-label={t('Меню профиля', 'Profile menu')} aria-expanded={accountOpen} onClick={()=>setAccountOpen(open=>!open)}>{user?.photo_url?<img src={user.photo_url} alt=""/>:<User size={19}/>}<ChevronDown size={12} className="account-chevron"/></button>{accountOpen&&<div className="account-menu" role="menu"><NavLink to="/profile" end role="menuitem" onClick={()=>setAccountOpen(false)}><Pencil size={16}/>{t("Мой профиль","My profile")}</NavLink><NavLink to="/profile?tab=import" role="menuitem" onClick={()=>setAccountOpen(false)}><ExternalLink size={16}/>{t("Перенос музыки","Transfer music")}</NavLink><NavLink to="/unreleased" role="menuitem" onClick={()=>setAccountOpen(false)}><Disc3 size={16}/>{t("Анрелизы","Unreleased")}{!UNRELEASED_OPEN&&<SoonBadge/>}</NavLink><button role="menuitem" onClick={()=>{setAccountOpen(false);openPageReport();}}><Bug size={16}/>{t("Сообщить о проблеме","Report a problem")}</button><button role="menuitem" disabled={loggingOut} onClick={()=>void logout()}><LogOut size={16}/>{loggingOut?t('Выходим…','Signing out…'):t('Выход из аккаунта','Sign out')}</button></div>}</div><button className="icon-button" onClick={onOpenSettings} aria-label={t('Настройки плеера', 'Player settings')}><Settings size={20}/></button></div>
  </header>;
};
