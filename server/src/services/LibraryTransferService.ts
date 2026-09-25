import { officialCatalogService } from './OfficialCatalogService.js';
import { spotifyService } from './SpotifyService.js';
import { soundCloudService } from './SoundCloudService.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import type { Track } from '../types/index.js';

export function parseImportUrl(input:string) {
  let u:URL;try{u=new URL(input.trim());}catch{throw new Error('Вставьте полную HTTPS-ссылку на трек, альбом или плейлист.');}
  if(u.protocol!=='https:'||u.username||u.password||u.port)throw new Error('Нужна обычная HTTPS-ссылка музыкальной площадки.');
  const host=u.hostname.replace(/^www\./,'');
  if(!['open.spotify.com','deezer.com','soundcloud.com','music.yandex.ru','music.yandex.com'].includes(host))throw new Error('Поддерживаются полные ссылки Spotify, Deezer и SoundCloud. Для других площадок загрузите список треков.');
  return {u,host};
}

export async function previewImport(input:string) {
  const {u,host}=parseImportUrl(input);
  let tracks:Track[]=[],title='Импортированная коллекция',total:number|undefined,warning='';
  if(host==='soundcloud.com') {const data=await soundCloudService.resolveLink(u.href);({tracks,title,total}=data);}
  else if(host==='open.spotify.com') {
    const match=u.pathname.match(/^\/(?:intl-[a-z]+\/)?(track|album|playlist)\/([a-zA-Z0-9]+)\/?$/);
    if(!match)throw new Error('Нужна ссылка Spotify на трек, альбом или плейлист.');
    const data=await spotifyService.resolveSpotifyUrl(`https://open.spotify.com/${match[1]}/${match[2]}`);
    tracks=data?.tracks||[];title=data?.playlists[0]?.title||tracks[0]?.release?.title||tracks[0]?.title||title;
    total=data?.playlists[0]?.trackCount || (match[1]==='track'||match[1]==='album'?tracks.length:undefined);
    if(total&&tracks.length<total) warning=`Получено ${tracks.length} из ${total} треков Spotify. Для полного переноса добавьте SPOTIFY_CLIENT_ID и SPOTIFY_CLIENT_SECRET или загрузите CSV/TXT.`;
    else warning='Каталог Spotify импортирован. Доступность аудио проверяется при воспроизведении.';
  } else if(host==='deezer.com') {
    const match=u.pathname.match(/^\/(?:[a-z]{2}\/)?(track|album|playlist)\/(\d+)\/?$/);
    if(!match)throw new Error('Нужна ссылка Deezer на трек, альбом или плейлист.');
    const response=await fetch(`https://api.deezer.com/${match[1]}/${match[2]}`,{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Deezer не ответил. Попробуйте ещё раз.');
    const dto=await response.json() as any;
    if(dto.error)throw new Error('Релиз не найден или закрыт.');
    title=dto.title;total=match[1]==='track'?1:dto.nb_tracks||dto.tracks?.total;
    if(match[1]==='track')tracks=[officialCatalogService.mapTrack(dto)];
    else {
      let items=dto.tracks?.data||[],next=dto.tracks?.next;
      while(next&&items.length<1000){const nextUrl=new URL(next);if(nextUrl.hostname!=='api.deezer.com')break;nextUrl.protocol='https:';const r=await fetch(nextUrl,{signal:AbortSignal.timeout(8000)});if(!r.ok)break;const page=await r.json() as any;items.push(...(page.data||[]));next=page.next;}
      tracks=items.slice(0,1000).map((t:any)=>officialCatalogService.mapTrack({...t,artist:t.artist||dto.artist,album:t.album||(match[1]==='album'?dto:undefined)}));
      if(total&&tracks.length<total)warning=`Доступно ${tracks.length} из ${total} треков. Можно сохранить доступную часть.`;
    }
  } else throw new Error('Прямой импорт Яндекс Музыки пока недоступен. Загрузите CSV/TXT со списком «Исполнитель — Название»: найдём соответствия и покажем их перед сохранением.');
  tracks=[...new Map(tracks.map(t=>[t.id,t])).values()];
  if(total&&tracks.length<total&&!warning)warning=`Получено ${tracks.length} из ${total} треков. Часть записей недоступна у источника.`;
  if(!tracks.length)throw new Error('Источник не отдал треки. Проверьте доступность ссылки или загрузите список CSV/TXT.');
  await Promise.all(tracks.map(t=>trackCacheRepository.setCachedTrack(t)));
  return {title,tracks,total,warning,source:host};
}
