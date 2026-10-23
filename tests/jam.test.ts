import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {addToJam,attachDevice,controlJam,createJam,jamFor,jamsHostedBy,joinJam,leaveJam,removeFromJam,resetConnectHub,inviteToJam,JAM_GRACE_MS} from '../server/src/services/connectHub.js';

const sink=()=>{const events:Array<{event:string;data:any}>=[];return {events,send:(event:string,data:unknown)=>events.push({event,data}),last:(name:string)=>events.filter(e=>e.event===name).at(-1)?.data};};
const anna={userId:'telegram:1',publicId:'1',name:'Анна',avatarUrl:''},boris={userId:'telegram:2',publicId:'2',name:'Борис',avatarUrl:''};
const t=(id:string)=>({id,title:`Песня ${id}`,artist:{name:'Артист'}});

describe('Jam: общая очередь',()=>{
  beforeEach(()=>resetConnectHub());
  afterEach(()=>vi.useRealTimers());

  it('владелец создаёт Jam со своей очередью, друг подключается и получает её на своё устройство',()=>{
    const a=sink(),b=sink();
    attachDevice(anna.userId,{id:'anna-mac1',name:'Mac',kind:'desktop'},a);
    attachDevice(boris.userId,{id:'boris-ph1',name:'iPhone',kind:'phone'},b);
    const jam=createJam(anna,'anna-mac1',{queue:[t('1'),t('2')],index:1,position:42,isPlaying:true});
    expect(jam.queue.map(e=>e.track.id)).toEqual(['1','2']);
    expect(jam.index).toBe(1);
    const joined=joinJam(jam.id,boris,'boris-ph1');
    expect(joined).not.toBe('not-found');
    expect(b.last('jam')).toMatchObject({id:jam.id,index:1,isPlaying:true,members:[{userId:anna.userId,owner:true,online:true},{userId:boris.userId,owner:false,online:true}]});
    expect(a.last('jam').members).toHaveLength(2);
    expect(jamsHostedBy([anna.userId])).toMatchObject([{id:jam.id,members:2,track:{id:'2'}}]);
  });

  it('оба добавляют треки: в конец, следующим и «сейчас» для всех',()=>{
    const jam=createJam(anna,'anna-mac1',{queue:[t('1')],index:0,position:0,isPlaying:true});
    joinJam(jam.id,boris,'boris-ph1');
    addToJam(boris.userId,t('2'));
    addToJam(anna.userId,t('3'),'next');
    expect(jamFor(anna.userId)!.queue.map(e=>[e.track.id,e.addedBy])).toEqual([['1',anna.userId],['3',anna.userId],['2',boris.userId]]);
    // The same upcoming song is not queued twice.
    expect(addToJam(anna.userId,t('2'))!.queue).toHaveLength(3);
    const now=addToJam(boris.userId,t('4'),'now')!;
    expect(now.queue[now.index].track.id).toBe('4');
    expect(now.position).toBe(0);
  });

  it('конец трека у двух слушателей одновременно продвигает очередь только на один шаг',()=>{
    const jam=createJam(anna,'anna-mac1',{queue:[t('1'),t('2'),t('3')],index:0,position:0,isPlaying:true});
    joinJam(jam.id,boris,'boris-ph1');
    expect(controlJam(anna.userId,{action:'jump',index:1,fromIndex:0})!.index).toBe(1);
    expect(controlJam(boris.userId,{action:'jump',index:1,fromIndex:0})!.index).toBe(1);
    expect(controlJam(boris.userId,{action:'jump',index:2,fromIndex:0})!.index).toBe(1);
    const paused=controlJam(boris.userId,{action:'pause',position:30})!;
    expect(paused).toMatchObject({isPlaying:false,position:30});
    expect(controlJam(anna.userId,{action:'seek',position:75})!.position).toBe(75);
  });

  it('после конца очереди новый трек сразу играет у всех',()=>{
    const jam=createJam(anna,'anna-mac1',{queue:[t('1')],index:0,position:0,isPlaying:true});
    const ended=controlJam(anna.userId,{action:'ended',fromIndex:0})!;
    expect(ended).toMatchObject({index:1,isPlaying:false});
    const next=addToJam(anna.userId,t('2'))!;
    expect(next).toMatchObject({index:1,isPlaying:true,position:0});
    expect(next.queue[next.index].track.id).toBe('2');
    expect(jam.id).toBe(next.id);
  });

  it('гость убирает только свои треки, владелец — любые',()=>{
    const jam=createJam(anna,'anna-mac1',{queue:[t('1'),t('2')],index:0,position:0,isPlaying:true});
    joinJam(jam.id,boris,'boris-ph1');
    const withBoris=addToJam(boris.userId,t('3'))!;
    const annaKey=withBoris.queue[1].key,borisKey=withBoris.queue[2].key;
    expect(removeFromJam(boris.userId,annaKey)).toBe('forbidden');
    expect((removeFromJam(boris.userId,borisKey) as any).queue).toHaveLength(2);
    expect((removeFromJam(anna.userId,annaKey) as any).queue.map((e:any)=>e.track.id)).toEqual(['1']);
  });

  it('гость выходит — Jam продолжается; владелец выходит — Jam заканчивается у всех',()=>{
    const a=sink(),b=sink();
    attachDevice(anna.userId,{id:'anna-mac1',name:'Mac',kind:'desktop'},a);
    attachDevice(boris.userId,{id:'boris-ph1',name:'iPhone',kind:'phone'},b);
    const jam=createJam(anna,'anna-mac1',{queue:[t('1')],index:0,position:0,isPlaying:true});
    joinJam(jam.id,boris,'boris-ph1');
    leaveJam(boris.userId);
    expect(b.last('jam-end')).toEqual({id:jam.id,reason:'left'});
    expect(jamFor(anna.userId)!.members).toHaveLength(1);
    joinJam(jam.id,boris,'boris-ph1');
    leaveJam(anna.userId);
    expect(b.last('jam-end')).toEqual({id:jam.id,reason:'owner-left'});
    expect(jamFor(boris.userId)).toBeNull();
  });

  it('устройство пропало — место держится, вернулось — получает текущее состояние; иначе выход',()=>{
    vi.useFakeTimers();
    const b1=sink();
    const close=attachDevice(boris.userId,{id:'boris-ph1',name:'iPhone',kind:'phone'},b1);
    const jam=createJam(anna,'anna-mac1',{queue:[t('1')],index:0,position:0,isPlaying:true});
    joinJam(jam.id,boris,'boris-ph1');
    close();
    expect(jamFor(anna.userId)!.members.find(m=>m.userId===boris.userId)?.online).toBe(false);
    vi.advanceTimersByTime(JAM_GRACE_MS/2);
    const b2=sink();
    const close2=attachDevice(boris.userId,{id:'boris-ph1',name:'iPhone',kind:'phone'},b2);
    expect(b2.last('jam')).toMatchObject({id:jam.id});
    vi.advanceTimersByTime(JAM_GRACE_MS);
    expect(jamFor(boris.userId)).not.toBeNull();
    close2();
    vi.advanceTimersByTime(JAM_GRACE_MS+1);
    expect(jamFor(boris.userId)).toBeNull();
  });

  it('приглашение приходит на все открытые устройства друга',()=>{
    const b1=sink(),b2=sink();
    attachDevice(boris.userId,{id:'boris-ph1',name:'iPhone',kind:'phone'},b1);
    attachDevice(boris.userId,{id:'boris-mac',name:'Mac',kind:'desktop'},b2);
    const jam=createJam(anna,'anna-mac1',{queue:[t('1')],index:0,position:0,isPlaying:true});
    expect(inviteToJam(anna.userId,boris.userId)).toBe(true);
    for(const s of [b1,b2])expect(s.last('jam-invite')).toMatchObject({id:jam.id,from:{name:'Анна'},track:{id:'1'}});
    expect(inviteToJam(boris.userId,anna.userId)).toBe(false);
  });
});
