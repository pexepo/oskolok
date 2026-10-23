import type {Track} from '../types/index.js';

type CollectionPlayer={shuffle:boolean;toggleShuffle:()=>void;playCollection:(tracks:Track[],startIndex?:number)=>Promise<void>};

/** Keep the source order so turning shuffle off can restore the original playlist. */
export async function playShuffledCollection(tracks:Track[],player:CollectionPlayer,random:()=>number=Math.random):Promise<void>{
  if(!tracks.length)return;
  if(!player.shuffle)player.toggleShuffle();
  await player.playCollection(tracks,Math.floor(random()*tracks.length));
}
