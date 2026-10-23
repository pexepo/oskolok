import {prisma} from '../database/client.js';
import {spotifyService} from './SpotifyService.js';
import {logger} from '../utils/logger.js';

/** Popularity normalised to 0–100 plus the raw figure of the source it came from. */
export type PopularitySource='spotify'|'deezer'|'lastfm';
export interface TrackPopularity{popularity:number;source:PopularitySource;rank?:number;plays?:number;listeners?:number}
export interface PopularityInput{id:string;title:string;artistId?:string;isrc?:string}

const TTL=12*3600000;
const nameKey=(s:string)=>s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
/** "Song (feat. X)" and "Song" are the same recording; remaster/live/remix suffixes are not stripped here. */
const titleKey=(s:string)=>nameKey(s.replace(/\((?:feat|ft|with|prod)[^)]*\)|\[(?:feat|ft|with|prod)[^\]]*\]/gi,' '));
/** Looser key: drops every bracketed or dashed suffix ("- 2011 Remaster", "(Live)"). */
const looseKey=(s:string)=>nameKey(s.replace(/\([^)]*\)|\[[^\]]*\]/g,' ').replace(/\s[-–—]\s.*$/,''));
const clamp=(n:number)=>Math.max(0,Math.min(100,Math.round(n)));
/** Deezer rank runs 0…1 000 000; Last.fm listeners are log-scaled (10M listeners = 100). */
const fromDeezer=(rank:number)=>clamp(rank/10000);
const fromLastfm=(listeners:number)=>clamp(Math.log10(listeners+1)/7*100);

