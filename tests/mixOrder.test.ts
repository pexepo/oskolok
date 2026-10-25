import {describe,expect,it} from 'vitest';
import {mixOrder,orderCost,tempoGap,type OrderFacts} from '../src/audio/mixOrder.js';

describe('playlist «Микс» order',()=>{
  it('treats half and double time as the same tempo',()=>{
    expect(tempoGap(140,70)).toBeCloseTo(0,6);
    expect(tempoGap(120,127.2)).toBeCloseTo(1,3);
  });
  it('keeps the opener and chains close tempos, energies and genres',()=>{
    const facts:Record<string,OrderFacts>={
      a:{bpm:90,energy:.3,genres:['Rap/Hip Hop']},b:{bpm:128,energy:.9,genres:['Dance']},c:{bpm:92,energy:.35,genres:['Rap/Hip Hop']},
      d:{bpm:126,energy:.85,genres:['Dance']},e:{bpm:95,energy:.4,genres:['Rap/Hip Hop']},f:{bpm:130,energy:.95,genres:['Dance']},
    };
    const tracks=['a','b','c','d','e','f'].map(id=>({id}));
    const order=mixOrder(tracks,facts).map(t=>t.id);
    expect(order[0]).toBe('a');
    expect(new Set(order)).toEqual(new Set(tracks.map(t=>t.id)));
    // One jump from the hip-hop group to the dance group, not three.
    expect(order.slice(0,3).sort()).toEqual(['a','c','e']);
    expect(orderCost(order,facts)).toBeLessThan(orderCost(tracks.map(t=>t.id),facts));
  });
  it('places tracks without facts instead of dropping them',()=>{
    const order=mixOrder([{id:'x'},{id:'y'},{id:'z'}],{}).map(t=>t.id);
    expect(order).toHaveLength(3);
    expect(order[0]).toBe('x');
  });
});
