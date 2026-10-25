import type {Request,Response} from 'express';
import {prisma} from '../database/client.js';
import {dz} from './releaseIdentity.js';
import {normalizeMusicText} from './trackRanking.js';

/**
 * Genre and tempo of playlist tracks, for the playlist genre filter and «Микс» ordering. Genres are the Deezer
 * album's; tempo is Осколок's own beat analysis when the track has been mixed, else Deezer's BPM. Cached for good:
 * neither changes. Deezer's shared quota limiter keeps this a background citizen.
 */
export interface TrackFacts{genres:string[];bpm?:number;energy?:number}
interface FactsInput{id:string;title:string;artist:string;genre?:string}

const factsKey=(id:string)=>`track-facts:v1:${id}`,albumKey=(id:string)=>`dz-album-genres:v1:${id}`;
const inFlight=new Map<string,Promise<TrackFacts|null>>();

async function albumGenres(albumId:string):Promise<string[]>{
  const row=await prisma.artistEnrichment.findUnique({where:{id:albumKey(albumId)}}).catch(()=>null);
  if(row)return JSON.parse(row.data);
  const album=await dz(`album/${albumId}`);
  if(!album)return [];
  const genres=[...new Set<string>((album.genres?.data||[]).map((g:{name?:string})=>String(g.name||'').trim()).filter(Boolean))];
  // Many albums list no genres but still carry a main genre_id.
  if(!genres.length&&Number(album.genre_id)>0){const genre=await dz(`genre/${Number(album.genre_id)}`);if(genre?.name)genres.push(String(genre.name));}
  const data=JSON.stringify(genres);
  await prisma.artistEnrichment.upsert({where:{id:albumKey(albumId)},create:{id:albumKey(albumId),data},update:{data}}).catch(()=>{});
  return genres;
}

async function lookup(input:FactsInput):Promise<TrackFacts|null>{
  let dzId=/^deezer:(\d+)$/.exec(input.id)?.[1];
  if(!dzId){
    // Deezer's advanced syntax (artist:"…" track:"…") currently finds nothing, so a plain query, checked by artist.
    const found=await dz(`search?q=${encodeURIComponent(`${input.artist} ${input.title}`)}&limit=5`);
    if(!found)return null; // quota or network: ask again later
    const artist=normalizeMusicText(input.artist),hits:any[]=found.data||[];
    const hit=hits.find(h=>{const name=normalizeMusicText(String(h.artist?.name||''));return !!name&&(name.includes(artist)||artist.includes(name));});
    dzId=hit?.id?String(hit.id):undefined;
  }
  const track=dzId?await dz(`track/${dzId}`):null;
  if(dzId&&!track)return null;
  const genres=track?.album?.id?await albumGenres(String(track.album.id)):[];
  if(input.genre&&!genres.length)genres.push(input.genre);
  // Not on Deezer: remembered as such (empty facts), asking again would find nothing new.
  const facts:TrackFacts={genres,...(Number(track?.bpm)>40?{bpm:Math.round(Number(track.bpm)*10)/10}:{})};
  const data=JSON.stringify(facts);
  await prisma.artistEnrichment.upsert({where:{id:factsKey(input.id)},create:{id:factsKey(input.id),data},update:{data}}).catch(()=>{});
  return facts;
}

/** Our beat analysis beats Deezer's BPM (which is often missing or off by double time). */
async function withMix(id:string,facts:TrackFacts):Promise<TrackFacts>{
  const row=await prisma.artistEnrichment.findUnique({where:{id:`mix:v1:${id}`}}).catch(()=>null);
  if(!row)return facts;
  const mix=JSON.parse(row.data) as {bpm:number;confidence:number;energy:number[]};
  if(mix.confidence<.15)return facts;
  const energy=mix.energy.length?Math.round(mix.energy.reduce((s,x)=>s+x,0)/mix.energy.length*1000)/1000:undefined;
  return {...facts,bpm:mix.bpm,...(energy===undefined?{}:{energy})};
}

export async function trackFacts(inputs:FactsInput[],budgetMs=6000):Promise<{facts:Record<string,TrackFacts>;pending:number}>{
  const facts:Record<string,TrackFacts>={};
  const rows=await prisma.artistEnrichment.findMany({where:{id:{in:inputs.map(i=>factsKey(i.id))}}}).catch(()=>[]);
  const known=new Map(rows.map(r=>[r.id,JSON.parse(r.data) as TrackFacts]));
  const missing:Array<Promise<unknown>>=[];
  await Promise.all(inputs.map(async input=>{
    const cached=known.get(factsKey(input.id));
    if(cached){facts[input.id]=await withMix(input.id,cached);return;}
    let job=inFlight.get(input.id);
    if(!job){job=lookup(input).catch(()=>null).finally(()=>inFlight.delete(input.id));inFlight.set(input.id,job);}
    missing.push(job.then(async found=>{if(found)facts[input.id]=await withMix(input.id,found);}));
  }));
  // Whatever Deezer answers within the budget is returned; the rest keeps loading for the next ask.
  await Promise.race([Promise.all(missing),new Promise(r=>setTimeout(r,budgetMs))]);
  return {facts,pending:inputs.filter(i=>!facts[i.id]).length};
}

export async function trackFactsController(req:Request,res:Response){
  const raw=Array.isArray(req.body?.tracks)?req.body.tracks:[];
  const inputs:FactsInput[]=raw.slice(0,300).filter((t:unknown):t is FactsInput=>!!t&&typeof (t as FactsInput).id==='string'&&typeof (t as FactsInput).title==='string'&&typeof (t as FactsInput).artist==='string')
    .map((t:FactsInput)=>({id:t.id.slice(0,200),title:t.title.slice(0,200),artist:t.artist.slice(0,200),...(typeof t.genre==='string'&&t.genre?{genre:t.genre.slice(0,60)}:{})}));
  res.json({data:await trackFacts(inputs)});
}
