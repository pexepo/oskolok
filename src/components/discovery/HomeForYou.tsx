import React,{useEffect,useMemo} from 'react';
import {NavLink} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {Sun,Briefcase,Dumbbell,Car,MoonStar,Flame,ChevronRight,Play,MonitorSmartphone} from 'lucide-react';
import {apiClient} from '../../api/apiClient.js';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {useHistoryStore} from '../../stores/useHistoryStore.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {useTelegramStore} from '../../telegram/runtime.js';
import {WAVE_ACTIVITIES,type WaveSettings} from '../../stores/waveSettings.js';
import {ShardArtwork} from '../tracks/ShardArtwork.js';
import {HomeDailyMixes} from './HomeDailyMixes.js';
import {openDevicesPanel} from '../connect/ConnectLayer.js';
import {otherDevices,useConnectStore} from '../../connect/connect.js';
import type {Track} from '../../types/index.js';
import './home-for-you.css';

type Activity=NonNullable<WaveSettings['activity']>;
const ICONS:Record<Activity,React.ReactNode>={wake:<Sun size={16}/>,work:<Briefcase size={16}/>,workout:<Dumbbell size={16}/>,road:<Car size={16}/>,sleep:<MoonStar size={16}/>};

/** The moment decides the first suggestion (Яндекс «гиперконтекст»): morning — waking up, weekday — work, late — sleep. */
export function suggestedActivity(d:Date):Activity|null{
  const h=d.getHours(),weekday=d.getDay()>=1&&d.getDay()<=5;
  if(h>=23||h<5)return 'sleep';
  if(h<10)return 'wake';
  if(weekday&&h<18)return 'work';
  if(h>=17&&h<20&&weekday)return 'road';
  return null;
}
function greeting(d:Date,t:(ru:string,en:string)=>string){const h=d.getHours();return h<5?t('Доброй ночи','Good night'):h<12?t('Доброе утро','Good morning'):h<18?t('Добрый день','Good afternoon'):t('Добрый вечер','Good evening');}

interface WeekStats{plays:number;minutes:number;streak:{current:number;longest:number};topArtists:Array<{name:string}>}

/** «Для тебя» on Home: a wave for the moment, daily mixes, what played recently and the week in numbers. */
export function HomeForYou(){
  const t=useTranslation(),now=new Date();
  const user=useTelegramStore(s=>s.user);
  const startMyWave=usePlayerStore(s=>s.startMyWave),isStartingWave=usePlayerStore(s=>s.isStartingWave),playCollection=usePlayerStore(s=>s.playCollection);
  const {history,fetchHistory}=useHistoryStore();
  const others=useConnectStore(s=>otherDevices(s).length);
  useEffect(()=>{if(user)void fetchHistory();},[user,fetchHistory]);
  const week=useQuery({queryKey:['stats','week'],queryFn:()=>apiClient.request<WeekStats>(`/me/stats?period=week&tz=${new Date().getTimezoneOffset()}`),staleTime:5*60000,enabled:!!user,retry:1});
  const recent=useMemo(()=>{const seen=new Set<string>(),out:Track[]=[];for(const h of history){if(!seen.has(h.track.id)){seen.add(h.track.id);out.push(h.track);}if(out.length>=8)break;}return out;},[history]);
  const suggested=suggestedActivity(now);
  const activities=[...WAVE_ACTIVITIES].sort((a,b)=>(b.id===suggested?1:0)-(a.id===suggested?1:0));
  const name=user?.first_name?.split(' ')[0];
  return <div className="sg-collections home-for-you" id="home-for-you">
    <section className="sg-section">
      <div className="sg-section-head">
        <span className="sg-eyebrow"><i className="sg-star"/>{t('Для тебя','For you')}</span>
        <h2>{greeting(now,t)}{name?`, ${name}`:''}</h2>
      </div>
      <div className="hfy-moment sg-glass">
        <div className="hfy-moment__copy"><b>{t('Резонанс для момента','Resonance for the moment')}</b><span>{t('Волна подстроится под занятие — и под ваши лайки и пропуски.','The wave adapts to what you do — and to your likes and skips.')}</span></div>
        <div className="hfy-activities">
          {activities.map(a=><button key={a.id} type="button" className={a.id===suggested?'is-suggested':''} disabled={isStartingWave} onClick={()=>void startMyWave({activity:a.id})}>
            {ICONS[a.id]}{t(a.ru,a.en)}{a.id===suggested&&<small>{t('сейчас','now')}</small>}
          </button>)}
        </div>
      </div>
      <div className="hfy-row">
        {week.data&&week.data.plays>0?<NavLink to="/stats" className="hfy-card hfy-stats sg-glass">
          <span className="hfy-card__label">{t('Ваша неделя','Your week')}</span>
          <b>{week.data.minutes.toLocaleString('ru-RU')} <small>{t('мин','min')}</small></b>
          <span className="hfy-stats__line"><Flame size={14} aria-hidden="true"/>{t(`Серия: ${week.data.streak.current} дн.`,`Streak: ${week.data.streak.current} d`)}{week.data.topArtists[0]&&<> · {week.data.topArtists[0].name}</>}</span>
          <span className="hfy-card__more">{t('Все итоги','All stats')}<ChevronRight size={14}/></span>
        </NavLink>:<NavLink to="/stats" className="hfy-card hfy-stats sg-glass">
          <span className="hfy-card__label">{t('Итоги','Stats')}</span>
          <b className="hfy-stats__empty">{t('Слушайте — мы посчитаем','Listen — we will count')}</b>
          <span className="hfy-card__more">{t('Что здесь будет','What you will see')}<ChevronRight size={14}/></span>
        </NavLink>}
        <button type="button" className="hfy-card hfy-devices sg-glass" onClick={openDevicesPanel}>
          <span className="hfy-card__label">{t('Ваши устройства','Your devices')}</span>
          <MonitorSmartphone size={26} aria-hidden="true"/>
          <span className="hfy-devices__line">{others?t(`Ещё ${others} в сети — перенесите музыку одним нажатием`,`${others} more online — move the music with one tap`):t('Телефон, компьютер, Telegram — музыка продолжится там, где вы','Phone, computer, Telegram — the music follows you')}</span>
        </button>
      </div>
      {recent.length>0&&<div className="hfy-recent">
        <div className="hfy-subhead"><h3>{t('Недавно звучало','Recently played')}</h3><NavLink to="/history" className="text-button">{t('История','History')}<ChevronRight size={14}/></NavLink></div>
        <div className="hfy-recent__list">{recent.map((track,i)=><button key={track.id} type="button" className="hfy-recent__item" onClick={()=>void playCollection(recent,i,undefined,'home-recent')} title={`${track.artist.name} — ${track.title}`}>
          <span className="hfy-recent__art"><ShardArtwork src={track.artworkUrl} alt="" index={i}/><i className="hfy-recent__play" aria-hidden="true"><Play size={16} fill="currentColor"/></i></span>
          <b>{track.title}</b><small>{track.artist.name}</small>
        </button>)}</div>
      </div>}
      <HomeDailyMixes/>
    </section>
  </div>;
}
