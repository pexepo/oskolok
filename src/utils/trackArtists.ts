import type {Track} from '../types/index.js';

const foldName=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
/**
 * A SoundCloud upload whose performer was read from the title («Слава КПСС — …» posted by a random account):
 * the track's artist id points at the uploader, not at the performer.
 */
export function isReupload(track:Track):boolean{
 return track.source==='soundcloud'&&!!track.uploader?.name&&!!track.artist.name&&foldName(track.uploader.name)!==foldName(track.artist.name);
}
/** Performers named on the track: «A, B & C feat. D» → [A, B, C, D]. */
export function performerNames(name:string):string[]{
 const parts=name.split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\bwith\b|\bпри уч\.?)\s*/i).map(p=>p.replace(/[()[\]]/g,'').trim()).filter(Boolean);
 return [...new Map(parts.map(p=>[foldName(p),p])).values()];
}
