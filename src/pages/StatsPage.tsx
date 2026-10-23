import React,{useEffect,useState} from 'react';
import {NavLink} from 'react-router-dom';
import {Clock3,Disc3,Flame,Mic2,Play,Share2,Sparkles,BarChart3} from 'lucide-react';
import {apiClient} from '../api/apiClient.js';
import {useTranslation,useLanguageStore} from '../stores/useLanguageStore.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {useTelegramStore} from '../telegram/runtime.js';
import {useToastStore} from '../stores/useToastStore.js';
import {ShardArtwork} from '../components/tracks/ShardArtwork.js';
import {TrackRow} from '../components/tracks/TrackRow.js';
import {PageSkeleton} from '../components/common/Skeleton.js';
import {renderStatsCard} from '../utils/statsCard.js';
import type {Track} from '../types/index.js';
import './stats.css';

type Period='week'|'month'|'year'|'all';
interface Stats {
  period:Period;plays:number;minutes:number;uniqueTracks:number;uniqueArtists:number;newArtists:number;
  topArtists:Array<{name:string;plays:number;minutes:number;artworkUrl?:string;artistId?:string}>;
  topTracks:Array<{track:Track;plays:number}>;byHour:number[];byWeekday:number[];
  streak:{current:number;longest:number};peakHour:number|null;listenerType:'night'|'morning'|'day'|'evening'|null;firstPlayAt:string|null;
}

/** Russian plural: 1 минута, 2 минуты, 5 минут. */
const plural=(n:number,one:string,few:string,many:string)=>{const a=Math.abs(n)%100,b=a%10;return a>10&&a<20?many:b===1?one:b>=2&&b<=4?few:many;};
const hourLabel=(h:number)=>`${String(h).padStart(2,'0')}:00`;

