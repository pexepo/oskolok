/** Window into a long playlist, with a few extra rows for smooth scrolling. */
export function trackWindow(count:number,rowHeight:number,offset:number,viewport:number,overscan=6) {
  const start=Math.max(0,Math.min(count,Math.floor(offset/rowHeight)-overscan));
  const end=Math.max(start,Math.min(count,Math.ceil((offset+viewport)/rowHeight)+overscan));
  return {start,end};
}
