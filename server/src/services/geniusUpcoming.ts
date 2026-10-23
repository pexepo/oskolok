import {geniusArtist,geniusApi,geniusCached,geniusDate} from './GeniusService.js';
import {artistKey} from './artistFollow.js';

export interface GeniusUpcomingAlbum {id:number;name:string;url:string;cover?:string;date?:string;dateKnown:boolean;trackCount?:number}
export interface GeniusUnreleasedSong {id:number;title:string;url:string;art?:string;views?:number;date?:string;reason:'unreleased'|'future'|'title'|'collection'}
export interface GeniusUpcoming {artist?:{id:number;name:string;url:string};upcoming:GeniusUpcomingAlbum[];unreleased:GeniusUnreleasedSong[]}

const COLLECTION=/unreleased|неизд|leak|слив|snippet|сниппет|vault|archive|архив|demos?\b|демо/i;
const TITLE_HINT=/[([](?:[^)\]]*\b(?:snippet|unreleased|leak|demo|v\d)\b[^)\]]*|[^)\]]*(?:сниппет|неизд|слив|демо)[^)\]]*)[)\]]/i;
/** Earliest day a partial Genius date ("2026", "2026-11") can mean, so "this year" never reads as future. */
const earliest=(date?:string)=>!date?undefined:date.length===4?`${date}-01-01`:date.length===7?`${date}-01`:date.slice(0,10);
const isFuture=(date?:string)=>{const d=earliest(date);return !!d&&d>new Date().toISOString().slice(0,10);};

async function pages(path:string,key:string,max:number){
 const all:any[]=[];for(let page=1;page&&page<=max;){const r=await geniusApi(`${path}${path.includes('?')?'&':'?'}per_page=50&page=${page}`).catch(()=>null);if(!r)break;all.push(...(r[key]||[]));page=r.next_page||0;}
 return all;
}

/**
 * Genius albums that are announced but not out (future date, or undated with only unreleased songs or no tracklist yet)
 * and songs Genius marks unreleased (lyrics_state "unreleased", future date, "[Snippet]"-style titles, or sitting on an
 * "Unreleased"-style collection album). Cached 12 h in ArtistEnrichment through GeniusService.
 */
export async function geniusUpcoming(name:string):Promise<GeniusUpcoming>{
 const empty={upcoming:[],unreleased:[]};
 const profile=await geniusArtist(name).catch(()=>null);if(!profile)return empty;
 return await geniusCached<GeniusUpcoming>(`geniusupcoming:${artistKey(name)}`,async()=>{
  const [albums,songs]=await Promise.all([pages(`/artists/${profile.id}/albums`,'albums',3),pages(`/artists/${profile.id}/songs?sort=popularity`,'songs',4)]);
  const own=(s:any)=>s?.primary_artist?.id===profile.id||(s?.primary_artists||[]).some((a:any)=>a.id===profile.id);
  const unreleased=new Map<number,GeniusUnreleasedSong>();
  const addSong=(s:any,reason:GeniusUnreleasedSong['reason'])=>{if(!s?.id||!s.title||unreleased.has(s.id))return;unreleased.set(s.id,{id:s.id,title:s.title,url:s.url,art:s.song_art_image_thumbnail_url||undefined,views:s.stats?.pageviews,date:geniusDate(s)||undefined,reason});};
  for(const s of songs.filter(own)){const date=geniusDate(s);if(s.lyrics_state==='unreleased')addSong(s,'unreleased');else if(isFuture(date))addSong(s,'future');else if(TITLE_HINT.test(s.title||''))addSong(s,'title');}
  const upcoming:GeniusUpcomingAlbum[]=[];
  // Undated albums need their tracklist to tell an announced project from an old undated compilation.
  const undated=albums.filter(a=>!geniusDate(a)).slice(0,10);
  const probe=[...undated,...albums.filter(a=>COLLECTION.test(a.name||'')&&geniusDate(a)).slice(0,4)];
  const lists=await Promise.all(probe.map(a=>geniusApi(`/albums/${a.id}/tracks?per_page=50`).then(r=>(r.tracks||[]) as any[]).catch(()=>null)));
  const tracklists=new Map<number,any[]|null>(probe.map((a,i)=>[a.id,lists[i]]));
  for(const a of albums){
   const date=geniusDate(a),tracks=tracklists.get(a.id),cover=a.cover_art_thumbnail_url||a.cover_art_url||undefined;
   if(COLLECTION.test(a.name||'')){for(const t of tracks||[])if(own(t.song)||!t.song?.primary_artist)addSong(t.song,'collection');continue;}
   if(date){if(isFuture(date))upcoming.push({id:a.id,name:a.name,url:a.url,cover,date,dateKnown:true,trackCount:tracks?.length});continue;}
   if(!tracks)continue;
   const pending=tracks.filter(t=>t.song?.lyrics_state==='unreleased'||!geniusDate(t.song||{}));
   if(!tracks.length||pending.length/tracks.length>=.6){upcoming.push({id:a.id,name:a.name,url:a.url,cover,dateKnown:false,trackCount:tracks.length||undefined});for(const t of pending)addSong(t.song,'unreleased');}
  }
  return {artist:{id:profile.id,name:profile.name,url:profile.url},upcoming:upcoming.sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')),unreleased:[...unreleased.values()].sort((a,b)=>(b.views||0)-(a.views||0)).slice(0,80)};
 })||empty;
}
