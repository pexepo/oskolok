import type {Track} from '../types/index.js';
import {normalizeMusicText,rankTrack} from './trackRanking.js';

const PRESENTATION=/\s*[([](?:official(?:\s+(?:music|audio|video))?|audio|video|lyrics?|visuali[sz]er|hd|hq)[^)\]]*[)\]]/gi;
const EDITIONS=['remix','cover','кавер','slowed','sped up','nightcore','instrumental','karaoke','mashup','live','snippet','preview'];
export function recordingMetadata(track:Pick<Track,'title'|'artist'>){
 const title=track.title.replace(PRESENTATION,'').replace(/\s*[|—-]\s*(?:official (?:audio|video)|lyrics video)\s*$/i,'').trim();
 const pair=title.match(/^(.+?)\s+[-—–]\s+(.+)$/);
 return pair?{artist:pair[1],title:pair[2]}:{artist:track.artist.name,title};
}
/** Upload handles may differ, but the title, version and duration must agree. */
export function selectRecordingCandidates(track:Track,found:Track[]):Track[]{
 const target=recordingMetadata(track),title=normalizeMusicText(target.title),artist=normalizeMusicText(target.artist);
 const has=(text:string,edition:string)=>` ${text} `.includes(` ${edition} `);
 const exact=(candidate:Track)=>{
  if(candidate.access==='blocked'||candidate.access==='unavailable'||candidate.access==='preview')return false;
  const metadata=recordingMetadata(candidate),name=normalizeMusicText(metadata.title),credit=normalizeMusicText(metadata.artist);
  if(!title||name!==title)return false;
  if(EDITIONS.some(edition=>has(title,edition)!==has(name,edition)))return false;
  if(track.duration&&candidate.duration&&Math.abs(track.duration-candidate.duration)>Math.max(8,track.duration*.04))return false;
  return credit===artist || (candidate.source==='soundcloud'&&!candidate.title.match(/\s[-—–]\s/)&&title.split(' ').length>=2);
 };
 const query=`${target.artist} ${target.title}`;
 return [...new Map(found.filter(exact).map(t=>[t.id,t])).values()].sort((a,b)=>rankTrack(b,query)-rankTrack(a,query)).slice(0,9);
}
