import {spicyLyricsService} from './SpicyLyricsService.js';
import {deduplicateSearchTracks} from './trackRanking.js';
import { spotifyService } from './SpotifyService.js';
import { soundCloudService } from './SoundCloudService.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import type { Track } from '../types/index.js';

export class ImportValidationError extends Error {}

export function parseImportUrl(input:string) {
  let u:URL;try{u=new URL(input.trim());}catch{throw new ImportValidationError('Вставьте полную HTTPS-ссылку на трек, альбом или плейлист.');}
  if(u.protocol!=='https:'||u.username||u.password||u.port)throw new ImportValidationError('Нужна обычная HTTPS-ссылка музыкальной площадки.');
  const host=u.hostname.replace(/^www\./,'');
  if(!['open.spotify.com','soundcloud.com','music.yandex.ru','music.yandex.com'].includes(host))throw new ImportValidationError('Поддерживаются полные ссылки Spotify и SoundCloud. Для других площадок загрузите список треков.');
  return {u,host};
}

export async function previewImport(input:string) {
  const {u,host}=parseImportUrl(input);
  let tracks:Track[]=[],title='Импортированная коллекция',total:number|undefined,warning='';
  if(host==='soundcloud.com') {const data=await soundCloudService.resolveLink(u.href);({tracks,title,total}=data);}
  else if(host==='open.spotify.com') {
    const match=u.pathname.match(/^\/(?:intl-[a-z]+\/)?(track|album|playlist)\/([a-zA-Z0-9]+)\/?$/);
    if(!match)throw new ImportValidationError('Нужна ссылка Spotify на трек, альбом или плейлист.');
    const data=await spotifyService.resolveSpotifyUrl(`https://open.spotify.com/${match[1]}/${match[2]}`);
    tracks=data?.tracks||[];title=data?.playlists[0]?.title||tracks[0]?.release?.title||tracks[0]?.title||title;
    total=data?.playlists[0]?.trackCount || (match[1]==='track'||match[1]==='album'?tracks.length:undefined);
    // Without a signed-in Spotify user the public embed lists at most 100 tracks.
    if(total&&tracks.length<total) warning=`Получено ${tracks.length} из ${total} треков. Остальные можно перенести файлом CSV из Exportify.`;
    else if(match[1]==='playlist'&&tracks.length>=100) warning='Spotify без входа показывает первые 100 треков плейлиста. Если в нём больше — выгрузите его в CSV через Exportify и загрузите файл ниже.';
    else warning='';
  } else throw new ImportValidationError('Прямой импорт Яндекс Музыки пока недоступен. Загрузите CSV/TXT со списком «Исполнитель — Название»: найдём соответствия и покажем их перед сохранением.');
  tracks=deduplicateSearchTracks([...new Map(tracks.map(t=>[t.id,t])).values()]);
  spicyLyricsService.warmSpotifyIds(tracks);
  if(total&&tracks.length<total&&!warning)warning=`Получено ${tracks.length} из ${total} треков. Часть записей недоступна у источника.`;
  if(!tracks.length)throw new Error('Источник не отдал треки. Проверьте доступность ссылки или загрузите список CSV/TXT.');
  await Promise.all(tracks.map(t=>trackCacheRepository.setCachedTrack(t)));
  return {title,tracks,total,warning,source:host};
}
