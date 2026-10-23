import {describe,expect,it,vi} from 'vitest';
import {QueueManager} from '../src/audio/QueueManager.js';
import type {Track} from '../src/types/index.js';
import {playShuffledCollection} from '../src/utils/collectionPlayback.js';

const tracks=Array.from({length:6},(_,i)=>({id:String(i),source:'soundcloud',sourceId:String(i),title:`Track ${i}`,artist:{id:'artist',source:'soundcloud',sourceId:'artist',name:'Artist'},duration:180,access:'playable'} as Track));
function player(queue:QueueManager){return {
  get shuffle(){return queue.getState().shuffle;},
  toggleShuffle:vi.fn(()=>{queue.toggleShuffle();}),
  playCollection:vi.fn(async(items:Track[],index=0)=>{queue.setQueue(items,index);}),
};}
describe('playlist shuffle playback',()=>{
  it('starts at a random track, keeps every song once and can restore the playlist order',async()=>{
    const queue=new QueueManager(),p=player(queue);
    await playShuffledCollection(tracks,p,()=>.6);
    expect(queue.getCurrentTrack()?.id).toBe('3');
    expect(queue.getState().shuffle).toBe(true);
    expect(new Set(queue.getState().playbackQueue.map(t=>t.id))).toEqual(new Set(tracks.map(t=>t.id)));
    expect(queue.getState().sourceQueue).toEqual(tracks);
    queue.toggleShuffle();
    expect(queue.getState().playbackQueue).toEqual(tracks);
    expect(queue.getCurrentTrack()?.id).toBe('3');
  });
  it('keeps shuffle enabled when it was already active in another collection',async()=>{
    const queue=new QueueManager();queue.setQueue(tracks.slice(0,2));queue.toggleShuffle();
    const p=player(queue);await playShuffledCollection(tracks,p,()=>.99);
    expect(p.toggleShuffle).not.toHaveBeenCalled();
    expect(queue.getCurrentTrack()?.id).toBe('5');expect(queue.getState().shuffle).toBe(true);
  });
  it('does not change another queue for an empty playlist',async()=>{
    const queue=new QueueManager();queue.setQueue(tracks,2);
    const p=player(queue);await playShuffledCollection([],p);
    expect(p.playCollection).not.toHaveBeenCalled();expect(p.toggleShuffle).not.toHaveBeenCalled();
    expect(queue.getCurrentTrack()?.id).toBe('2');
  });
});
