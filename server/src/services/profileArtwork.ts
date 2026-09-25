import type {Track} from '../types/index.js';
import {trackController} from '../controllers/trackController.js';
import {musicCatalogService} from './MusicCatalogService.js';
export async function profileTrackWithArtwork(raw:string):Promise<Track>{
 const track=JSON.parse(raw) as Track;if(track.artworkUrl)return track;
 const original=await trackController.resolveTrack(track.id).catch(()=>null);
 if(original?.artworkUrl)return {...track,artworkUrl:original.artworkUrl};
 const matches=await musicCatalogService.search(`${track.artist.name} ${track.title}`,{limit:8}).catch(()=>null);
 const norm=(s:string)=>s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const same=matches?.tracks.find(t=>norm(t.title)===norm(track.title)&&norm(t.artist.name)===norm(track.artist.name));
 return {...track,artworkUrl:same?.artworkUrl};
}
