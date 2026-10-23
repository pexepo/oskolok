import React from 'react';
import {Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {Search,Users,Contact,Radio,X} from 'lucide-react';
import {friendsApi,type Person,type Relation} from '../api/friendsApi.js';
import {FriendButton,TogetherButtons} from '../components/friends/FriendButton.js';
import {FriendJams} from '../components/connect/JamLayer.js';
import {fetchJamOverview,useJamStore} from '../connect/jam.js';
import {LoadingState} from '../components/common/LoadingState.js';
import {useTranslation} from '../stores/useLanguageStore.js';

function PersonRow({person,onRelation}:{person:Person;onRelation?:(r:Relation)=>void}){
 const t=useTranslation();
 return <li className="person-row">
  <Link to={`/users/${encodeURIComponent(person.publicId)}`} className="person-row-main">
   {person.avatarUrl?<img src={person.avatarUrl} alt="" className="person-avatar" loading="lazy"/>:<span className="person-avatar person-avatar--letter" aria-hidden="true">{person.displayName.slice(0,1)}</span>}
   <span className="person-row-copy"><strong>{person.displayName}</strong>
    {person.listening?<small className="person-listening"><Radio size={12} aria-hidden="true"/>{person.listening.artist?`${person.listening.artist} — `:''}{person.listening.title}</small>:<small>{person.username?`@${person.username}`:t('без username','no username')}</small>}
   </span>
  </Link>
  {person.relation==='friends'&&<TogetherButtons publicId={person.publicId} name={person.displayName} compact/>}
  <FriendButton publicId={person.publicId} relation={person.relation} onChange={onRelation} compact/>
 </li>;
}

export function FriendsPage(){
 const t=useTranslation();
 const lists=useQuery({queryKey:['friends'],queryFn:friendsApi.lists,refetchInterval:30000});
 const inJam=useJamStore(s=>!!s.jam),jams=useQuery({queryKey:['jam','overview'],queryFn:fetchJamOverview,refetchInterval:20000,enabled:!inJam});
 // Leaving or ending a jam changes who hosts one: the list is fetched again, not shown from before.
 React.useEffect(()=>{if(!inJam)void jams.refetch();},[inJam]);
 const [q,setQ]=React.useState(''),[results,setResults]=React.useState<Person[]|null>(null),[searching,setSearching]=React.useState(false);
 const [contacts,setContacts]=React.useState<{connected:boolean;people:Person[]}|null>(null),[contactsBusy,setContactsBusy]=React.useState(false),[contactsError,setContactsError]=React.useState('');
 React.useEffect(()=>{
  const term=q.trim();
  if(term.replace(/^@/,'').length<2){setResults(null);setSearching(false);return;}
  const controller=new AbortController();setSearching(true);
  const timer=setTimeout(()=>{friendsApi.search(term,controller.signal).then(setResults).catch(()=>{}).finally(()=>setSearching(false));},280);
  return()=>{clearTimeout(timer);controller.abort();};
 },[q]);
 const loadContacts=async()=>{setContactsBusy(true);setContactsError('');try{setContacts(await friendsApi.contacts());}catch(e){setContactsError((e as Error).message);}finally{setContactsBusy(false);}};
 const patch=(list:Person[]|null,id:string,relation:Relation)=>list?.map(p=>p.publicId===id?{...p,relation}:p)||null;
 const data=lists.data;
 return <div className="friends-page">
  <header className="friends-head"><h1>{t('Друзья','Friends')}</h1><p>{t('Находите слушателей Осколка и смотрите, что они слушают.','Find Oskolok listeners and see what they play.')}</p></header>

  <label className="friends-search"><Search size={18} aria-hidden="true"/><input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder={t('@username или ник','@username or nickname')} aria-label={t('Найти слушателя','Find a listener')} autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search"/>{q&&<button type="button" className="icon-button" aria-label={t('Очистить','Clear')} onClick={()=>setQ('')}><X size={16}/></button>}</label>

  {results!==null&&<section className="friends-section" aria-live="polite">
   <h2>{t('Результаты','Results')}</h2>
   {searching&&!results.length?<LoadingState size="sm" label={t('Ищем…','Searching…')}/>:results.length?<ul className="person-list">{results.map(p=><PersonRow key={p.userId} person={p} onRelation={r=>setResults(prev=>patch(prev,p.publicId,r))}/>)}</ul>:<p className="friends-empty">{t('Никого не нашли. Проверьте @username — он такой же, как в Telegram.','Nobody found. Check the @username — it matches Telegram.')}</p>}
  </section>}

  {!!data?.incoming.length&&<section className="friends-section"><h2>{t('Заявки','Requests')} · {data.incoming.length}</h2><ul className="person-list">{data.incoming.map(p=><PersonRow key={p.userId} person={p} onRelation={()=>void lists.refetch()}/>)}</ul></section>}

  {!!jams.data?.friends.length&&!inJam&&<section className="friends-section"><h2>{t('Сейчас в Jam','In a Jam now')}</h2><FriendJams jams={jams.data.friends}/></section>}
  <section className="friends-section">
   <h2>{t('Мои друзья','My friends')}{data?` · ${data.friends.length}`:''}</h2>
   {lists.isPending?<LoadingState size="sm" label={t('Загружаем друзей…','Loading friends…')}/>:data?.friends.length?<ul className="person-list">{data.friends.map(p=><PersonRow key={p.userId} person={p} onRelation={()=>void lists.refetch()}/>)}</ul>:<p className="friends-empty">{t('Пока никого. Найдите друзей по @username или в контактах Telegram.','Nobody yet. Find friends by @username or in your Telegram contacts.')}</p>}
  </section>

  <section className="friends-section friends-contacts">
   <h2><Contact size={18} aria-hidden="true"/>{t('Контакты из Telegram','Telegram contacts')}</h2>
   {!contacts?<><p>{t('Покажем, кто из ваших контактов уже пользуется Осколком. Список читается через вашу сессию Telegram и нигде не сохраняется.','We show which of your contacts already use Oskolok. The list is read through your Telegram session and never stored.')}</p><button type="button" className="friend-btn friend-btn--primary" disabled={contactsBusy} onClick={()=>void loadContacts()}><Users size={15}/>{contactsBusy?t('Смотрим контакты…','Checking contacts…'):t('Найти в контактах','Find in contacts')}</button>{contactsError&&<p role="alert" className="friends-empty">{contactsError}</p>}</>
   :!contacts.connected?<p>{t('Для этого нужна сессия Telegram.','This needs a Telegram session.')} <Link to="/profile?tab=settings#telegram-connection">{t('Подключить в профиле','Connect in profile')}</Link></p>
   :contacts.people.length?<ul className="person-list">{contacts.people.map(p=><PersonRow key={p.userId} person={p} onRelation={r=>setContacts(prev=>prev&&{...prev,people:patch(prev.people,p.publicId,r)||[]})}/>)}</ul>
   :<p className="friends-empty">{t('Пока никто из ваших контактов не пользуется Осколком.','None of your contacts use Oskolok yet.')}</p>}
  </section>

  {!!data?.outgoing.length&&<section className="friends-section friends-section--quiet"><h2>{t('Отправленные заявки','Sent requests')} · {data.outgoing.length}</h2><ul className="person-list">{data.outgoing.map(p=><PersonRow key={p.userId} person={p} onRelation={()=>void lists.refetch()}/>)}</ul></section>}
 </div>;
}
