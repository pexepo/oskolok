import React from 'react';
import {apiClient} from '../../api/apiClient.js';
import type {Track} from '../../types/index.js';
import type {OrderFacts} from '../../audio/mixOrder.js';

/** Facts (genres, tempo) of playlist tracks, fetched in one batch; while the server is still asking Deezer,
 * asked again a few times. Shared across pages for the session. */
const known=new Map<string,OrderFacts>();
export function usePlaylistFacts(tracks:Track[]):{facts:Record<string,OrderFacts>;loading:boolean}{
  const [,bump]=React.useReducer((x:number)=>x+1,0),[loading,setLoading]=React.useState(false);
  const key=tracks.map(t=>t.id).join('|');
  React.useEffect(()=>{
    let cancelled=false,tries=0,timer:ReturnType<typeof setTimeout>|undefined;
    const ask=async()=>{
      const missing=tracks.filter(t=>!known.has(t.id));
      if(!missing.length){setLoading(false);return;}
      setLoading(true);
      const data=await apiClient.request<{facts:Record<string,OrderFacts>;pending:number}>('/tracks/facts',{method:'POST',body:JSON.stringify({tracks:missing.slice(0,300).map(t=>({id:t.id,title:t.title,artist:t.artist?.name||'',...(t.genre?{genre:t.genre}:{})}))})}).catch(()=>null);
      if(cancelled)return;
      if(data)for(const [id,f] of Object.entries(data.facts))known.set(id,f);
      bump();
      if(data?.pending&&++tries<4)timer=setTimeout(()=>void ask(),4000);else setLoading(false);
    };
    void ask();
    return()=>{cancelled=true;clearTimeout(timer);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key]);
  const facts:Record<string,OrderFacts>={};
  for(const t of tracks){const f=known.get(t.id);if(f)facts[t.id]=f;}
  return {facts,loading};
}

/** Deezer genre names in Russian; anything else is shown as Deezer names it. */
const RU:Record<string,string>={'Pop':'Поп','Rap/Hip Hop':'Рэп и хип-хоп','Rock':'Рок','Dance':'Дэнс','Alternative':'Альтернатива','Electro':'Электроника','Folk':'Фолк','Reggae':'Регги','Jazz':'Джаз','Classical':'Классика','Films/Games':'Кино и игры','Metal':'Метал','Soul & Funk':'Соул и фанк','Blues':'Блюз','Country':'Кантри','Latin Music':'Латино','Kids':'Детская','Chanson':'Шансон','Asian Music':'Азиатская','African Music':'Африканская','Brazilian Music':'Бразильская','Indian Music':'Индийская','R&B':'R&B','Singer & Songwriter':'Авторская песня','Indie Pop':'Инди-поп','Indie Rock':'Инди-рок','Electro Pop/Electro Rock':'Электропоп','Techno/House':'Техно и хаус','Dubstep':'Дабстеп','Trance':'Транс','Hard Rock':'Хард-рок','Russian Rap':'Русский рэп','Russian Pop':'Русский поп','Russian Rock':'Русский рок','Lo-fi':'Лоу-фай'};
export const genreLabel=(name:string,ru:boolean)=>ru?RU[name]||name:name;

/** Genres present in the playlist, most common first; a genre needs two tracks to be worth a chip. */
export function playlistGenres(tracks:Track[],facts:Record<string,OrderFacts>):Array<{name:string;count:number}>{
  const counts=new Map<string,number>();
  for(const t of tracks)for(const g of facts[t.id]?.genres||[])counts.set(g,(counts.get(g)||0)+1);
  return [...counts].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([name,count])=>({name,count}));
}
