import {dedupeReleases} from '../services/releaseDedupe.js';
import {artistPersona,namesakeDecisionReady} from '../services/releaseIdentity.js';
import {pickMatch} from '../services/importMatch.js';
import type {Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {previewImport,ImportValidationError} from '../services/LibraryTransferService.js';
import {rankArtist,rankTrack,normalizeMusicText,latinFold} from '../services/trackRanking.js';
import {phraseCoverage,swapKeyboardLayout} from '../services/searchQuery.js';
import {officialCatalogService} from '../services/OfficialCatalogService.js';
import {spotifyService} from '../services/SpotifyService.js';
import {musicCatalogService} from '../services/MusicCatalogService.js';
import {soundCloudService} from '../services/SoundCloudService.js';
import {trackCacheRepository} from '../repositories/trackCacheRepository.js';
import type {Artist,Track} from '../types/index.js';
import {env} from '../config/env.js';
import {prisma} from '../database/client.js';
import {geniusArtist,geniusRelease} from '../services/GeniusService.js';
import {trackPopularity} from '../services/TrackPopularityService.js';
import {ownTitles,titleOverlap} from '../services/artistIdentity.js';
import {spicyLyricsService} from '../services/SpicyLyricsService.js';

const normalized=(s:string)=>s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
/** Several catalogue profiles can fold to the same name («17Seventeen» vs «17 SEVENTEEN»): prefer the exact spelling, then the real audience. */
const spaced=(s:string)=>s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function bestArtistMatch<T extends {name:string;followersCount?:number}>(candidates:T[],name:string):T|undefined{
  return candidates.filter(c=>artistNamesMatch(c.name,name)).sort((a,b)=>Number(spaced(b.name)===spaced(name))-Number(spaced(a.name)===spaced(name))||(b.followersCount||0)-(a.followersCount||0))[0];
}
const artistNamesMatch=(a:string,b:string)=>normalized(a)===normalized(b)||(!!latinFold(a)&&latinFold(a)===latinFold(b))||normalized(a.replace(/\s*\([^)]*\)\s*/g,''))===normalized(b.replace(/\s*\([^)]*\)\s*/g,''));
const geniusSlug=(s:string)=>s.trim().replace(/['’]/g,'').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'');
async function publicGeniusArtist(name:string):Promise<{image?:string;url?:string;followers?:number;spotifyId?:string}|undefined>{
  const cache=await prisma.artistEnrichment.findUnique({where:{id:`genius:${normalized(name)}`}});
  if(cache&&Date.now()-cache.updatedAt.getTime()<6*3600000)return JSON.parse(cache.data);
  let fallback:any=cache?JSON.parse(cache.data):undefined;
  try {
    const slug=geniusSlug(name); if(!slug)return undefined;
    let artistUrl=`https://genius.com/artists/${encodeURIComponent(slug)}`;
    try {
      const search=await fetch(`https://genius.com/api/search?q=${encodeURIComponent(name)}`,{signal:AbortSignal.timeout(5000)});
      if(search.ok){const d=await search.json() as any;const artists=(d.response?.hits||[]).flatMap((h:any)=>h.result?.primary_artists||[h.result?.primary_artist]);const match=artists.find((a:any)=>a&&artistNamesMatch(a.name,name));
      if(match?.url){const url=new URL(match.url);if(url.protocol==='https:'&&url.hostname==='genius.com'&&url.pathname.startsWith('/artists/'))artistUrl=url.href;}
      if(match?.id){
        fallback={...fallback,image:match.header_image_url||match.image_url,url:match.url};
        const r=await fetch(`https://genius.com/api/artists/${Number(match.id)}`,{signal:AbortSignal.timeout(10000)});
        if(r.ok){const a=(await r.json() as any).response?.artist;if(a&&artistNamesMatch(a.name,name)){
          const data={image:a.header_image_url||a.image_url,url:a.url,followers:typeof a.followers_count==='number'?a.followers_count:undefined,spotifyId:a.social_links?.spotify?.match(/artist\/([A-Za-z0-9]{22})/)?.[1]};
          await prisma.artistEnrichment.upsert({where:{id:`genius:${normalized(name)}`},create:{id:`genius:${normalized(name)}`,data:JSON.stringify(data)},update:{data:JSON.stringify(data)}});return data;
        }}
      }}
    } catch {}
    const response=await fetch(artistUrl,{headers:{'User-Agent':'Oskolok-Music-Player/1.0'},signal:AbortSignal.timeout(6000)});
    if(!response.ok)return fallback;
    const html=await response.text();
    const encoded=html.match(/<meta\s+itemprop="page_data"\s+content="([^"]+)"/i)?.[1];
    if(!encoded)return fallback;
    const page=JSON.parse(encoded.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&'));
    const a=page.artist;
    if(!a || ![a.name,...(a.alternate_names||[])].some((n:string)=>artistNamesMatch(n,name)))return undefined;
    const image=a.header_image_url||a.image_url;
    const spotifyId=a.social_links?.spotify?.match(/artist\/([A-Za-z0-9]{22})/)?.[1];
    return {image,url:a.url,followers:Number.isFinite(a.followers_count)?a.followers_count:undefined,spotifyId};
  } catch { return fallback; }
}
async function deezer(path:string):Promise<any>{
  for(let attempt=0;;attempt++){
    const r=await fetch(`https://api.deezer.com/${path}`,{signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw new Error('Каталог временно недоступен.');const data=await r.json() as any;
    // Quota (50 calls / 5 s) comes back as a 200 with error code 4: wait it out instead of showing an empty page.
    if(data.error?.code===4&&attempt<3){await new Promise(done=>setTimeout(done,1100*(attempt+1)));continue;}
    if(data.error)throw new Error('Релиз не найден.');return data;
  }
}
const release=(d:any)=>({explicit:d.explicit_lyrics===true,id:`deezer:album:${d.id}`,title:d.title,artworkUrl:d.cover_xl||d.cover_big||d.cover_medium,date:d.release_date,type:d.record_type||'album',trackCount:d.nb_tracks,url:d.link||`https://www.deezer.com/album/${d.id}`});
const asyncRoute=(fn:(req:Request,res:Response)=>Promise<void>)=>async(req:Request,res:Response,next:NextFunction)=>{try{await fn(req,res);}catch(e){next(e);}};

export const catalogController={
  importPreview:asyncRoute(async(req,res)=>{const {url}=z.object({url:z.string().max(2000)}).parse(req.body);try {res.json({data:await previewImport(url)});} catch(error) {if(error instanceof ImportValidationError){res.status(400).json({error:{code:'IMPORT_URL_INVALID',message:error.message}});return;}throw error;} }),
  match:asyncRoute(async(req,res)=>{
    const {artist,title}=z.object({artist:z.string().min(1).max(200),title:z.string().min(1).max(300)}).parse(req.body);
    const result=await musicCatalogService.search(`${artist} ${title}`,{limit:12});
    let candidates=result.tracks;
    if(!candidates.length)candidates=(await soundCloudService.search(`${artist} ${title}`,{limit:10,type:'tracks'})).tracks;
    const exact=candidates.find(t=>normalized(t.title)===normalized(title)&&normalized(t.artist.name)===normalized(artist));
    // Spelling differences («(feat. X)», «- Remastered», «A & B») still count as the same song; the rest is ranked for review.
    const {track,ranked}=pickMatch(artist,title,candidates);
    res.json({data:{track:exact||track,candidates:[...ranked,...candidates.filter(c=>!ranked.includes(c))].slice(0,4)}});
  }),
  suggestions:asyncRoute(async(req,res)=>{
    const query=z.string().min(2).max(200).parse(req.query.q);
    const lookup=async(text:string)=>{
      const result=await musicCatalogService.search(text,{limit:6});
      const artists=result.artists.map(artist=>({artist,score:rankArtist(artist,text)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).map(item=>item.artist);
      const tracks=[...result.tracks].sort((a,b)=>rankTrack(b,text)-rankTrack(a,text)).filter(track=>phraseCoverage(normalizeMusicText(text),normalizeMusicText(`${track.artist.name} ${track.title}`))>=.5);
      return {...result,artists,tracks};
    };
    let result=await lookup(query);
    const swapped=swapKeyboardLayout(query);
    if(swapped&&result.tracks.length+result.artists.length<2){const alt=await lookup(swapped).catch(()=>null);if(alt&&alt.tracks.length+alt.artists.length>result.tracks.length+result.artists.length)result={...alt,correctedQuery:swapped};}
    res.json({data:result});
  }),
  release:asyncRoute(async(req,res)=>{
    const id=req.params.id;
    if(/^deezer:album:\d+$/.test(id)){
      const albumId=id.split(':').at(-1),dto=await deezer(`album/${albumId}`);
      // The album object embeds at most 25 tracks (with no `next`): long mixtapes need the full tracklist.
      if((dto.tracks?.data?.length||0)<(dto.nb_tracks||0)){const full=await deezer(`album/${albumId}/tracks?limit=500`).catch(()=>null);if(full?.data?.length)dto.tracks={data:full.data};}
      const tracks:Track[]=(dto.tracks?.data||[]).map((t:any)=>officialCatalogService.mapTrack({...t,artist:t.artist||dto.artist,album:dto}));
      await Promise.all(tracks.map(t=>trackCacheRepository.setCachedTrack(t)));
      // Release pages get Spicy Lyrics ready: Spotify ids for its tracks are resolved in the background.
      spicyLyricsService.warmSpotifyIds(tracks);
      res.json({data:{...release(dto),artist:tracks[0]?.artist,tracks}});return;
    }
    if(/^spotify:album:[a-zA-Z0-9]+$/.test(id)){
      const album=await spotifyService.getAlbumFromApi(id);
      if(album){res.json({data:album});return;}
      const tracks=await spotifyService.resolveSpotifyAlbumFromEmbed(id.split(':').at(-1)!);
      if(!tracks.length){res.status(404).json({error:{message:'Spotify не отдал этот релиз.'}});return;}
      res.json({data:{id,title:tracks[0].release?.title||'Релиз Spotify',artworkUrl:tracks[0].artworkUrl,artist:tracks[0].artist,tracks,url:`https://open.spotify.com/album/${id.split(':').at(-1)}`}});return;
    }
    res.status(400).json({error:{message:'Неизвестный релиз.'}});
  }),
  geniusRelease:asyncRoute(async(req,res)=>{
    const {artist,title}=z.object({artist:z.string().min(1).max(200),title:z.string().min(1).max(300)}).parse(req.query);
    res.json({data:await geniusRelease(artist,title).catch(()=>null)});
  }),
  trackPopularity:asyncRoute(async(req,res)=>{
    const {artist,tracks}=z.object({artist:z.string().min(1).max(200),tracks:z.array(z.object({id:z.string().min(1).max(200),title:z.string().max(300),artistId:z.string().max(200).optional(),isrc:z.string().max(20).optional()})).max(600)}).parse(req.body);
    res.json({data:await trackPopularity(artist,tracks)});
  }),
  artistDetails:asyncRoute(async(req,res)=>{
    // The release the listener came from names which of several same-named artists this page is.
    const from=typeof req.query.from==='string'&&/^(deezer:album:)?\d{1,15}$/.test(req.query.from)?req.query.from.replace('deezer:album:',''):undefined;
    const data=await artistDetailsCached(req.params.id,from);
    if(!data){res.status(404).json({error:{message:'Артист не найден.'}});return;}
    res.json({data});
  })
};

// An artist card costs a dozen upstream calls (Spotify, Deezer, Genius, SoundCloud): a fresh answer is served for 20 minutes,
// an older one at once while a single refresh runs behind it, and the card a Deezer/SoundCloud page redirects to is warmed in advance.
const DETAILS_FRESH=20*60_000,DETAILS_STALE=24*3600_000;
const detailsCache=new Map<string,{at:number;data:any}>(),detailsInFlight=new Map<string,Promise<any>>();
function refreshArtistDetails(id:string,from?:string){
  const cacheId=from?`${id}@${from}`:id;
  let pending=detailsInFlight.get(cacheId);
  if(!pending){
    pending=computeArtistDetails(id,from).then(data=>{
      // A namesake check still running (Deezer pages of hundreds of releases): keep this answer only half a minute.
      if(data){const pending=data.namesakePending;delete data.namesakePending;detailsCache.set(cacheId,{at:pending?Date.now()-DETAILS_FRESH+30_000:Date.now(),data});if(detailsCache.size>400)detailsCache.delete(detailsCache.keys().next().value!);
        const next=data.linked?.spotifyId||data.linked?.deezerId;if(next&&!from&&next!==id&&!id.startsWith('spotify:')&&!detailsCache.has(next))void refreshArtistDetails(next).catch(()=>{});}
      return data;
    }).finally(()=>detailsInFlight.delete(cacheId));
    detailsInFlight.set(cacheId,pending);
  }
  return pending;
}
async function artistDetailsCached(id:string,from?:string){
  const hit=detailsCache.get(from?`${id}@${from}`:id),age=hit?Date.now()-hit.at:Infinity;
  if(hit&&age<DETAILS_FRESH)return hit.data;
  if(hit&&age<DETAILS_STALE){void refreshArtistDetails(id,from).catch(()=>{});return hit.data;}
  return refreshArtistDetails(id,from);
}

async function computeArtistDetails(id:string,from?:string):Promise<any>{
  {
    let artist:Artist|null=id.startsWith('soundcloud:')?await soundCloudService.getArtist(id):id.startsWith('deezer:')?await officialCatalogService.getArtist(id):await spotifyService.getArtist(id);
    if(!artist)return null;
    // Genius is slow-ish (several requests); start it alongside the discography.
    const geniusProfilePromise=geniusArtist(artist.name).catch(()=>null);
    const geniusSearchPromise:Promise<{image?:string;header?:string;url?:string;name?:string}|undefined>=(async()=>{
      if(!env.GENIUS_ACCESS_TOKEN)return undefined;
      try{
        const response=await fetch(`https://api.genius.com/search?q=${encodeURIComponent(artist!.name)}`,{headers:{Authorization:`Bearer ${env.GENIUS_ACCESS_TOKEN}`},signal:AbortSignal.timeout(5000)});
        if(!response.ok)return undefined;
        const data=await response.json() as any;const a=(data.response?.hits||[]).flatMap((h:any)=>h.result?.primary_artists||[h.result?.primary_artist]).find((a:any)=>a&&artistNamesMatch(a.name,artist!.name));
        return a?{image:a.image_url,header:a.header_image_url&&!/default/i.test(a.header_image_url)?a.header_image_url:undefined,url:a.url,name:a.name}:undefined;
      }catch{return undefined;}
    })();
    // The same artist on SoundCloud joins the Spotify card: its followers, link
    // and SoundCloud-only uploads (the client lists those separately).
    const soundcloudPromise:Promise<Artist|null>=artist.source==='soundcloud'?Promise.resolve(artist):soundCloudService.search(artist.name,{limit:8}).then(found=>bestArtistMatch(found.artists,artist!.name)||null).catch(()=>null);
    const releases:any[]=[];
    let releaseSource:string|undefined;
    const ownSpotifyId=artist.source==='spotify'&&/^[a-zA-Z0-9]{22}$/.test(artist.sourceId)?artist.sourceId:undefined;
    // Which Spotify profile this card is (namesake search + up to three discographies) is decided once a day,
    // not on every visit: that lookup was the biggest consumer of Spotify quota.
    const linkKey=`artist-link:v1:${artist.id}`;
    const linkRow=await prisma.artistEnrichment.findUnique({where:{id:linkKey}}).catch(()=>null);
    let link:{homonym:boolean;spotifyId?:string;primary?:{id:string;name:string;avatarUrl?:string}}|null=linkRow&&Date.now()-linkRow.updatedAt.getTime()<24*3600_000?JSON.parse(linkRow.data):null;
    let spotifyReleases:Awaited<ReturnType<typeof spotifyService.getArtistReleases>>=null;
    if(!link){
      // Same-named Spotify profiles in Spotify's own order: its search ranks by listening, the only popularity it still exposes.
      const namesakes=spotifyService.isConfigured()?((await spotifyService.search(artist.name,{limit:8}).catch(()=>null))?.artists||[]).filter(a=>artistNamesMatch(a.name,artist!.name)&&/^[a-zA-Z0-9]{22}$/.test(a.sourceId)):[];
      const primary=namesakes[0];
      // A lesser artist under a famous name (the metal «Pyrokinesis» vs the rapper «pyrokinesis») borrows nothing keyed by the name alone:
      // no Genius banner, no SoundCloud, no Deezer, no cached audience. The card says whose name it shares instead.
      const homonymNow=!!ownSpotifyId&&!!primary&&primary.sourceId!==ownSpotifyId;
      let spotifyId=ownSpotifyId;
      if(ownSpotifyId)spotifyReleases=await spotifyService.getArtistReleases(ownSpotifyId).catch(()=>null);
      if(!ownSpotifyId&&namesakes.length){
        // A Deezer or SoundCloud card joins a Spotify profile only when their discographies share a title.
        const own=await ownTitles(artist);
        for(const candidate of namesakes.slice(0,3)){
          const list=await spotifyService.getArtistReleases(candidate.sourceId).catch(()=>null);
          if(list&&(own.length?titleOverlap(own,list.map(r=>r.title))>0:candidate===primary)){spotifyId=candidate.sourceId;spotifyReleases=list;break;}
        }
      }
      link={homonym:homonymNow,spotifyId,primary:homonymNow&&primary?{id:primary.id,name:primary.name,avatarUrl:primary.avatarUrl}:undefined};
      // A decision made while Spotify was paused saw no namesakes: don't remember it.
      if(!spotifyService.rateLimitedUntil()&&spotifyService.isConfigured()){const data=JSON.stringify(link);void prisma.artistEnrichment.upsert({where:{id:linkKey},create:{id:linkKey,data},update:{data}}).catch(()=>{});}
    }else if(link.spotifyId){
      spotifyReleases=await spotifyService.getArtistReleases(link.spotifyId).catch(()=>null);
    }
    const homonym=link.homonym,primary=link.primary;
    // Spotify paused or failing (a namesake card included: the cache is keyed by this card's own Spotify id):
    // the discography it would have added comes from Spotify tracks already cached locally.
    if(!spotifyReleases?.length){const sid=link.spotifyId||(await geniusProfilePromise as {spotifyId?:string}|null)?.spotifyId;if(sid){const cached=await spotifyService.cachedReleases(String(sid).replace(/^spotify:artist:/,''),artist.name);if(cached.length)spotifyReleases=cached as never;}}
    let spotifyIdForReleases=link.spotifyId,namesakePending=false,namesakes:Array<{id:string;from:string;name:string;title:string;cover?:string;year?:number;count:number}>=[];
    if(spotifyReleases){releases.push(...spotifyReleases);releaseSource='Spotify';}
    let catalogArtist=artist.source==='deezer'?artist:undefined;
    if(!catalogArtist && !homonym){const candidates=await officialCatalogService.search(artist.name,{limit:1});catalogArtist=bestArtistMatch(candidates.artists,artist!.name);}
    if(catalogArtist&&!homonym){try{
      // Same-named Deezer profiles are pooled; the persona keeps this artist's releases from all of them.
      const personaJob=artistPersona(catalogArtist.sourceId||catalogArtist.id,{referenceTitles:(spotifyReleases||[]).map(r=>r.title),seedAlbum:from});
      const extra:any[]=[];let page=0;while(page<5){const data=await deezer(`artist/${catalogArtist.sourceId}/albums?limit=100&index=${page*100}`);extra.push(...(data.data||[]).map(release));if(!data.next)break;page++;}
      // Deezer files namesakes under one profile; their releases stay off this page.
      const persona=await personaJob;if(!persona||!namesakeDecisionReady(catalogArtist.sourceId||catalogArtist.id))namesakePending=true;
      if(persona){
        for(let i=extra.length-1;i>=0;i--)if(persona.foreign.has(String(extra[i].id).split(':').at(-1)||''))extra.splice(i,1);
        extra.push(...persona.borrowed.map(release));
        namesakes=persona.others.map(o=>({id:`deezer:artist:${o.profileId}`,from:o.seedAlbum,name:o.name,title:o.title,cover:o.cover,year:o.year,count:o.count}));
      }
      // Verify shared discography before merging same-named artists across services.
      if(!spotifyReleases?.length||titleOverlap(spotifyReleases.map(r=>r.title),extra.map(r=>r.title))>0){releases.push(...extra);releaseSource=spotifyReleases?.length?'Spotify · Deezer':'Deezer';}
    }catch{}}
    // Services classify the same EP differently; one release stays once with its EP label and explicit edition.
    {const kept=dedupeReleases(releases);releases.length=0;releases.push(...kept);}
    releases.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    let genius:{image?:string;header?:string;url?:string;name?:string;followers?:number;spotifyId?:string}|undefined;
    genius=await geniusSearchPromise;
    const geniusProfile=await geniusProfilePromise;
    if(geniusProfile)genius={...genius,image:geniusProfile.image||genius?.image,header:geniusProfile.header||genius?.header,url:geniusProfile.url,name:geniusProfile.name,followers:geniusProfile.followers,spotifyId:geniusProfile.spotifyId};
    if(!genius || genius.followers===undefined) {
      const publicGenius=await publicGeniusArtist(artist.name);
      if(publicGenius) genius={...genius,...publicGenius};
    }
    // Genius knows one artist per name: keep it only if it names this Spotify profile, or — lacking that — if this is the name's owner.
    const geniusOwn=!!genius&&(genius.spotifyId?!spotifyIdForReleases||genius.spotifyId===spotifyIdForReleases:!homonym);
    if(!geniusOwn)genius=undefined;
    const spotifyId=spotifyIdForReleases||genius?.spotifyId;
    let spotifyArtist=spotifyId?await spotifyService.getArtist(`spotify:artist:${spotifyId}`):null;
    const spotifyKey=spotifyId?`spotify:id:${spotifyId}`:`spotify:${normalized(artist.name)}`;
    if(spotifyArtist?.followersCount!==undefined||spotifyArtist?.monthlyListeners!==undefined){await prisma.artistEnrichment.upsert({where:{id:spotifyKey},create:{id:spotifyKey,data:JSON.stringify(spotifyArtist)},update:{data:JSON.stringify(spotifyArtist)}});}
    else{const cached=await prisma.artistEnrichment.findUnique({where:{id:spotifyKey}});if(cached)spotifyArtist=JSON.parse(cached.data);}
    const metrics=[
      {platform:'Spotify',label:spotifyArtist?.monthlyListeners!==undefined?'Слушатели за месяц':'Подписчики',value:spotifyArtist?.monthlyListeners??spotifyArtist?.followersCount,url:spotifyArtist?.permalinkUrl||`https://open.spotify.com/search/${encodeURIComponent(artist.name)}`,note:spotifyArtist?.monthlyListeners!==undefined||spotifyArtist?.followersCount!==undefined?undefined:'Публичная статистика Spotify временно недоступна'},
      {platform:'Яндекс Музыка',label:'Слушатели за месяц',url:`https://music.yandex.ru/search?text=${encodeURIComponent(artist.name)}`,note:'Нет подключённого источника статистики'},
      ...(catalogArtist?.followersCount!==undefined?[{platform:'Deezer',label:'Поклонники',value:catalogArtist.followersCount,url:catalogArtist.permalinkUrl}]:[])
    ];
    // SoundCloud search is flaky (client keys get throttled); a found link is
    // remembered so the merged card does not come and go.
    const soundcloudKey=`soundcloud:${normalized(artist.name)}`;
    let soundcloudArtist=homonym?null:await soundcloudPromise;
    if(soundcloudArtist)await prisma.artistEnrichment.upsert({where:{id:soundcloudKey},create:{id:soundcloudKey,data:JSON.stringify(soundcloudArtist)},update:{data:JSON.stringify(soundcloudArtist)}}).catch(()=>{});
    else if(!homonym){const cached=await prisma.artistEnrichment.findUnique({where:{id:soundcloudKey}}).catch(()=>null);if(cached)soundcloudArtist=JSON.parse(cached.data);}
    if(soundcloudArtist)metrics.splice(1,0,{platform:'SoundCloud',label:'Подписчики',value:soundcloudArtist.followersCount,url:soundcloudArtist.permalinkUrl||`https://soundcloud.com/search/people?q=${encodeURIComponent(artist.name)}`,note:undefined});
    const spotifyCardId=spotifyArtist?.id||(spotifyId?`spotify:artist:${spotifyId}`:undefined);
    const linked={spotifyId:spotifyCardId,soundcloudId:soundcloudArtist?.id,deezerId:catalogArtist?.id};
    return {namesakePending,namesakes:homonym?[]:namesakes,linked,bannerUrl:genius?.header,artist:{...artist,avatarUrl:genius?.image||spotifyArtist?.avatarUrl||artist.avatarUrl||catalogArtist?.avatarUrl},imageSource:genius?.image?'Genius':spotifyArtist?.avatarUrl?'Spotify':artist.source,geniusUrl:genius?.url,metrics,releases,releaseSource,genius:geniusOwn?geniusProfile||undefined:undefined,homonym:homonym&&primary?primary:undefined};
  }
}
