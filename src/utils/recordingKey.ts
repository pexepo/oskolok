import type {Track} from '../types/index.js';

// Mirrors server/src/services/recordingKey.ts (without the cross-script skeleton): one song from
// different catalogues counts once; version words (remix, sped up, live…) keep songs apart.
const fold=(text:string)=>text.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,'');
const FEAT=/\s*[([](?:feat|ft|with|prod)\.?\s[^)\]]*[)\]]/gi;
const mainArtist=(artist:string)=>artist.split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?|\bx\b|\band\b|\bи\b)\s*/i)[0]?.trim()||artist;

export function recordingKey(track:Pick<Track,'title'|'artist'>):string{
 const title=fold(String(track.title||'').replace(FEAT,' ').replace(/\s+-\s+(?:feat|ft)\.?\s.*$/i,'')),artist=fold(mainArtist(String(track.artist?.name||'')));
 return title&&artist?`${artist}|${title}`:'';
}