// Deezer allows 50 requests per 5 s per IP; the catalogue service shares it, so stay at 40.
const deezerCalls:number[]=[];
async function deezer(path:string):Promise<any>{
  for(;;){
    const now=Date.now();while(deezerCalls.length&&now-deezerCalls[0]>5000)deezerCalls.shift();
    if(deezerCalls.length<40)break;
    await new Promise(r=>setTimeout(r,5000-(now-deezerCalls[0])+25));
  }
  deezerCalls.push(Date.now());
  const r=await fetch(`https://api.deezer.com/${path}`,{signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error(`Deezer ${r.status}`);
  const d=await r.json() as any;if(d?.error)throw new Error(d.error.message||'Deezer error');return d;
}
async function pool<T>(items:T[],size:number,fn:(item:T)=>Promise<void>){let next=0;await Promise.all(Array.from({length:Math.min(size,items.length)},async()=>{while(next<items.length)await fn(items[next++]).catch(()=>{});}));}

interface DeezerTrack{id:number;title:string;rank?:number;isrc?:string;artist?:{id:number;name:string}}
interface DeezerIndex{byId:Map<string,number>;byIsrc:Map<string,number>;byTitle:Map<string,number>;byLoose:Map<string,number>}
const indexCache=new Map<string,{at:number;index:Promise<DeezerIndex>}>();

/** Every rank Deezer reports for one artist: top 100 plus each album's tracklist (which also carries ISRCs). */
function deezerIndex(artistId:string):Promise<DeezerIndex>{
  const hit=indexCache.get(artistId);if(hit&&Date.now()-hit.at<TTL)return hit.index;
  const index=(async()=>{
    const idx:DeezerIndex={byId:new Map(),byIsrc:new Map(),byTitle:new Map(),byLoose:new Map()};
    const add=(t:DeezerTrack)=>{
      if(typeof t.rank!=='number')return;
      idx.byId.set(String(t.id),t.rank);if(t.isrc)idx.byIsrc.set(t.isrc.toUpperCase(),t.rank);
      for(const [map,key] of [[idx.byTitle,titleKey(t.title)],[idx.byLoose,looseKey(t.title)]] as const)if(key&&(map.get(key)??-1)<t.rank)map.set(key,t.rank);
    };
    const [top,albums]=await Promise.all([deezer(`artist/${artistId}/top?limit=100`).catch(()=>null),deezer(`artist/${artistId}/albums?limit=100`).catch(()=>null)]);
    if(!top&&!albums)throw new Error('Deezer artist unavailable');
    for(const t of top?.data||[])add(t);
    const albumIds:number[]=(albums?.data||[]).map((a:any)=>a.id).slice(0,60);
    await pool(albumIds,6,async id=>{const d=await deezer(`album/${id}/tracks?limit=200`);for(const t of d.data||[])add(t);});
    return idx;
  })();
  indexCache.set(artistId,{at:Date.now(),index});
  index.catch(()=>indexCache.delete(artistId));
  return index;
}

async function deezerArtistId(artist:string,tracks:PopularityInput[]):Promise<string|undefined>{
  const counts=new Map<string,number>();
  for(const t of tracks){const id=t.artistId?.match(/^deezer:artist:(\d+)$/)?.[1];if(id)counts.set(id,(counts.get(id)||0)+1);}
  const known=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];if(known)return known;
  const found=await deezer(`search/artist?q=${encodeURIComponent(artist)}&limit=5`);
  const match=(found?.data||[]).find((a:any)=>nameKey(a.name)===nameKey(artist));
  return match?String(match.id):undefined;
}

async function lastfmTopTracks(artist:string):Promise<Map<string,{plays:number;listeners:number}>>{
  const out=new Map<string,{plays:number;listeners:number}>(),key=process.env.LASTFM_API_KEY?.trim();
  if(!key)return out;
  try{
    const r=await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&autocorrect=1&limit=500&format=json&artist=${encodeURIComponent(artist)}&api_key=${encodeURIComponent(key)}`,{signal:AbortSignal.timeout(8000)});
    if(!r.ok)return out;
    const d=await r.json() as any;
    for(const t of d?.toptracks?.track||[]){const k=titleKey(String(t.name||''));const plays=Number(t.playcount),listeners=Number(t.listeners);if(k&&Number.isFinite(listeners)&&!out.has(k))out.set(k,{plays:Number.isFinite(plays)?plays:0,listeners});}
  }catch(error){logger.warn({message:error instanceof Error?error.message:String(error)},'Last.fm top tracks unavailable');}
  return out;
}

/** `transient` lists tracks left unknown only because a source failed; those are not cached. */
async function compute(artist:string,tracks:PopularityInput[]):Promise<{values:Record<string,TrackPopularity|null>;transient:Set<string>}>{
  let deezerFailed=false;const transient=new Set<string>();
  const spotifyIds=tracks.map(t=>t.id.match(/^spotify:([A-Za-z0-9]{22})$/)?.[1]).filter((id):id is string=>Boolean(id));
  const [spotify,deezerId,lastfm]=await Promise.all([
    spotifyIds.length?spotifyService.getTracksPopularity(spotifyIds).catch(()=>new Map<string,{popularity?:number;isrc?:string}>()):Promise.resolve(new Map<string,{popularity?:number;isrc?:string}>()),
    deezerArtistId(artist,tracks).catch(()=>{deezerFailed=true;return undefined;}),
    lastfmTopTracks(artist),
  ]);
  const idx=deezerId?await deezerIndex(deezerId).catch(()=>{deezerFailed=true;return undefined;}):undefined;
  const out:Record<string,TrackPopularity|null>={};
  const isrcs=new Map<string,string>();
  for(const t of tracks){
    const sp=spotify.get(t.id.replace(/^spotify:/,''));const isrc=(t.isrc||sp?.isrc)?.toUpperCase();if(isrc)isrcs.set(t.id,isrc);
    const rank=idx&&(idx.byId.get(t.id.match(/^deezer:(\d+)$/)?.[1]||'')??(isrc?idx.byIsrc.get(isrc):undefined)??idx.byTitle.get(titleKey(t.title))??idx.byLoose.get(looseKey(t.title)));
    const lf=lastfm.get(titleKey(t.title));
    const extra={...(typeof rank==='number'?{rank}:{}),...(lf?{plays:lf.plays,listeners:lf.listeners}:{})};
    out[t.id]=typeof sp?.popularity==='number'?{popularity:clamp(sp.popularity),source:'spotify',...extra}
      :typeof rank==='number'?{popularity:fromDeezer(rank),source:'deezer',...extra}
      :lf?{popularity:fromLastfm(lf.listeners),source:'lastfm',...extra}:null;
  }
  // Tracks the artist index missed (features on other artists' releases, renamed uploads):
  // an ISRC lookup when known, else a capped text search matched on title + artist.
  const missing=tracks.filter(t=>!out[t.id]).slice(0,30);
  await pool(missing,4,async t=>{
    const isrc=isrcs.get(t.id);let found:DeezerTrack|undefined;
    if(isrc)found=await deezer(`track/isrc:${encodeURIComponent(isrc)}`).catch(()=>undefined);
    if(!found){const d=await deezer(`search?limit=10&q=${encodeURIComponent(`${artist} ${t.title}`)}`).catch(()=>{transient.add(t.id);return {data:[]};});found=(d.data||[]).find((x:DeezerTrack)=>titleKey(x.title)===titleKey(t.title)&&x.artist&&nameKey(x.artist.name).includes(nameKey(artist)));}
    if(found&&typeof found.rank==='number')out[t.id]={popularity:fromDeezer(found.rank),source:'deezer',rank:found.rank};
  });
  if(deezerFailed)for(const t of tracks)if(!out[t.id])transient.add(t.id);
  return {values:out,transient};
}

const memory=new Map<string,{at:number;values:Record<string,TrackPopularity|null>}>();
const inflight=new Map<string,ReturnType<typeof compute>>();

/** Popularity for an artist's tracks keyed by track id; unknown tracks map to null. Cached 12 h. */
export async function trackPopularity(artist:string,tracks:PopularityInput[]):Promise<Record<string,TrackPopularity|null>>{
  const key=`popularity:${nameKey(artist)}`;
  let cached=memory.get(key);
  if(!cached){const row=await prisma.artistEnrichment.findUnique({where:{id:key}}).catch(()=>null);if(row){cached={at:row.updatedAt.getTime(),values:JSON.parse(row.data)};memory.set(key,cached);}}
  const fresh=cached&&Date.now()-cached.at<TTL?cached.values:{};
  const todo=tracks.filter(t=>!(t.id in fresh));
  if(todo.length){
    const running=inflight.get(key)||compute(artist,todo).finally(()=>inflight.delete(key));
    inflight.set(key,running);
    const computed=await running;
    const lasting=Object.fromEntries(Object.entries(computed.values).filter(([id,value])=>value||!computed.transient.has(id)));
    const values={...fresh,...lasting};
    memory.set(key,{at:cached&&todo.length<tracks.length?cached.at:Date.now(),values});
    await prisma.artistEnrichment.upsert({where:{id:key},create:{id:key,data:JSON.stringify(values)},update:{data:JSON.stringify(values)}}).catch(()=>{});
    return Object.fromEntries(tracks.map(t=>[t.id,computed.values[t.id]??values[t.id]??null]));
  }
  return Object.fromEntries(tracks.map(t=>[t.id,fresh[t.id]??null]));
}
