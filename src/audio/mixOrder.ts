/**
 * «Микс» for playlists: an order in which neighbours flow into each other — close tempo (half/double time
 * counts as close), similar energy, a shared genre. Greedy nearest neighbour from the playlist's own opener,
 * then 2-opt passes that undo crossings. Tracks with unknown facts cost a neutral amount, so they slot in
 * where they hurt least instead of piling up at the end.
 */
export interface OrderFacts{bpm?:number;energy?:number;genres?:string[]}

/** Tempo distance in steps of 6 % (what beatmatching can bridge), allowing half and double time. */
export function tempoGap(a:number,b:number):number{
  return Math.min(...[1,2,.5].map(m=>Math.abs(Math.log(a/(b*m)))))/Math.log(1.06);
}

export function transitionCost(a:OrderFacts|undefined,b:OrderFacts|undefined):number{
  let cost=a?.bpm&&b?.bpm?Math.min(3,tempoGap(a.bpm,b.bpm)):1.5;
  cost+=a?.energy!==undefined&&b?.energy!==undefined?Math.abs(a.energy-b.energy)*3:.5;
  const ga=a?.genres||[],gb=b?.genres||[];
  cost+=ga.length&&gb.length?(ga.some(g=>gb.includes(g))?0:1.2):.4;
  return cost;
}

export function mixOrder<T extends {id:string}>(tracks:T[],facts:Record<string,OrderFacts|undefined>):T[]{
  if(tracks.length<3)return tracks.slice();
  const n=tracks.length,c=(i:number,j:number)=>transitionCost(facts[tracks[i].id],facts[tracks[j].id]);
  const order=[0],left=new Set(Array.from({length:n-1},(_,i)=>i+1));
  while(left.size){
    const last=order[order.length-1];let best=-1,bestCost=Infinity;
    for(const j of left){const v=c(last,j);if(v<bestCost){bestCost=v;best=j;}}
    order.push(best);left.delete(best);
  }
  // 2-opt on the open path, the opener stays first. Bounded so a 300-track playlist stays instant.
  for(let pass=0,improved=true;improved&&pass<(n>150?2:6);pass++){
    improved=false;
    for(let i=1;i<n-1;i++)for(let k=i+1;k<n;k++){
      const before=c(order[i-1],order[i])+(k+1<n?c(order[k],order[k+1]):0);
      const after=c(order[i-1],order[k])+(k+1<n?c(order[i],order[k+1]):0);
      if(after<before-1e-9){order.splice(i,k-i+1,...order.slice(i,k+1).reverse());improved=true;}
    }
  }
  return order.map(i=>tracks[i]);
}

/** Sum of transition costs along an order (tests and tuning). */
export const orderCost=(ids:string[],facts:Record<string,OrderFacts|undefined>)=>ids.slice(1).reduce((s,id,i)=>s+transitionCost(facts[ids[i]],facts[id]),0);
