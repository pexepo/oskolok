/** Чистые помощники синхронизации очереди (без DOM) — общие для клиента и тестов. */
export const QUEUE_WINDOW=300;
/** FNV-1a по id треков: сервер просит очередь целиком, только когда хэш изменился. */
export function hashQueue(tracks:Array<{id:string}>){
  let h=0x811c9dc5;
  for(const t of tracks){for(let i=0;i<t.id.length;i++){h^=t.id.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}h^=10;h=Math.imul(h,0x01000193)>>>0;}
  return `${tracks.length}:${h.toString(36)}`;
}
/** Окно очереди вокруг текущего трека (до 300): индекс пересчитывается в координаты окна. */
export function queueWindow<T>(queue:T[],index:number,limit=QUEUE_WINDOW){
  const i=Math.max(0,Math.min(index,queue.length-1));
  if(queue.length<=limit)return {tracks:queue,index:i};
  const start=Math.max(0,Math.min(i-50,queue.length-limit));
  return {tracks:queue.slice(start,start+limit),index:i-start};
}
