import {MyReports} from '../components/profile/MyReports.js';
import React,{useEffect,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {Pencil,Plus,Camera,ImagePlus,Music2,ListMusic,Heart,Radio,Shield,LogOut,Flag} from 'lucide-react';
import {apiClient} from '../api/apiClient.js';
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
import type {Track} from '../types/index.js';
import {useTelegramStore} from '../telegram/runtime.js';
import {usePlaylistStore} from '../stores/usePlaylistStore.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {useLibraryStore} from '../stores/useLibraryStore.js';
import {TelegramLoginFlow} from '../components/telegram/TelegramLoginFlow.js';
import {TelegramStatusSettings} from '../components/telegram/TelegramStatusSettings.js';
import {ProfileCustomizationEditor,ProfileStatus,SocialLinks,accentStyle,type Customization} from '../components/profile/ProfileCustomization.js';
import {RoleBadges,topRoleColor,type PublicRole} from '../components/profile/RoleBadge.js';
import type {PublicRewards} from '../components/profile/Rewards.js';
import {LoadingState} from '../components/common/LoadingState.js';
import {SoonBadge} from '../components/common/SoonBadge.js';
import {WipPlaceholder} from '../components/common/WipPlaceholder.js';
import {MusicTransfer} from './ImportPage.js';
import {useReportStore} from '../components/common/ReportDialog.js';
import {useTranslation,tr} from '../stores/useLanguageStore.js';

type Submission={id:string;trackId:string;trackTitle:string;artistName:string;credit:string;status:'pending'|'approved'|'rejected';reviewNote:string};
type Profile={customization?:Customization;roles?:PublicRole[];rewards?:PublicRewards;userId:string;username:string|null;displayName:string;avatarUrl:string;telegramAvatarUrl:string;bannerUrl:string;bio:string;telegramConnected:boolean;telegramFullIntegration:boolean;telegramSyncError:string|null;currentTrack:Track|null;music:Track[];playlists:Array<{id:string;playlistId:string;title:string;artworkUrl?:string;tracks:Track[]}>;submissions:Submission[];contributions:Array<{id:string;trackId:string;trackTitle:string;artistName:string;credit:string}>};
type IdentityDraft={displayName:string;bio:string;avatarUrl:string;bannerUrl:string};
// Beta: lyrics submissions and rewards stay hidden until they are ready.
type Tab='showcase'|'import'|'reports'|'settings'|'lyrics'|'rewards';
const TABS:Tab[]=['showcase','import','reports','settings','lyrics','rewards'];
const emptyDraft:IdentityDraft={displayName:'',bio:'',avatarUrl:'',bannerUrl:''};

function readImage(file:File){
  if(file.size>850000)throw new Error(tr('Выберите изображение до 850 КБ.','Choose an image under 850 KB.'));
  if(!/^image\/(png|jpeg|webp)$/.test(file.type))throw new Error(tr('Поддерживаются PNG, JPEG и WebP.','PNG, JPEG and WebP are supported.'));
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

function Avatar({src,name,className}:{src?:string;name:string;className:string}){
  return src?<img className={className} src={src} alt=""/>:<span className={className} aria-hidden="true">{name.slice(0,1).toUpperCase()||'?'}</span>;
}

export function ProfilePage(){
  const t=useTranslation();
  const [params,setParams]=useSearchParams();
  const tab:Tab=TABS.includes(params.get('tab') as Tab)?params.get('tab') as Tab:'showcase';
  const setTab=(next:Tab)=>setParams(next==='showcase'?{}:{tab:next},{replace:true});
  const [p,setP]=useState<Profile>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [query,setQuery]=useState(''),[tracks,setTracks]=useState<Track[]>([]);
  const [editing,setEditing]=useState(false);
  const [adding,setAdding]=useState(false);
  const playlists=usePlaylistStore(s=>s.playlists),fetchPlaylists=usePlaylistStore(s=>s.fetchPlaylists);
  const likedCount=useLibraryStore(s=>s.likedTracks.length);
  const playingTrack=usePlayerStore(s=>s.isPlaying?s.currentTrack:null);
  const localTrack=usePlayerStore(s=>s.currentTrack);
  const [draft,setDraft]=useState<IdentityDraft>(emptyDraft);
  const load=async()=>{setP(await apiClient.request<Profile>('/profile'));};
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
    if(!displayName)throw new Error(t('Укажите ник.','Enter a nickname.'));
    await apiClient.request('/profile',{method:'PATCH',body:JSON.stringify({displayName,bio:draft.bio,avatarUrl:draft.avatarUrl,bannerUrl:draft.bannerUrl})});
    setP({...p,...draft,displayName});
    useTelegramStore.setState(s=>({user:s.user?{...s.user,first_name:displayName,last_name:undefined,photo_url:draft.avatarUrl}:null}));
    setNotice(t('Профиль сохранён','Profile saved'));
    setEditing(false);
  };
  if(!p)return error?<div className="frost-panel lyrics-error" role="alert">{error}</div>:<LoadingState className="route-loading" label={t('Открываем профиль…', 'Opening profile…')}/>;
  const nowPlaying=localTrack?playingTrack:p.currentTrack;
  const stats=[
    {icon:Music2,value:p.music.length,label:t('треков в витрине','showcase tracks')},
    {icon:ListMusic,value:p.playlists.length,label:t('плейлистов','playlists')},
    {icon:Heart,value:likedCount,label:t('любимых','liked')},
  ];
  const tabs:Array<[Tab,string]>=[['showcase',t('Витрина','Showcase')],['import',t('Перенос музыки','Transfer music')],['reports',t('Обращения','Reports')],['settings',t('Настройки','Settings')]];

  return <div className="profile-page profile-v2">
    <div className={`profile-head crystal-slab profile-theme--${p.customization?.theme||'default'}`} style={accentStyle(p.customization)}>
      <div className="profile-head-banner">{p.bannerUrl?<img src={p.bannerUrl} alt="" aria-hidden="true"/>:<i className="profile-head-banner-art" aria-hidden="true"/>}</div>
      <div className="profile-head-body">
        <Avatar src={p.avatarUrl} name={p.displayName} className="profile-head-avatar"/>
        <div className="profile-head-id">
          <h1 style={{color:topRoleColor(p.roles)}}>{p.displayName} <RoleBadges roles={p.roles}/></h1>
          <ProfileStatus c={p.customization}/>
          <p>{p.username?`@${p.username}`:t('В Telegram нет username','No Telegram username')}<span className={`profile-head-dot ${p.telegramConnected?'is-on':''}`}>{p.telegramConnected?t('Telegram подключён','Telegram connected'):t('Telegram не подключён','Telegram not connected')}</span>{nowPlaying&&<span className="profile-head-listening"><Radio size={12}/>{nowPlaying.artist.name} — {nowPlaying.title}</span>}</p>
          {p.bio&&<p className="profile-head-bio">{p.bio}</p>}
          <SocialLinks links={p.customization?.socialLinks}/>
        </div>
        <div className="profile-head-actions">
          <Sheet open={editing} onOpenChange={onSheetChange}>
            <SheetTrigger className="profile-btn profile-btn--primary"><Pencil size={15}/>{t('Редактировать','Edit profile')}</SheetTrigger>
            <SheetPopup side="center" variant="inset" className="profile-edit-dialog">
              <SheetHeader>
                <SheetTitle>{t('Редактировать профиль','Edit profile')}</SheetTitle>
                <SheetDescription>{t('Ник, аватар и баннер. Username из Telegram закреплён при входе.','Nickname, avatar and banner. Your Telegram username is fixed at sign-in.')}</SheetDescription>
              </SheetHeader>
              <SheetPanel>
                {error&&<p role="alert" className="lyrics-error">{error}</p>}
                <div className="profile-edit">
                  <div className="profile-edit-cover">
                    <div className="profile-edit-banner">
                      {draft.bannerUrl?<img src={draft.bannerUrl} alt={t('Баннер','Banner')}/>:<i className="profile-head-banner-art" aria-hidden="true"/>}
                      <label className="profile-edit-pick profile-edit-pick--banner"><ImagePlus size={15}/>{t('Сменить баннер','Change banner')}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';void run(()=>picture(file,'bannerUrl'));}}/></label>
                    </div>
                    <div className="profile-edit-avatar">
                      <Avatar src={draft.avatarUrl} name={draft.displayName} className="profile-head-avatar"/>
                      <label className="profile-edit-pick profile-edit-pick--avatar" aria-label={t('Сменить аватар','Change avatar')}><Camera size={16}/><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';void run(()=>picture(file,'avatarUrl'));}}/></label>
                    </div>
                  </div>
                  <div className="profile-edit-tools">
                    <button type="button" className="text-button" onClick={()=>setDraft({...draft,avatarUrl:p.telegramAvatarUrl})}>{t('Фото из Telegram','Use Telegram photo')}</button>
                    {draft.bannerUrl&&<button type="button" className="text-button" onClick={()=>setDraft({...draft,bannerUrl:''})}>{t('Убрать баннер','Remove banner')}</button>}
                    <small>PNG, JPEG, WebP · {t('до 850 КБ','up to 850 KB')}</small>
                  </div>
                  <label className="profile-edit-field">{t('Ник','Nickname')}<input value={draft.displayName} onChange={e=>setDraft({...draft,displayName:e.target.value})} maxLength={80} autoComplete="nickname"/></label>
                  <label className="profile-edit-field">{t('О себе','About')}<textarea value={draft.bio} onChange={e=>setDraft({...draft,bio:e.target.value})} maxLength={500} rows={4}/><small>{draft.bio.length}/500</small></label>
                </div>
              </SheetPanel>
              <SheetFooter>
                <SheetClose className="secondary-button">{t('Отмена','Cancel')}</SheetClose>
                <button className="primary-button" disabled={busy||!draft.displayName.trim()} onClick={()=>void run(saveIdentity)}>{t('Сохранить','Save')}</button>
              </SheetFooter>
            </SheetPopup>
          </Sheet>
        </div>
      </div>
      <dl className="profile-stats">{stats.map(({icon:Icon,value,label})=><div key={label}><dt><Icon size={14}/>{label}</dt><dd>{new Intl.NumberFormat().format(value)}</dd></div>)}</dl>
      <nav className="set-segmented profile-segmented" role="tablist" aria-label={t('Разделы профиля','Profile sections')}>
        {tabs.map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} className={tab===id?'is-active':''} onClick={()=>setTab(id)}>{label}</button>)}
        {/* Closed for the beta: they open the «в разработке» placeholder. */}
        {([['lyrics',t('Тексты','Lyrics')],['rewards',t('Награды','Rewards')]] as Array<[Tab,string]>).map(([id,label])=><button key={id} type="button" role="tab" aria-selected={tab===id} className={`is-soon${tab===id?' is-active':''}`} onClick={()=>setTab(id)}>{label}<SoonBadge/></button>)}
      </nav>
    </div>

    {(error&&!editing)&&<p role="alert" className="transfer-error">{error}</p>}{notice&&<p role="status" className="profile-notice">{notice}</p>}

    {tab==='showcase'&&<div className="profile-stack">
      <div className="profile-main">
        <section className="crystal-slab profile-card">
          <h2>{t('Сейчас играет','Now playing')}</h2>
          {nowPlaying?<TrackRow track={nowPlaying}/>:<p className="profile-empty">{t('Сейчас ничего не играет.','Nothing is playing.')}</p>}
        </section>
        <section className="crystal-slab profile-card">
          <div className="profile-card-head"><h2>{t('Витрина','Showcase')}</h2><button className="profile-btn" onClick={()=>setAdding(v=>!v)} aria-expanded={adding}><Plus size={15}/>{t('Добавить','Add')}</button></div>
          {p.music.map((tr,i)=><div className="profile-music-row" key={tr.id}><TrackRow track={tr} index={i} collection={p.music}/><button aria-label={`Убрать ${tr.title} из профиля`} className="text-button" disabled={busy} onClick={()=>void run(async()=>{await apiClient.request(`/profile/music/${encodeURIComponent(tr.id)}`,{method:'DELETE'});await load();})}>{t('Убрать','Remove')}</button></div>)}
          {p.playlists.map(pl=><div className="profile-music-row" key={pl.id}><details className="profile-playlist"><summary>{pl.title} · {pl.tracks.length} {t('треков','tracks')}</summary>{pl.tracks.map((tr,i)=><TrackRow key={tr.id} track={tr} index={i} collection={pl.tracks}/>)}</details><button className="text-button" disabled={busy} onClick={()=>void run(async()=>{await apiClient.request(`/profile/playlists/${encodeURIComponent(pl.playlistId)}`,{method:'DELETE'});await load();})}>{t('Убрать','Remove')}</button></div>)}
          {!p.music.length&&!p.playlists.length&&<p className="profile-empty">{t('Здесь пока тихо. Нажмите «Добавить».','Quiet here for now. Press "Add".')}</p>}
          {adding&&<div className="profile-adder">
            <h3>{t('Плейлисты из коллекции','Playlists from your collection')}</h3>
            <div className="profile-chips">{playlists.map(pl=><button className="profile-chip" key={pl.id} disabled={busy||p.playlists.some(x=>x.playlistId===pl.id)} onClick={()=>void run(async()=>{await apiClient.request('/profile/playlists',{method:'POST',body:JSON.stringify({playlistId:pl.id})});await load();})}>{pl.title}{p.playlists.some(x=>x.playlistId===pl.id)?' · ✓':''}</button>)}</div>
            <h3>{t('Треки','Tracks')}</h3>
            <form className="profile-search" onSubmit={e=>{e.preventDefault();void run(async()=>setTracks((await apiClient.search(query,1,8)).tracks));}}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('Артист и название','Artist and title')} aria-label={t('Найти трек','Find a track')}/><button className="profile-btn" disabled={busy||query.trim().length<2}>{t('Найти','Search')}</button></form>
            <div className="author-track-results">{tracks.map(tr=><div className="profile-search-result" key={tr.id}><span>{tr.artist.name} — {tr.title}</span><button className="profile-btn" disabled={busy||p.music.some(m=>m.id===tr.id)} onClick={()=>void run(async()=>{await apiClient.request('/profile/music',{method:'POST',body:JSON.stringify({trackId:tr.id})});await load();})}>{p.music.some(m=>m.id===tr.id)?t('Добавлен','Added'):t('В профиль','To profile')}</button></div>)}</div>
          </div>}
        </section>
      </div>
    </div>}

    {tab==='import'&&<MusicTransfer/>}
    {(tab==='lyrics'||tab==='rewards')&&<WipPlaceholder title={tab==='lyrics'?t('Тексты пока на стройке','Lyrics are under construction'):t('Награды пока на стройке','Rewards are under construction')}/>}

    {tab==='reports'&&<div className="profile-stack">
      <section className="crystal-slab profile-card profile-report-cta"><div><h2>{t('Что-то сломалось?','Something broke?')}</h2><p>{t('Опишите проблему — мы привяжем к обращению текущую страницу.','Describe the problem — we attach the current page automatically.')}</p></div><button className="profile-btn profile-btn--primary" onClick={()=>useReportStore.getState().open()}><Flag size={15}/>{t('Сообщить о проблеме','Report a problem')}</button></section>
      <MyReports/>
    </div>}

    {tab==='settings'&&<div className="set-sheet profile-settings">
      <section className="set-group">
        <h4>{t('Аккаунт','Account')}</h4>
        <div className="set-row"><span>{t('Username','Username')}<small>{t('Закреплён из Telegram при первом входе','Fixed from Telegram at first sign-in')}</small></span><strong>{p.username?`@${p.username}`:'—'}</strong></div>
        <button type="button" className="set-row set-row--button" onClick={()=>onSheetChange(true)}><span>{t('Ник, фото, баннер и «О себе»','Nickname, photo, banner and bio')}</span><Pencil size={15}/></button>
        <Link className="set-row set-row--button" to="/admin"><span>{t('Администрирование','Administration')}</span><Shield size={15}/></Link>
      </section>
      <ProfileCustomizationEditor value={p.customization} onSaved={customization=>setP({...p,customization})}/>
      <section className="set-group">
        <h4>Telegram</h4>
        <label className="set-row set-switch"><span>{t('Трек в профиле Telegram','Track in Telegram profile')}<small>{t('Все в Telegram увидят, что вы слушаете','Everyone in Telegram sees what you play')}</small></span><input type="checkbox" role="switch" checked={p.telegramFullIntegration} disabled={busy} onChange={e=>void run(async()=>{await apiClient.request('/profile/telegram-integration',{method:'PATCH',body:JSON.stringify({enabled:e.target.checked})});await load();})}/></label>
        {p.telegramSyncError&&<p className="set-note" role="alert">Telegram: {p.telegramSyncError}</p>}
        <TelegramStatusSettings fallbackName={p.displayName} fallbackAvatar={p.telegramAvatarUrl||p.avatarUrl} fallbackTrack={nowPlaying||p.currentTrack||p.music[0]} enabled={p.telegramFullIntegration}/>
        <div id="telegram-connection" className="set-row set-row--stack"><span>{t('Пользовательская сессия','User session')}<small>{p.telegramConnected?t('Подключена: текущий трек может появляться в музыке профиля.','Connected: your current track can appear in your profile music.'):t('Нужна, чтобы показывать музыку в Telegram-профиле.','Needed to show music in your Telegram profile.')}</small></span>{!p.telegramConnected&&<TelegramLoginFlow/>}{p.telegramConnected&&<button className="sg-btn" disabled={busy} onClick={()=>void run(async()=>{await apiClient.request('/profile/telegram',{method:'DELETE'});location.reload();})}>{t('Отключить сессию','Disconnect session')}</button>}</div>
      </section>
      <section className="set-group">
        <button type="button" className="set-row set-row--button set-row--danger" disabled={busy} onClick={()=>void run(async()=>{await apiClient.request('/profile/logout',{method:'POST',body:'{}'});location.reload();})}><span>{t('Выйти из Осколка','Sign out')}</span><LogOut size={15}/></button>
      </section>
    </div>}
  </div>;
}
