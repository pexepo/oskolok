import React from 'react';
import {NavLink} from 'react-router-dom';
import {Home,Search,Library,User,Settings} from 'lucide-react';
import {useTelegramStore} from '../../telegram/runtime.js';
export const OskolokHeader:React.FC<{onOpenSettings?:()=>void}>=({onOpenSettings})=>{
  const user=useTelegramStore(s=>s.user);
  return <header className="visible-header" style={{WebkitAppRegion:'drag'} as React.CSSProperties}>
    <NavLink to="/" className="visible-brand" aria-label="Осколок — главная"><img src="/logo.png" alt=""/><span>осколок</span></NavLink>
    <nav className="visible-nav" aria-label="Основная навигация">{[{to:'/',title:'Главная',icon:Home},{to:'/search',title:'Поиск',icon:Search},{to:'/collection',title:'Коллекция',icon:Library},{to:'/profile',title:'Профиль',icon:User}].map(({to,title,icon:Icon})=><NavLink to={to} end={to==='/'} key={to}><Icon size={18}/><span>{title}</span></NavLink>)}</nav>
    <div className="visible-header-actions"><NavLink to="/profile" className="header-avatar" aria-label="Мой профиль">{user?.photo_url?<img src={user.photo_url} alt=""/>:<User size={19}/>}</NavLink><button className="icon-button" onClick={onOpenSettings} aria-label="Настройки плеера"><Settings size={20}/></button></div>
  </header>;
};
