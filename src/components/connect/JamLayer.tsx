import React,{useEffect,useState} from 'react';
import {useNavigate,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {UsersRound,Crown,X,Link2,UserPlus,Check,LogOut,Play,Radio} from 'lucide-react';
import {Modal} from '../common/Modal.js';
import {ArtworkImage} from '../common/ArtworkImage.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {useToastStore} from '../../stores/useToastStore.js';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {useTelegramStore} from '../../telegram/runtime.js';
import {friendsApi} from '../../api/friendsApi.js';
import {fetchJamOverview,initJam,inviteToJam,jamLink,jamTrack,joinJam,leaveJam,memberName,openJamPanel,playJamEntry,removeFromJam,startJam,useJamStore,type JamSummary,type JamView} from '../../connect/jam.js';
import './jam.css';

const Avatar=({person,size=32}:{person:{name:string;avatarUrl?:string};size?:number})=>person.avatarUrl
  ?<img className="jam-avatar" src={person.avatarUrl} alt="" style={{width:size,height:size}}/>
  :<span className="jam-avatar jam-avatar--letter" style={{width:size,height:size}} aria-hidden="true">{person.name.slice(0,1).toUpperCase()}</span>;

/** Button for the player bars: lights up in a jam, shows how many listen together. */
export function JamButton({className='',size=18}:{className?:string;size?:number}){
  const t=useTranslation(),members=useJamStore(s=>s.jam?.members.length||0),invites=useJamStore(s=>s.invites.length);
  const label=members?t(`Jam: слушаете вместе (${members})`,`Jam: listening together (${members})`):t('Jam — слушать вместе с друзьями','Jam — listen together with friends');
  return <button type="button" className={`${className} jam-button${members?' is-active':''}`} onClick={openJamPanel} title={label} aria-label={label} aria-haspopup="dialog">
    <UsersRound size={size}/>{members>0?<span className="jam-button__badge" aria-hidden="true">{members}</span>:invites>0&&<span className="jam-button__dot" aria-hidden="true"/>}
  </button>;
}

/** Friends' open jams with a «join» button (the panel and the friends page show it). */
export function FriendJams({jams}:{jams:JamSummary[]}){
  const t=useTranslation(),[busy,setBusy]=useState('');
  if(!jams.length)return null;
  return <ul className="jam-friends" aria-label={t('Друзья в Jam','Friends in a Jam')}>{jams.map(j=><li key={j.id} className="jam-friend">
    <Avatar person={j.owner} size={38}/>
    <div><strong>{t(`Jam · ${j.owner.name}`,`Jam · ${j.owner.name}`)}</strong>
      <small>{j.track?`${j.isPlaying?t('Играет','Playing'):t('Пауза','Paused')} · ${j.track.artist?.name?`${j.track.artist.name} — `:''}${j.track.title}`:t('Очередь пока пуста','The queue is empty for now')} · {t(`${j.members} слуш.`,`${j.members} listening`)}</small></div>
    <button type="button" className="sg-btn sg-btn--primary" disabled={busy===j.id} onClick={async()=>{setBusy(j.id);await joinJam(j.id);setBusy('');}}>{t('Подключиться','Join')}</button>
  </li>)}</ul>;
}

function Members({jam}:{jam:JamView}){
  const t=useTranslation();
  return <ul className="jam-members" aria-label={t('Участники','Members')}>{jam.members.map(m=><li key={m.userId} className={m.online?'':'is-away'} title={m.online?undefined:t('Не в сети — место держится полторы минуты','Offline — the seat is kept for 90 seconds')}>
    <Avatar person={m}/><span>{m.userId===jam.you?t('Вы','You'):m.name}</span>{m.owner&&<Crown size={13} aria-label={t('Владелец','Host')}/>}
  </li>)}</ul>;
}

function InviteFriends({jam}:{jam:JamView}){
  const t=useTranslation(),[sent,setSent]=useState<Set<string>>(new Set());
  const lists=useQuery({queryKey:['friends','jam-invite'],queryFn:()=>friendsApi.lists(),staleTime:30000});
  const inJam=new Set(jam.members.map(m=>m.userId));
  const friends=(lists.data?.friends||[]).filter(f=>!inJam.has(f.userId));
  if(lists.isPending)return <p className="connect-note">{t('Загружаем друзей…','Loading friends…')}</p>;
  if(!friends.length)return <p className="connect-note">{t('Позвать можно друзей Осколка — добавьте их на странице «Друзья».','You can invite your Oskolok friends — add them on the Friends page.')}</p>;
  return <ul className="jam-invite-list">{friends.map(f=><li key={f.userId}>
    <Avatar person={{name:f.displayName,avatarUrl:f.avatarUrl}} size={30}/><span>{f.displayName}</span>
    <button type="button" className="sg-btn" disabled={sent.has(f.userId)} onClick={async()=>{if(await inviteToJam(f.publicId))setSent(s=>new Set(s).add(f.userId));}}>{sent.has(f.userId)?<><Check size={14}/>{t('Позвали','Invited')}</>:<><UserPlus size={14}/>{t('Позвать','Invite')}</>}</button>
  </li>)}</ul>;
}

function SharedQueue({jam}:{jam:JamView}){
  const t=useTranslation(),isOwner=jam.ownerId===jam.you;
  if(!jam.queue.length||jam.index>=jam.queue.length)return <p className="jam-empty">{t('Очередь пуста. Добавьте трек через меню трека → «В очередь» — он сразу заиграет у всех.','The queue is empty. Add a track from its menu → “Add to queue” and it starts for everyone.')}</p>;
  const from=Math.max(0,jam.index-1),entries=jam.queue.slice(from);
  return <ol className="jam-queue" aria-label={t('Общая очередь','Shared queue')}>{entries.map((e,k)=>{
    const i=from+k,current=i===jam.index,played=i<jam.index,removable=!current&&!played&&(isOwner||e.addedBy===jam.you);
    const who=e.addedBy===jam.you?t('вы','you'):memberName(jam,e.addedBy);
    return <li key={e.key} className={current?'is-current':played?'is-played':''}>
      <button type="button" className="jam-queue__main" disabled={current} onClick={()=>playJamEntry(i)} aria-label={current?undefined:t(`Включить у всех: ${e.track.title}`,`Play for everyone: ${e.track.title}`)}>
        <ArtworkImage src={e.track.artworkUrl} alt="" className="jam-queue__art"/>
        <span><b>{e.track.title}</b><small>{e.track.artist?.name} · {current?t('сейчас у всех','playing for everyone'):t(`добавил(а): ${who}`,`added by ${who}`)}</small></span>
        {current?<Radio size={15} className="jam-queue__live" aria-hidden="true"/>:!played&&<Play size={14} className="jam-queue__play" aria-hidden="true"/>}
      </button>
      {removable&&<button type="button" className="jam-queue__remove" onClick={()=>void removeFromJam(e.key)} aria-label={t(`Убрать: ${e.track.title}`,`Remove: ${e.track.title}`)}><X size={15}/></button>}
    </li>;})}</ol>;
}

function JamPanel(){
  const t=useTranslation(),open=useJamStore(s=>s.panelOpen),jam=useJamStore(s=>s.jam),invites=useJamStore(s=>s.invites),pendingJoin=useJamStore(s=>s.pendingJoin);
  const signedIn=!!useTelegramStore(s=>s.user),local=usePlayerStore(s=>s.currentTrack);
  const [inviting,setInviting]=useState(false),[busy,setBusy]=useState(false);
  const overview=useQuery({queryKey:['jam','overview'],queryFn:fetchJamOverview,enabled:open&&signedIn&&!jam,refetchInterval:open&&!jam?15000:false});
  const inJam=!!jam,invited=new Set([pendingJoin,...invites.map(i=>i.id)]),others=(overview.data?.friends||[]).filter(j=>!invited.has(j.id));
  useEffect(()=>{if(open&&signedIn&&!inJam)void overview.refetch();},[open,signedIn,inJam]);
  const close=()=>{useJamStore.setState({panelOpen:false});setInviting(false);};
  const isOwner=!!jam&&jam.ownerId===jam.you,owner=jam?.members.find(m=>m.owner),now=jamTrack(jam);
  const copy=async()=>{if(!jam)return;try{await navigator.clipboard.writeText(jamLink(jam.id));useToastStore.getState().addToast(t('Ссылка скопирована — по ней подключатся только ваши друзья','Link copied — only your friends can join with it'),'success');}catch{useToastStore.getState().addToast(jamLink(jam.id),'info',8000);}};
  const run=async(work:()=>Promise<unknown>)=>{setBusy(true);try{await work();}finally{setBusy(false);}};
  return <Modal isOpen={open} onClose={close} title="Jam" className="max-w-md connect-modal jam-modal">
    {jam?<div className="jam-panel">
      <div className="jam-head">
        {now?.artworkUrl?<ArtworkImage src={now.artworkUrl} alt="" className="jam-head__art"/>:<span className="jam-head__art jam-head__art--empty" aria-hidden="true"><UsersRound size={22}/></span>}
        <div><small>{isOwner?t('Ваш Jam','Your Jam'):`Jam · ${owner?.name||''}`}</small>
          <strong>{now?`${now.artist?.name} — ${now.title}`:t('Ждём первый трек','Waiting for the first track')}</strong>
          <span>{t('Играет у каждого на своём устройстве, одновременно','Plays on everyone’s own device, in sync')}</span></div>
      </div>
      <Members jam={jam}/>
      <div className="jam-actions">
        <button type="button" className={`sg-btn${inviting?' is-on':''}`} aria-expanded={inviting} onClick={()=>setInviting(v=>!v)}><UserPlus size={14}/>{t('Позвать друзей','Invite friends')}</button>
        <button type="button" className="sg-btn" onClick={()=>void copy()}><Link2 size={14}/>{t('Ссылка','Link')}</button>
      </div>
      {inviting&&<InviteFriends jam={jam}/>}
      <SharedQueue jam={jam}/>
      <p className="connect-note">{t('Добавляйте треки через «В очередь» и «Играть следующим». Пауза, перемотка и «Далее» действуют у всех.','Add tracks with “Add to queue” and “Play next”. Pause, seek and Next apply to everyone.')}</p>
      <button type="button" className="sg-btn jam-leave" onClick={()=>{void leaveJam();close();}}><LogOut size={14}/>{isOwner?t('Завершить Jam для всех','End the Jam for everyone'):t('Выйти из Jam','Leave the Jam')}</button>
    </div>:<div className="jam-panel">
      {pendingJoin&&<div className="jam-callout"><span className="jam-intro__icon" aria-hidden="true"><UsersRound size={20}/></span><p><b>{t('Вас позвали в Jam.','You are invited to a Jam.')}</b> {t('Общая очередь заиграет у вас с той же секунды, что у друзей.','The shared queue plays here from the same second as for your friends.')}</p>
        <button type="button" className="sg-btn sg-btn--primary" disabled={busy} onClick={()=>void run(()=>joinJam(pendingJoin))}>{t('Подключиться','Join')}</button></div>}
      {invites.map(i=><div key={i.id} className="jam-callout"><Avatar person={i.from} size={38}/><p><b>{t(`${i.from.name} зовёт вас в Jam`,`${i.from.name} invites you to a Jam`)}</b>{i.track&&<> · {i.track.title}</>}</p>
        <button type="button" className="sg-btn sg-btn--primary" disabled={busy} onClick={()=>void run(()=>joinJam(i.id))}>{t('Подключиться','Join')}</button></div>)}
      <div className="jam-intro">
        <span className="jam-intro__icon" aria-hidden="true"><UsersRound size={22}/></span>
        <p><b>{t('Слушайте вместе.','Listen together.')}</b> {t('Общая очередь для друзей: каждый добавляет треки и управляет музыкой, а играет она у всех одновременно — каждый на своём устройстве.','A shared queue for friends: everyone adds tracks and controls the music, and it plays for all at once — each on their own device.')}</p>
        <button type="button" className="sg-btn sg-btn--primary" disabled={busy||!signedIn} onClick={()=>void run(startJam)}>{local?t('Начать Jam с текущей очередью','Start a Jam with the current queue'):t('Начать Jam','Start a Jam')}</button>
      </div>
      {!!others.length&&<section className="jam-section"><h3>{t('Друзья сейчас в Jam','Friends in a Jam now')}</h3><FriendJams jams={others}/></section>}
    </div>}
  </Modal>;
}

/** A friend's invite while this listener is not in a jam: join with one tap. */
function InviteBar(){
  const t=useTranslation(),invite=useJamStore(s=>s.jam?null:s.invites[0]),panelOpen=useJamStore(s=>s.panelOpen),fullOpen=usePlayerStore(s=>s.isFullPlayerOpen);
  if(!invite||fullOpen||panelOpen)return null;
  const dismiss=()=>useJamStore.setState(s=>({invites:s.invites.filter(i=>i.id!==invite.id)}));
  return <div className="connect-bar jam-bar" role="region" aria-label={t('Приглашение в Jam','Jam invite')}>
    <button type="button" className="connect-bar__main" onClick={openJamPanel}>
      <Avatar person={invite.from} size={34}/>
      <span><small>{t(`${invite.from.name} зовёт вас в Jam`,`${invite.from.name} invites you to a Jam`)}</small><b>{invite.track?`${invite.track.artist?.name?`${invite.track.artist.name} — `:''}${invite.track.title}`:t('Слушать вместе','Listen together')}</b></span>
    </button>
    <button type="button" className="connect-bar__step" onClick={dismiss} aria-label={t('Не сейчас','Not now')}><X size={16}/></button>
    <button type="button" className="connect-bar__here" onClick={()=>void joinJam(invite.id)}>{t('Подключиться','Join')}</button>
  </div>;
}

/** /jam/:id — a jam link: open the panel with a «join» button, then show the app as usual. */
export function JamJoinRoute(){
  const {id=''}=useParams(),navigate=useNavigate();
  useEffect(()=>{
    if(/^[A-Za-z0-9_-]{8,40}$/.test(id)&&useJamStore.getState().jam?.id!==id)useJamStore.setState({pendingJoin:id,panelOpen:true});
    navigate('/',{replace:true});
  },[id,navigate]);
  return null;
}

export function JamLayer(){
  useEffect(()=>{initJam();},[]);
  return <><InviteBar/><JamPanel/></>;
}
