import React from 'react';
import {NavLink} from 'react-router-dom';
import {Home,Search,Library,User,Settings,ChevronDown,ExternalLink,LogOut,Pencil} from 'lucide-react';
import {useTelegramStore} from '../../telegram/runtime.js';
import {apiClient} from '../../api/apiClient.js';
export const OskolokHeader:React.FC<{onOpenSettings?:()=>void}>=({onOpenSettings})=>{
  const user=useTelegramStore(s=>s.user);
  const [accountOpen,setAccountOpen]=React.useState(false);
  const [loggingOut,setLoggingOut]=React.useState(false);
  const accountRef=React.useRef<HTMLDivElement>(null);
  React.useEffect(()=>{
    const onPointerDown=(event:PointerEvent)=>{if(!accountRef.current?.contains(event.target as Node))setAccountOpen(false);};
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')setAccountOpen(false);};
    document.addEventListener('pointerdown',onPointerDown);document.addEventListener('keydown',onKeyDown);
    return()=>{document.removeEventListener('pointerdown',onPointerDown);document.removeEventListener('keydown',onKeyDown);};
  },[]);
  const logout=async()=>{if(loggingOut)return;setLoggingOut(true);try{await apiClient.request('/profile/logout',{method:'POST',body:'{}'});useTelegramStore.setState({user:null});location.reload();}catch{setLoggingOut(false);}};
  return <header className="visible-header" style={{WebkitAppRegion:'drag'} as React.CSSProperties}>
    <NavLink to="/" className="visible-brand" aria-label="Осколок — главная"><img src="/logo.png" alt=""/><span>осколок</span></NavLink>
    <nav className="visible-nav" aria-label="Основная навигация">{[{to:'/',title:'Главная',icon:Home},{to:'/search',title:'Поиск',icon:Search},{to:'/collection',title:'Коллекция',icon:Library}].map(({to,title,icon:Icon})=><NavLink to={to} end={to==='/'} key={to}><Icon size={18}/><span>{title}</span></NavLink>)}</nav>
    <div className="visible-header-actions"><div className="account-menu-wrap" ref={accountRef}><button className="header-avatar account-avatar" aria-label="Меню профиля" aria-expanded={accountOpen} onClick={()=>setAccountOpen(open=>!open)}>{user?.photo_url?<img src={user.photo_url} alt=""/>:<User size={19}/>}<ChevronDown size={12} className="account-chevron"/></button>{accountOpen&&<div className="account-menu" role="menu"><NavLink to={user?.id?`/users/telegram%3A${encodeURIComponent(user.id)}`:'/profile'} role="menuitem" onClick={()=>setAccountOpen(false)}><ExternalLink size={16}/>Посмотреть профиль</NavLink><NavLink to="/profile" role="menuitem" onClick={()=>setAccountOpen(false)}><Pencil size={16}/>Редактировать профиль</NavLink><button role="menuitem" disabled={loggingOut} onClick={()=>void logout()}><LogOut size={16}/>{loggingOut?'Выходим…':'Выход из аккаунта'}</button></div>}</div><button className="icon-button" onClick={onOpenSettings} aria-label="Настройки плеера"><Settings size={20}/></button></div>
  </header>;
};
