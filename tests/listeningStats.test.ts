import {describe,it,expect} from 'vitest';
import {computeStats} from '../server/src/services/listeningStats.js';
import {fadeGainAt,formatRemaining,readSession,queueSeedOf} from '../src/audio/retention.js';

const now=new Date('2026-10-23T12:00:00Z');
const track=(id:string,artist:string,duration=180)=>JSON.stringify({id,title:`Song ${id}`,artist:{id:`a:${artist}`,name:artist},duration});
const at=(daysAgo:number,hour=12)=>new Date(Date.UTC(2026,9,23-daysAgo,hour));

describe('«Итоги» statistics',()=>{
  const rows=[
    {playedAt:at(0,22),trackData:track('1','Скриптонит')},
    {playedAt:at(0,23),trackData:track('1','Скриптонит')},
    {playedAt:at(1,22),trackData:track('2','Скриптонит, Truwer')},
    {playedAt:at(2,21),trackData:track('3','Земфира',240)},
    {playedAt:at(10,9),trackData:track('4','Кино')},
    {playedAt:at(400,9),trackData:track('5','Кино')},
    {playedAt:at(0,1),trackData:'{broken'},
  ];
  it('counts plays, minutes, tops and first-time artists for a period',()=>{
    const s=computeStats(rows,'week',now);
    expect(s.plays).toBe(4);
    expect(s.uniqueTracks).toBe(3);
    expect(s.topArtists[0]).toMatchObject({name:'Скриптонит',plays:3});
    expect(s.topTracks[0]).toMatchObject({plays:2,track:{id:'1'}});
    expect(s.newArtists).toBe(2); // Скриптонит and Земфира; Кино was heard long before
    expect(s.minutes).toBe(Math.round((180*3+240)*.92/60));
    expect(s.listenerType).toBe('evening');
    expect(s.byWeekday.reduce((a,b)=>a+b,0)).toBe(4);
  });
  it('tracks daily streaks in the listener’s time zone',()=>{
    const s=computeStats(rows,'all',now);
    expect(s.streak).toEqual({current:3,longest:3});
    // 23:00 UTC is already the next day in Moscow (UTC+3, offset −180): that play moves to tomorrow.
    const msk=computeStats([{playedAt:new Date('2026-10-22T23:00:00Z'),trackData:track('1','A')}],'all',now,-180);
    expect(msk.streak.current).toBe(1);
    expect(msk.byHour[2]).toBe(1);
  });
  it('is empty without history',()=>{
    const s=computeStats([],'month',now);
    expect(s).toMatchObject({plays:0,minutes:0,peakHour:null,listenerType:null,streak:{current:0,longest:0}});
  });
});

describe('player retention helpers',()=>{
  it('fades the sleep timer only in its last seconds',()=>{
    expect(fadeGainAt(60)).toBe(1);
    expect(fadeGainAt(6)).toBeCloseTo(.5);
    expect(fadeGainAt(-1)).toBe(0);
    expect(formatRemaining(61_000)).toBe('1:01');
    expect(formatRemaining(3_725_000)).toBe('1:02:05');
  });
  it('restores only a recent, well-formed session',()=>{
    const s={v:1,at:Date.now(),index:1,position:42,queue:[{id:'a'},{id:'b'}]};
    expect(readSession(JSON.stringify(s))?.position).toBe(42);
    expect(readSession(JSON.stringify({...s,index:5}))).toBeNull();
    expect(readSession(JSON.stringify({...s,at:Date.now()-15*86400000}))).toBeNull();
    expect(readSession('not json')).toBeNull();
  });
  it('seeds autoplay with the artists of the latest tracks',()=>{
    const t=(id:string,name:string)=>({id,title:id,artist:{id:name,name},duration:100,source:'deezer',sourceId:id,access:'playable'}) as never;
    const seed=queueSeedOf([t('1','Old'),t('2','Old'),t('3','Old'),t('4','Новый, Feat'),t('5','Новый'),t('6','Третий'),t('7','Четвёртый')]);
    expect(seed?.artists.slice(0,2)).toEqual(['Old','Новый']);
    expect(seed?.artists).toHaveLength(3);
    expect(seed?.trackIds).toHaveLength(7);
    expect(queueSeedOf([])).toBeNull();
  });
});
