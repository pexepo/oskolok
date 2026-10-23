import React from 'react';
import {trackWindow} from '../../utils/virtualTracks.js';
import {useDndContext} from '@dnd-kit/core';

const ROW_HEIGHT=88;
/** Uses the page's existing scroll container, so navigation and DnD keep working. */
export function VirtualTrackRows({count,children,rowHeight=ROW_HEIGHT}:{count:number;children:(index:number)=>React.ReactNode;rowHeight?:number}) {
  const ref=React.useRef<HTMLDivElement>(null);
  const active=useDndContext().active;
  const activeIndex=active?.data.current?.sortable?.index as number|undefined;
  const [range,setRange]=React.useState({start:0,end:Math.min(count,24)});
  React.useLayoutEffect(()=>{
    const list=ref.current;if(!list)return;
    const root=list.closest<HTMLElement>('[data-scroll-root]');
    if(!root){setRange({start:0,end:Math.min(count,60)});return;}
    let frame=0;
    const update=()=>{
      frame=0;
      const offset=root.getBoundingClientRect().top-list.getBoundingClientRect().top;
      const next=trackWindow(count,rowHeight,offset,root.clientHeight);
      setRange(previous=>previous.start===next.start&&previous.end===next.end?previous:next);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    update();root.addEventListener('scroll',schedule,{passive:true});
    const observer=new ResizeObserver(schedule);observer.observe(root);observer.observe(list);
    return()=>{root.removeEventListener('scroll',schedule);observer.disconnect();cancelAnimationFrame(frame);};
  },[count,rowHeight]);
  const start=Math.min(range.start,count),end=Math.min(range.end,count);
  const indexes=Array.from({length:Math.max(0,end-start)},(_,i)=>start+i);
  if(activeIndex!==undefined&&activeIndex>=0&&activeIndex<count&&!indexes.includes(activeIndex))indexes.push(activeIndex);
  return <div ref={ref} className="virtual-track-list" style={{height:count*rowHeight}} role="list" aria-label="Треки">
    {indexes.map(index=>{
      return <div key={index} className="virtual-track-row" role="listitem" aria-setsize={count} aria-posinset={index+1} style={{top:index*rowHeight,height:rowHeight}}>{children(index)}</div>;
    })}
  </div>;
}
