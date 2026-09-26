import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {Pencil,Plus} from 'lucide-react';
import {apiClient} from '../api/apiClient.js';
import {parseLyricsFile} from '../utils/lyricsParser.js';
import {TrackRow} from '../components/tracks/TrackRow.js';
import {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from '../components/ui/sheet.js';
import type {LyricLine,Track} from '../types/index.js';
import {useTelegramStore} from '../telegram/runtime.js';
import {usePlaylistStore} from '../stores/usePlaylistStore.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {TelegramLoginFlow} from '../components/telegram/TelegramLoginFlow.js';
import {LoadingState} from '../components/common/LoadingState.js';

type Submission={id:string;trackId:string;trackTitle:string;artistName:string;credit:string;status:'pending'|'approved'|'rejected';reviewNote:string};
type Profile={userId:string;username:string|null;displayName:string;avatarUrl:string;telegramAvatarUrl:string;bannerUrl:string;bio:string;telegramConnected:boolean;telegramFullIntegration:boolean;telegramSyncError:string|null;currentTrack:Track|null;music:Track[];playlists:Array<{id:string;playlistId:string;title:string;artworkUrl?:string;tracks:Track[]}>;submissions:Submission[];contributions:Array<{id:string;trackId:string;trackTitle:string;artistName:string;credit:string}>};
type IdentityDraft={displayName:string;bio:string;avatarUrl:string;bannerUrl:string};
const statusLabel={pending:'На проверке',approved:'Одобрено',rejected:'Нужны изменения'};
const emptyDraft:IdentityDraft={displayName:'',bio:'',avatarUrl:'',bannerUrl:''};

function readImage(file:File){
  if(file.size>850000)throw new Error('Выберите изображение до 850 КБ.');
  if(!/^image\/(png|jpeg|webp)$/.test(file.type))throw new Error('Поддерживаются PNG, JPEG и WebP.');
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

export function ProfilePage(){
  const [p,setP]=useState<Profile>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [query,setQuery]=useState(''),[tracks,setTracks]=useState<Track[]>([]),[track,setTrack]=useState<Track>(),[lines,setLines]=useState<LyricLine[]>(),[credit,setCredit]=useState(''),[fileName,setFileName]=useState('');
  const [tab,setTab]=useState<'submit'|'requests'|'guide'>('submit');
  const [editing,setEditing]=useState(false);
  const [adding,setAdding]=useState(false);
  const playlists=usePlaylistStore(s=>s.playlists),fetchPlaylists=usePlaylistStore(s=>s.fetchPlaylists);
  const playingTrack=usePlayerStore(s=>s.isPlaying?s.currentTrack:null);
  const localTrack=usePlayerStore(s=>s.currentTrack);
  const [draft,setDraft]=useState<IdentityDraft>(emptyDraft);
  const load=async()=>{const d=await apiClient.request<Profile>('/profile');setP(d);setCredit(c=>c||d.displayName);};
  useEffect(()=>{void load().catch(e=>setError(e.message));void fetchPlaylists();const timer=setInterval(()=>void load().catch(()=>{}),30000);return()=>clearInterval(timer);},[]);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const picture=async(file:File|undefined,field:'avatarUrl'|'bannerUrl')=>{
    if(!file)return;
    const data=await readImage(file);
    setDraft(current=>({...current,[field]:data}));
  };
  const onSheetChange=(open:boolean)=>{
    if(open&&p)setDraft({displayName:p.displayName,bio:p.bio,avatarUrl:p.avatarUrl,bannerUrl:p.bannerUrl});
    setEditing(open);
  };
  const saveIdentity=async()=>{
    if(!p)return;
    const displayName=draft.displayName.trim();
    if(!displayName)throw new Error('Укажите ник.');
    await apiClient.request('/profile',{method:'PATCH',body:JSON.stringify({displayName,bio:draft.bio,avatarUrl:draft.avatarUrl,bannerUrl:draft.bannerUrl})});
    setP({...p,...draft,displayName});
    useTelegramStore.setState(s=>({user:s.user?{...s.user,first_name:displayName,last_name:undefined,photo_url:draft.avatarUrl}:null}));
    setNotice('Профиль сохранён');
    setEditing(false);
  };
  if(!p)return error?<div className="frost-panel lyrics-error" role="alert">{error}</div>:<LoadingState className="route-loading" label="Открываем профиль…"/>;
  return <div className="page-crystal profile-page">
    <header className="profile-cover frost-panel">
      <div className="profile-banner">{p.bannerUrl?<img src={p.bannerUrl} alt="" aria-hidden="true"/>:null}</div>
      <div className="profile-identity">
        {p.avatarUrl?<img src={p.avatarUrl} alt="Аватар"/>:<span className="profile-avatar">{p.displayName.slice(0,1)}</span>}
        <div className="profile-identity-copy">
          <span className="eyebrow">ВАШ ОСКОЛОК</span>
          <h1>{p.displayName}</h1><Link to={`/users/${encodeURIComponent(p.userId)}`} className="text-button">Открыть публичный профиль</Link>
          <p>{p.username?`@${p.username}`:'В Telegram нет username'} · {p.music.length} треков · {p.playlists.length} плейлистов · {p.contributions.length} текстов</p>
          {p.bio&&<p className="profile-bio">{p.bio}</p>}
        </div>
        <Sheet open={editing} onOpenChange={onSheetChange}>
          <SheetTrigger className="secondary-button profile-edit-trigger"><Pencil size={16}/>Редактировать профиль</SheetTrigger>
          <SheetPopup side="center" variant="inset">
            <SheetHeader>
              <SheetTitle>Редактировать профиль</SheetTitle>
              <SheetDescription>Ник, аватар и баннер меняются здесь. Username из Telegram закреплён при входе.</SheetDescription>
            </SheetHeader>
            <SheetPanel>
              {error&&<p role="alert" className="lyrics-error">{error}</p>}
              <div className="profile-sheet-stage profile-form">
                <div className="profile-sheet-banner">
                  {draft.bannerUrl?<img src={draft.bannerUrl} alt="Баннер"/>:<span className="profile-sheet-banner-empty">Нет баннера</span>}
                </div>
                <div className="profile-sheet-avatar-row">
                  {draft.avatarUrl?<img className="profile-sheet-avatar" src={draft.avatarUrl} alt="Аватар"/>:<span className="profile-sheet-avatar">{draft.displayName.slice(0,1)||'?'}</span>}
                  <p className="profile-sheet-hint">PNG, JPEG или WebP до 850 КБ. Баннер растянется на всю ширину шапки.</p>
                </div>
                <label>Ник<input value={draft.displayName} onChange={e=>setDraft({...draft,displayName:e.target.value})} maxLength={80} autoComplete="nickname"/></label>
                <label>О себе<textarea value={draft.bio} onChange={e=>setDraft({...draft,bio:e.target.value})} maxLength={500} rows={4}/></label>
                <div className="release-actions">
                  <label className="secondary-button">Изменить аватар<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';void run(()=>picture(file,'avatarUrl'));}}/></label>
                  <button type="button" className="secondary-button" onClick={()=>setDraft({...draft,avatarUrl:p.telegramAvatarUrl})}>Фото из Telegram</button>
                  <label className="secondary-button">Изменить баннер<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';void run(()=>picture(file,'bannerUrl'));}}/></label>
                </div>
              </div>
            </SheetPanel>
            <SheetFooter>
              <SheetClose className="secondary-button">Отмена</SheetClose>
              <button className="primary-button" disabled={busy||!draft.displayName.trim()} onClick={()=>void run(saveIdentity)}>Сохранить профиль</button>
            </SheetFooter>
          </SheetPopup>
        </Sheet>
      </div>
    </header>
    {error&&<p role="alert" className="lyrics-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <section className="frost-panel profile-form"><h2>Аккаунт</h2><label>Username из Telegram<input value={p.username?`@${p.username}`:'Не указан в Telegram'} readOnly aria-readonly="true"/></label><small>Закрепляется при первом входе и не меняется в Осколке. Ник, фото и баннер редактируются в шапке профиля.</small></section>
    <section className="frost-panel profile-form"><h2>Трек в профиле</h2>{(localTrack?playingTrack:p.currentTrack)?<TrackRow track={(localTrack?playingTrack:p.currentTrack)!}/>:<p className="profile-empty">Сейчас ничего не играет.</p>}<label className="profile-toggle"><input type="checkbox" checked={p.telegramFullIntegration} disabled={busy} onChange={e=>void run(async()=>{await apiClient.request('/profile/telegram-integration',{method:'PATCH',body:JSON.stringify({enabled:e.target.checked})});await load();})}/><span><strong>Полная Telegram интеграция</strong><small>Все в Telegram увидят что вы слушаете</small></span></label>{!p.telegramConnected&&<a className="text-button" href="#telegram-connection">Подключить Telegram для музыки в профиле</a>}{p.telegramSyncError&&<small role="alert">Telegram: {p.telegramSyncError}</small>}</section>
    <section className="frost-panel profile-form"><div className="profile-showcase-heading"><h2>Витрина профиля</h2><button className="secondary-button" onClick={()=>setAdding(v=>!v)} aria-expanded={adding}><Plus size={16}/>Добавить</button></div><p>Выбранные треки и плейлисты видны в публичном профиле.</p>{p.music.length?p.music.map((t,i)=><div className="profile-music-row" key={t.id}><TrackRow track={t} index={i} collection={p.music}/><button aria-label={`Убрать ${t.title} из профиля`} className="text-button" disabled={busy} onClick={()=>void run(async()=>{await apiClient.request(`/profile/music/${encodeURIComponent(t.id)}`,{method:'DELETE'});await load();})}>Убрать</button></div>):null}{p.playlists.map(pl=><div className="profile-music-row" key={pl.id}><details className="profile-playlist"><summary>{pl.title} · {pl.tracks.length} треков</summary>{pl.tracks.map((t,i)=><TrackRow key={t.id} track={t} index={i} collection={pl.tracks}/>)}</details><button className="text-button" disabled={busy} onClick={()=>void run(async()=>{await apiClient.request(`/profile/playlists/${encodeURIComponent(pl.playlistId)}`,{method:'DELETE'});await load();})}>Убрать</button></div>)}{!p.music.length&&!p.playlists.length&&<p className="profile-empty">Здесь пока тихо. Нажмите «Добавить».</p>}
      {adding&&<div className="profile-form"><h3>Плейлисты из коллекции</h3>{playlists.map(pl=><button className="secondary-button" key={pl.id} disabled={busy||p.playlists.some(x=>x.playlistId===pl.id)} onClick={()=>void run(async()=>{await apiClient.request('/profile/playlists',{method:'POST',body:JSON.stringify({playlistId:pl.id})});await load();})}>{pl.title}{p.playlists.some(x=>x.playlistId===pl.id)?' · добавлен':''}</button>)}<h3>Треки</h3>
      <form className="profile-search" onSubmit={e=>{e.preventDefault();void run(async()=>setTracks((await apiClient.search(query,1,8)).tracks));}}><label>Найти трек<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Артист и название"/></label><button className="secondary-button" disabled={busy||query.trim().length<2}>Найти</button></form>
      <div className="author-track-results">{tracks.map(t=><div className="profile-search-result" key={t.id}><span>{t.artist.name} — {t.title}</span><button className="secondary-button" disabled={busy||p.music.some(m=>m.id===t.id)} onClick={()=>void run(async()=>{await apiClient.request('/profile/music',{method:'POST',body:JSON.stringify({trackId:t.id})});await load();})}>{p.music.some(m=>m.id===t.id)?'Добавлен':'В профиль'}</button><button className="text-button" onClick={()=>{setTrack(t);setTab('submit');document.getElementById('profile-lyrics')?.scrollIntoView({behavior:'smooth'});}}>Отправить текст</button></div>)}</div>
      </div>}
    </section>
    <section id="telegram-connection" className="frost-panel profile-form"><h2>Telegram</h2><p>{p.telegramConnected?'Telegram-сессия подключена. Текущий трек может появляться в музыке профиля.':'Вход в Осколок выполнен. Для музыки в Telegram-профиле подключите пользовательскую сессию.'}</p>{!p.telegramConnected&&<TelegramLoginFlow/>}<div className="release-actions"><button className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{await apiClient.request('/profile/logout',{method:'POST',body:'{}'});location.reload();})}>Выйти из Осколка</button>{p.telegramConnected&&<button className="text-button" disabled={busy} onClick={()=>void run(async()=>{await apiClient.request('/profile/telegram',{method:'DELETE'});location.reload();})}>Отключить сессию Telegram</button>}</div></section>
    <section id="profile-lyrics" className="frost-panel profile-form"><div><span className="eyebrow">СООБЩЕСТВО</span><h2>Тексты, которые оживают</h2></div><div className="profile-tabs" role="tablist" aria-label="Тексты песен">{([['submit','Отправить текст'],['requests',`Мои заявки · ${p.submissions.length}`],['guide','Гайд']] as const).map(([id,title])=><button role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`} aria-selected={tab===id} key={id} onClick={()=>setTab(id)}>{title}</button>)}</div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="profile-form">
      {tab==='submit'&&<><p>Текст сначала попадёт разработчику на проверку. После одобрения он появится у всех слушателей.</p><p>{track?`Выбран: ${track.artist.name} — ${track.title}`:'Найдите трек выше и нажмите «Отправить текст» рядом с ним.'}</p><label>Авторство<input value={credit} onChange={e=>setCredit(e.target.value)} maxLength={160}/></label><label className="secondary-button">{fileName||'Выбрать TTML, LRC или JSON'}<input type="file" accept=".ttml,.xml,.lrc,.json" onChange={e=>{const f=e.target.files?.[0];e.target.value='';setLines(undefined);setFileName('');void run(async()=>{if(!f)return;if(f.size>1000000)throw new Error('Максимум 1 МБ.');setLines(parseLyricsFile(await f.text(),f.name));setFileName(f.name);});}}/></label>{lines&&<p>{lines.length} строк · {lines.some(l=>l.words?.length)?'Синхронизация по словам':'Синхронизация по строкам'}</p>}<button className="primary-button" disabled={busy||!track||!lines||!credit.trim()} onClick={()=>void run(async()=>{await apiClient.request('/profile/lyrics',{method:'POST',body:JSON.stringify({trackId:track!.id,trackTitle:track!.title,artistName:track!.artist.name,credit,fileName,lines})});setLines(undefined);setFileName('');await load();setTab('requests');setNotice('Текст отправлен на проверку разработчику');})}>Отправить на проверку</button></>}
      {tab==='requests'&&<>{!p.submissions.length&&<p>Вы ещё не отправляли тексты.</p>}{p.submissions.map(c=><div className="contribution-row" key={c.id}><div><Link to={`/track/${encodeURIComponent(c.trackId)}`}>{c.artistName} — {c.trackTitle}</Link><small className={`submission-status status-${c.status}`}>{statusLabel[c.status]}</small>{c.reviewNote&&<p>{c.reviewNote}</p>}</div>{c.status==='pending'&&<button className="text-button" disabled={busy} onClick={()=>void run(async()=>{await apiClient.request(`/profile/lyrics/${c.id}`,{method:'DELETE'});await load();})}>Отозвать</button>}</div>)}<button className="text-button" disabled={busy} onClick={()=>void run(load)}>Обновить статусы</button></>}
      {tab==='guide'&&<><h3>Как подготовить TTML</h3><p>Для точной подсветки нужны временные метки слов или слогов. В руководстве описана подготовка синхронизированного текста.</p><a className="primary-button" href="https://guides.spicylyrics.org/s/ttml" target="_blank" rel="noopener noreferrer">Открыть гайд по TTML ↗</a><small>Руководство предоставлено Spicy Lyrics.</small></>}
    </div></section>
  </div>;
}