export function StatsPage(){
  const t=useTranslation(),ru=useLanguageStore(s=>s.language)!=='en';
  const [period,setPeriod]=useState<Period>('month');
  const [stats,setStats]=useState<Stats|null>(null),[error,setError]=useState(''),[sharing,setSharing]=useState(false);
  const playCollection=usePlayerStore(s=>s.playCollection);
  const user=useTelegramStore(s=>s.user);
  useEffect(()=>{
    let alive=true;setError('');
    apiClient.request<Stats>(`/me/stats?period=${period}&tz=${new Date().getTimezoneOffset()}`)
      .then(s=>{if(alive)setStats(s);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:t('Не удалось загрузить итоги.','Could not load your stats.'));});
    return()=>{alive=false;};
  },[period]);
  const periods:Array<[Period,string]>=[['week',t('Неделя','Week')],['month',t('Месяц','Month')],['year',t('Год','Year')],['all',t('Всё время','All time')]];
  const periodLabel=(p:Period)=>p==='week'?t('последние 7 дней','last 7 days'):p==='month'?t('последние 30 дней','last 30 days'):p==='year'?t('последний год','last year'):t('за всё время','all time');
  const listenerLine=(s:Stats)=>s.peakHour===null?'':s.listenerType==='night'?t(`Ночной слушатель — чаще всего около ${hourLabel(s.peakHour)}`,`Night listener — most often around ${hourLabel(s.peakHour)}`)
    :s.listenerType==='morning'?t(`Утренний слушатель — чаще всего около ${hourLabel(s.peakHour)}`,`Morning listener — most often around ${hourLabel(s.peakHour)}`)
    :s.listenerType==='day'?t(`Музыка днём — пик около ${hourLabel(s.peakHour)}`,`Daytime listener — peak around ${hourLabel(s.peakHour)}`)
    :t(`Вечерний слушатель — пик около ${hourLabel(s.peakHour)}`,`Evening listener — peak around ${hourLabel(s.peakHour)}`);

  const share=async()=>{
    if(!stats||sharing)return;setSharing(true);
    try{
      const blob=await renderStatsCard({periodLabel:periodLabel(period),minutes:stats.minutes,plays:stats.plays,artists:stats.uniqueArtists,streak:stats.streak.current,
        topArtists:stats.topArtists.map(a=>a.name),topTrack:stats.topTracks[0]?{title:stats.topTracks[0].track.title,artist:stats.topTracks[0].track.artist.name}:undefined,listenerLine:listenerLine(stats),name:user?.first_name});
      const file=new File([blob],'oskolok-itogi.png',{type:'image/png'});
      const nav=navigator as Navigator&{canShare?:(d:ShareData)=>boolean};
      if(nav.canShare?.({files:[file]}))await nav.share({files:[file],title:t('Мои итоги в Осколке','My Oskolok stats'),text:'oskolok.lol'});
      else{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='oskolok-itogi.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),4000);useToastStore.getState().addToast(t('Карточка сохранена — поделитесь ей в сторис','Card saved — share it in your stories'),'success');}
    }catch(e){if((e as Error)?.name!=='AbortError')useToastStore.getState().addToast(t('Не удалось сделать карточку.','Could not make the card.'),'warning');}
    finally{setSharing(false);}
  };

  const s=stats&&stats.period===period?stats:null;
  const maxHour=s?Math.max(1,...s.byHour):1;
  const top=s?.topArtists[0];
  const topTracks=s?.topTracks.map(x=>x.track)||[];
  return <div className="stats-page">
    <div className="collection-heading stats-heading">
      <span className="eyebrow">{t('Твои итоги','Your stats')}</span>
      <h1>{t('Твой','Your')} <em>{t('звук','sound')}</em></h1>
      <div className="stats-periods" role="radiogroup" aria-label={t('Период','Period')}>
        {periods.map(([id,label])=><button key={id} type="button" role="radio" aria-checked={period===id} className={period===id?'is-active':''} onClick={()=>setPeriod(id)}>{label}</button>)}
      </div>
    </div>
    {error&&!s&&<p className="stats-error" role="alert">{error}</p>}
    {!s&&!error&&<PageSkeleton hero={false} rows={6} label={t('Считаем ваши итоги…','Counting your stats…')}/>}
    {s&&s.plays===0&&<section className="stats-empty">
      <BarChart3 size={40} aria-hidden="true"/>
      <h2>{t('Здесь появятся ваши итоги','Your stats will show up here')}</h2>
      <p>{t('Слушайте музыку — Осколок посчитает минуты, любимых артистов, треки и серию дней. Трек засчитывается после 30 секунд.','Listen to music and Oskolok counts the minutes, favourite artists, tracks and your day streak. A track counts after 30 seconds.')}</p>
      {period!=='all'&&<button type="button" className="sg-btn" onClick={()=>setPeriod('all')}>{t('Показать за всё время','Show all time')}</button>}
    </section>}
    {s&&s.plays>0&&<>
      <section className="stats-hero" aria-label={t('Главное','Highlights')}>
        <div className="stats-hero__minutes">
          <b>{s.minutes.toLocaleString(ru?'ru-RU':'en-US')}</b>
          <span>{ru?plural(s.minutes,'минута музыки','минуты музыки','минут музыки'):'minutes of music'} · {periodLabel(period)}</span>
        </div>
        <ul className="stats-tiles">
          <li><Disc3 size={18} aria-hidden="true"/><b>{s.plays.toLocaleString('ru-RU')}</b><span>{ru?plural(s.plays,'прослушивание','прослушивания','прослушиваний'):'plays'}</span></li>
          <li><Mic2 size={18} aria-hidden="true"/><b>{s.uniqueArtists}</b><span>{ru?plural(s.uniqueArtists,'артист','артиста','артистов'):'artists'}{s.newArtists>0&&<em> · {t(`${s.newArtists} новых`,`${s.newArtists} new`)}</em>}</span></li>
          <li><Flame size={18} aria-hidden="true"/><b>{s.streak.current}</b><span>{ru?plural(s.streak.current,'день подряд','дня подряд','дней подряд'):'day streak'}<em> · {t(`рекорд ${s.streak.longest}`,`best ${s.streak.longest}`)}</em></span></li>
          <li><Clock3 size={18} aria-hidden="true"/><b>{s.uniqueTracks}</b><span>{ru?plural(s.uniqueTracks,'трек','трека','треков'):'tracks'}</span></li>
        </ul>
        <button type="button" className="sg-btn sg-btn--primary stats-share" onClick={()=>void share()} disabled={sharing}><Share2 size={16}/>{sharing?t('Рисуем карточку…','Drawing the card…'):t('Поделиться итогами','Share my stats')}</button>
      </section>

      {top&&<section className="stats-panel stats-top-artist">
        <div className="stats-top-artist__art"><ShardArtwork src={top.artworkUrl} alt={top.name} index={2}/></div>
        <div>
          <span className="eyebrow">{t('Артист №1','Artist #1')}</span>
          <h2>{top.artistId?<NavLink to={`/artist/${encodeURIComponent(top.artistId)}`}>{top.name}</NavLink>:top.name}</h2>
          <p>{t(`${top.plays} ${plural(top.plays,'прослушивание','прослушивания','прослушиваний')} · ${top.minutes} мин`,`${top.plays} plays · ${top.minutes} min`)}</p>
        </div>
      </section>}

      <div className="stats-grid">
        <section className="stats-panel">
          <div className="section-heading collection-section"><h2>{t('Топ артистов','Top artists')} <i/></h2></div>
          <ol className="stats-artists">{s.topArtists.map((a,i)=><li key={a.name}>
            <span className="stats-rank">{i+1}</span>
            <div className="stats-artists__art"><ShardArtwork src={a.artworkUrl} alt="" index={i} small/></div>
            <div className="stats-artists__name">{a.artistId?<NavLink to={`/artist/${encodeURIComponent(a.artistId)}`}>{a.name}</NavLink>:<span>{a.name}</span>}<small>{t(`${a.plays} · ${a.minutes} мин`,`${a.plays} · ${a.minutes} min`)}</small></div>
            <span className="stats-bar" aria-hidden="true"><i style={{width:`${a.plays/s.topArtists[0].plays*100}%`}}/></span>
          </li>)}</ol>
        </section>
        <section className="stats-panel">
          <div className="section-heading collection-section"><h2>{t('Когда вы слушаете','When you listen')} <i/></h2></div>
          <p className="stats-listener"><Sparkles size={15} aria-hidden="true"/>{listenerLine(s)}</p>
          <div className="stats-hours" role="img" aria-label={t('Прослушивания по часам','Plays by hour')}>
            {s.byHour.map((v,h)=><span key={h} className={h===s.peakHour?'is-peak':''} style={{height:`${Math.max(4,v/maxHour*100)}%`}} title={`${hourLabel(h)} · ${v}`}/>)}
          </div>
          <div className="stats-hours__axis" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        </section>
      </div>

      <section className="stats-panel">
        <div className="section-heading collection-section"><h2>{t('Топ треков','Top tracks')} <i/></h2>
          {topTracks.length>0&&<button type="button" className="text-button" onClick={()=>void playCollection(topTracks,0,undefined,'stats')}><Play size={14}/>{t('Слушать топ','Play the top')}</button>}</div>
        <div className="space-y-0.5">{s.topTracks.slice(0,10).map((x,i)=><div key={x.track.id} className="stats-track"><TrackRow track={x.track} index={i} collection={topTracks}/><small>{t(`${x.plays}×`,`${x.plays}×`)}</small></div>)}</div>
      </section>
    </>}
  </div>;
}
export default StatsPage;
