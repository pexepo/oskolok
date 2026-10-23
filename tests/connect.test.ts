import {describe,it,expect,beforeEach} from 'vitest';
import {attachDevice,listDevices,publishState,relayTakeover,resetConnectHub,sendCommand} from '../server/src/services/connectHub.js';
import {deviceName,parseSseChunk} from '../src/connect/device.js';

const sink=()=>{const events:Array<{event:string;data:any}>=[];return {events,send:(event:string,data:unknown)=>events.push({event,data})};};
const idle={track:null,isPlaying:false,position:0,duration:0,volume:.6};
const playing={track:{id:'t1',title:'Песня',artist:'Артист',duration:200},isPlaying:true,position:10,duration:200,volume:.6};

describe('Осколок Connect hub',()=>{
  beforeEach(()=>resetConnectHub());

  it('lists devices per listener and forgets a closed stream',()=>{
    const a=sink(),b=sink(),other=sink();
    const closeA=attachDevice('telegram:1',{id:'phone-0001',name:'Telegram · iPhone',kind:'telegram'},a);
    attachDevice('telegram:1',{id:'mac-00001',name:'Осколок · Mac',kind:'desktop'},b);
    attachDevice('telegram:2',{id:'strangr1',name:'Chrome',kind:'web'},other);
    expect(listDevices('telegram:1').map(d=>d.id)).toEqual(['phone-0001','mac-00001']);
    expect(a.events[0]).toMatchObject({event:'hello',data:{self:'phone-0001'}});
    expect(other.events.every(e=>e.event!=='devices'||e.data.length===1)).toBe(true);
    closeA();
    expect(listDevices('telegram:1').map(d=>d.id)).toEqual(['mac-00001']);
    expect(b.events.at(-1)).toMatchObject({event:'devices',data:[{id:'mac-00001'}]});
  });

  it('pauses the other players when one starts, once',()=>{
    const a=sink(),b=sink();
    attachDevice('telegram:1',{id:'phone-0001',name:'iPhone',kind:'phone'},a);
    attachDevice('telegram:1',{id:'mac-00001',name:'Mac',kind:'desktop'},b);
    publishState('telegram:1','phone-0001',playing);
    a.events.length=0;
    publishState('telegram:1','mac-00001',{...playing,track:{...playing.track,id:'t2'}});
    expect(a.events.filter(e=>e.event==='command')).toEqual([{event:'command',data:{from:'mac-00001',action:'pause',reason:'other-device'}}]);
    a.events.length=0;
    // A heartbeat of a device that already plays does not pause anyone again.
    publishState('telegram:1','mac-00001',{...playing,position:25});
    expect(a.events.some(e=>e.event==='command')).toBe(false);
    publishState('telegram:1','phone-0001',idle);
    expect(listDevices('telegram:1').find(d=>d.id==='phone-0001')?.state?.isPlaying).toBe(false);
  });

  it('routes commands and takeovers only to the listener’s own online devices',()=>{
    const a=sink(),b=sink();
    attachDevice('telegram:1',{id:'phone-0001',name:'iPhone',kind:'phone'},a);
    attachDevice('telegram:2',{id:'mac-00001',name:'Mac',kind:'desktop'},b);
    expect(sendCommand('telegram:1','phone-0001','mac-00001','next')).toBe(false);
    expect(sendCommand('telegram:1','phone-0001','phone-0001','next')).toBe(false);
    attachDevice('telegram:1',{id:'tab-00001',name:'Chrome',kind:'web'},b);
    expect(sendCommand('telegram:1','phone-0001','tab-00001','seek',42)).toBe(true);
    expect(b.events.at(-1)).toEqual({event:'command',data:{from:'phone-0001',action:'seek',value:42}});
    expect(relayTakeover('telegram:1','tab-00001','phone-0001',{queue:[{id:'t1'}],index:0,position:12,isPlaying:true})).toBe(true);
    expect(a.events.at(-1)).toMatchObject({event:'takeover',data:{from:'tab-00001',index:0,position:12}});
  });

  it('keeps at most twelve devices per listener',()=>{
    for(let i=0;i<14;i++)attachDevice('telegram:1',{id:`device-${String(i).padStart(3,'0')}`,name:`D${i}`,kind:'web'},sink());
    expect(listDevices('telegram:1')).toHaveLength(12);
  });
});

describe('Connect client helpers',()=>{
  it('names devices the way a listener recognises them',()=>{
    const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
    expect(deviceName({userAgent:iphone,telegram:true,electron:false})).toEqual({name:'Telegram · iPhone',kind:'telegram'});
    expect(deviceName({userAgent:`${iphone} OskolokIOS/1.0`,telegram:false,electron:false})).toEqual({name:'Осколок · iPhone',kind:'phone'});
    expect(deviceName({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Electron/32.3.3 Safari/537.36',telegram:false,electron:true})).toEqual({name:'Осколок · Mac',kind:'desktop'});
    expect(deviceName({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 YaBrowser/24.10 Safari/537.36',telegram:false,electron:false})).toEqual({name:'Яндекс Браузер · Windows',kind:'web'});
    expect(deviceName({userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',telegram:false,electron:false})).toEqual({name:'Chrome · Android',kind:'phone'});
  });

  it('parses server-sent events split across chunks',()=>{
    let r=parseSseChunk('retry: 4000\n\nevent: hello\ndata: {"self":"a"}\n\n: ping\n\nevent: dev');
    expect(r.events).toEqual([{event:'hello',data:'{"self":"a"}'}]);
    r=parseSseChunk(`${r.rest}ices\ndata: []\n\n`);
    expect(r.events).toEqual([{event:'devices',data:'[]'}]);
    expect(r.rest).toBe('');
  });
});
