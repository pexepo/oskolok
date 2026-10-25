import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {activityFor,encode,decode,pipePaths,DiscordPresence}=require('../electron/discord-rpc.cjs');
const {sanitize}=require('../electron/desktop-extras.cjs');

describe('Discord status',()=>{
  it('frames IPC messages and reads them back across chunks',()=>{
    const a=encode(1,{cmd:'SET_ACTIVITY'}),b=encode(3,{ping:1});
    const both=Buffer.concat([a,b]);
    let r=decode(both.subarray(0,a.length+3));
    expect(r.frames).toEqual([{op:1,data:{cmd:'SET_ACTIVITY'}}]);
    r=decode(Buffer.concat([r.rest,both.subarray(a.length+3)]));
    expect(r.frames).toEqual([{op:3,data:{ping:1}}]);
    expect(r.rest.length).toBe(0);
  });
  it('shows «Listening» with progress and a link only while music plays',()=>{
    const now=1_800_000_000_000;
    const a=activityFor({id:'deezer:1',title:'Песня',artist:'Артист',artworkUrl:'https://cdn.example/x.jpg',duration:200,position:50,playing:true},'https://oskolok.lol',now);
    expect(a).toMatchObject({type:2,details:'Песня',state:'Артист',timestamps:{start:now-50000,end:now+150000},assets:{large_image:'https://cdn.example/x.jpg'}});
    expect(a.buttons[0].url).toBe('https://oskolok.lol/app/track/deezer%3A1');
    expect(activityFor({title:'Песня',artist:'А',playing:false},'https://oskolok.lol')).toBeNull();
    // Discord needs at least two characters per field.
    expect(activityFor({title:'Я',artist:'Б',playing:true,duration:0,position:0},'')).toMatchObject({details:'Я ',state:'Б '});
  });
  it('shows the artist in the status, links the track and throttles Discord updates',()=>{
    const a=activityFor({id:'deezer:1',title:'Песня',artist:'Артист',duration:200,position:0,playing:true},'https://oskolok.lol');
    expect(a).toMatchObject({status_display_type:1,details_url:'https://oskolok.lol/app/track/deezer%3A1'});
    const writes:Buffer[]=[],p=new DiscordPresence('123456789012345678','https://oskolok.lol');
    p.ready=true;p.socket={write:(b:Buffer)=>writes.push(b),destroy(){},end(){}};
    const state={id:'deezer:1',title:'Песня',artist:'Артист',duration:200,position:10,playing:true};
    p.update(state);p.update({...state,position:10.2});
    expect(writes).toHaveLength(1);
    p.update({...state,id:'deezer:2',title:'Другая'});
    expect(writes).toHaveLength(1);
    expect(p.timer).not.toBeNull();
    p.close();
  });
  it('looks for Discord on the right sockets per platform',()=>{
    expect(pipePaths('win32',{})[0]).toBe('\\\\?\\pipe\\discord-ipc-0');
    expect(pipePaths('darwin',{TMPDIR:'/var/tmp/'})).toContain('/var/tmp/discord-ipc-0');
  });
});

describe('mini-player state from the page',()=>{
  it('keeps only known fields and https covers',()=>{
    expect(sanitize({id:'x',title:'T',artist:'A',artworkUrl:'javascript:alert(1)',duration:'12',position:-5,playing:1,extra:'drop'}))
      .toEqual({id:'x',title:'T',artist:'A',artworkUrl:'',duration:12,position:0,playing:true,liked:false});
    expect(sanitize(null)).toBeNull();
  });
});
