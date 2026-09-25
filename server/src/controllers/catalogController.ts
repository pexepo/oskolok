import type {Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {previewImport} from '../services/LibraryTransferService.js';
import {officialCatalogService} from '../services/OfficialCatalogService.js';
import {spotifyService} from '../services/SpotifyService.js';
import {soundCloudService} from '../services/SoundCloudService.js';
import {trackCacheRepository} from '../repositories/trackCacheRepository.js';
import type {Artist,Track} from '../types/index.js';
import {env} from '../config/env.js';
import {prisma} from '../database/client.js';

const normalized=(s:string)=>s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const artistNamesMatch=(a:string,b:string)=>normalized(a)===normalized(b)||normalized(a.replace(/\s*\([^)]*\)\s*/g,''))===normalized(b.replace(/\s*\([^)]*\)\s*/g,''));
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
  const r=await fetch(`https://api.deezer.com/${path}`,{signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error('Каталог временно недоступен.');const data=await r.json() as any;if(data.error)throw new Error('Релиз не найден.');return data;
}
const release=(d:any)=>({id:`deezer:album:${d.id}`,title:d.title,artworkUrl:d.cover_xl||d.cover_big||d.cover_medium,date:d.release_date,type:d.record_type||'album',trackCount:d.nb_tracks,url:d.link||`https://www.deezer.com/album/${d.id}`});
const asyncRoute=(fn:(req:Request,res:Response)=>Promise<void>)=>async(req:Request,res:Response,next:NextFunction)=>{try{await fn(req,res);}catch(e){next(e);}};

export const catalogController={
  importPreview:asyncRoute(async(req,res)=>{const {url}=z.object({url:z.string().max(2000)}).parse(req.body);res.json({data:await previewImport(url)});}),
  match:asyncRoute(async(req,res)=>{
    const {artist,title}=z.object({artist:z.string().min(1).max(200),title:z.string().min(1).max(300)}).parse(req.body);
    const result=await officialCatalogService.search(`${artist} ${title}`,{limit:12});
    let candidates=result.tracks;
    if(!candidates.length)candidates=(await soundCloudService.search(`${artist} ${title}`,{limit:10,type:'tracks'})).tracks;
    const exact=candidates.find(t=>normalized(t.title)===normalized(title)&&normalized(t.artist.name)===normalized(artist));
    res.json({data:{track:exact||null,candidates:candidates.slice(0,4)}});
  }),
  suggestions:asyncRoute(async(req,res)=>{
    const query=z.string().min(2).max(200).parse(req.query.q);
    const result=await officialCatalogService.search(query,{limit:5});
    res.json({data:result});
  }),
  release:asyncRoute(async(req,res)=>{
    const id=req.params.id;
    if(/^deezer:album:\d+$/.test(id)){
      const dto=await deezer(`album/${id.split(':').at(-1)}`);
      const tracks:Track[]=(dto.tracks?.data||[]).map((t:any)=>officialCatalogService.mapTrack({...t,artist:t.artist||dto.artist,album:dto}));
      await Promise.all(tracks.map(t=>trackCacheRepository.setCachedTrack(t)));
      res.json({data:{...release(dto),artist:tracks[0]?.artist,tracks}});return;
    }
    if(/^spotify:album:[a-zA-Z0-9]+$/.test(id)){
      const tracks=await spotifyService.resolveSpotifyAlbumFromEmbed(id.split(':').at(-1)!);
      if(!tracks.length){res.status(404).json({error:{message:'Spotify не отдал этот релиз.'}});return;}
      res.json({data:{id,title:tracks[0].release?.title||'Релиз Spotify',artworkUrl:tracks[0].artworkUrl,artist:tracks[0].artist,tracks,url:`https://open.spotify.com/album/${id.split(':').at(-1)}`}});return;
    }
    res.status(400).json({error:{message:'Неизвестный релиз.'}});
  }),
  artistDetails:asyncRoute(async(req,res)=>{
    const id=req.params.id;
    let artist:Artist|null=id.startsWith('soundcloud:')?await soundCloudService.getArtist(id):id.startsWith('deezer:')?await officialCatalogService.getArtist(id):await spotifyService.getArtist(id);
    if(!artist){res.status(404).json({error:{message:'Артист не найден.'}});return;}
    let catalogArtist=artist.source==='deezer'?artist:undefined;
    if(!catalogArtist){const candidates=await officialCatalogService.search(artist.name,{limit:1});catalogArtist=candidates.artists.find(a=>artistNamesMatch(a.name,artist!.name));}
    const releases:any[]=[];
    if(catalogArtist){try{let page=0;while(page<5){const data=await deezer(`artist/${catalogArtist.sourceId}/albums?limit=100&index=${page*100}`);releases.push(...(data.data||[]).map(release));if(!data.next)break;page++;}}catch{}}
    let genius:{image?:string;url?:string;name?:string;followers?:number;spotifyId?:string}|undefined;
    if(env.GENIUS_ACCESS_TOKEN){try{
      const response=await fetch(`https://api.genius.com/search?q=${encodeURIComponent(artist.name)}`,{headers:{Authorization:`Bearer ${env.GENIUS_ACCESS_TOKEN}`},signal:AbortSignal.timeout(5000)});
      if(response.ok){const data=await response.json() as any;const a=(data.response?.hits||[]).flatMap((h:any)=>h.result?.primary_artists||[h.result?.primary_artist]).find((a:any)=>a&&artistNamesMatch(a.name,artist!.name));if(a)genius={image:a.image_url,url:a.url,name:a.name};}
    }catch{}}
    if(!genius || genius.followers===undefined) {
      const publicGenius=await publicGeniusArtist(artist.name);
      if(publicGenius) genius={...genius,...publicGenius};
    }
    const spotifyId=artist.source==='spotify'&&/^[a-zA-Z0-9]{22}$/.test(artist.sourceId)?artist.sourceId:genius?.spotifyId;
    let spotifyArtist=spotifyId?await spotifyService.getArtist(`spotify:artist:${spotifyId}`):null;
    const spotifyKey=`spotify:${normalized(artist.name)}`;
    if(spotifyArtist?.followersCount!==undefined||spotifyArtist?.monthlyListeners!==undefined){await prisma.artistEnrichment.upsert({where:{id:spotifyKey},create:{id:spotifyKey,data:JSON.stringify(spotifyArtist)},update:{data:JSON.stringify(spotifyArtist)}});}
    else{const cached=await prisma.artistEnrichment.findUnique({where:{id:spotifyKey}});if(cached)spotifyArtist=JSON.parse(cached.data);}
    const metrics=[
      {platform:'Spotify',label:spotifyArtist?.monthlyListeners!==undefined?'Слушатели за месяц':'Подписчики',value:spotifyArtist?.monthlyListeners??spotifyArtist?.followersCount,url:spotifyArtist?.permalinkUrl||`https://open.spotify.com/search/${encodeURIComponent(artist.name)}`,note:spotifyArtist?.monthlyListeners!==undefined||spotifyArtist?.followersCount!==undefined?undefined:'Публичная статистика Spotify временно недоступна'},
      {platform:'Яндекс Музыка',label:'Слушатели за месяц',url:`https://music.yandex.ru/search?text=${encodeURIComponent(artist.name)}`,note:'Нет подключённого источника статистики'},
      {platform:'Genius',label:'Подписчики страницы',value:genius?.followers,url:genius?.url||`https://genius.com/search?q=${encodeURIComponent(artist.name)}`,note:'Публичное число подписчиков страницы Genius'},
      ...(catalogArtist?.followersCount!==undefined?[{platform:'Deezer',label:'Поклонники',value:catalogArtist.followersCount,url:catalogArtist.permalinkUrl}]:[])
    ];
    res.json({data:{artist:{...artist,avatarUrl:genius?.image||spotifyArtist?.avatarUrl||artist.avatarUrl||catalogArtist?.avatarUrl},imageSource:genius?.image?'Genius':spotifyArtist?.avatarUrl?'Spotify':artist.source,geniusUrl:genius?.url,metrics,releases,releaseSource:catalogArtist?'Deezer':undefined}});
  })
};
