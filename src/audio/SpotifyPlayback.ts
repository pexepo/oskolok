import type {Track} from '../types/index.js';
import {apiClient} from '../api/apiClient.js';

type Device={id:string;name:string;is_active:boolean};
type Match={id:string;uri:string}|null;
declare global {interface Window {Spotify?:any;onSpotifyWebPlaybackSDKReady?:()=>void}}
class SpotifyPlayback {
  private player:any;
  private deviceId='';
  private mode:'sdk'|'connect'|null=null;
  private current:Track|null=null;
  private currentSpotifyId='';
  private poller:ReturnType<typeof setInterval>|null=null;
  private onState?:(playing:boolean,time:number,duration:number)=>void;
  private onEnd?:()=>void;
  private ended=false;
  private hadProgress=false;
  private generation=0;
  private confirmed=false;
  private position=0;
  private positionUpdatedAt=0;
  private playing=false;
  private duration=0;
  private report(playing:boolean,time:number,duration:number){
    this.position=Math.max(0,time);
    this.positionUpdatedAt=performance.now();
    this.playing=playing;
    this.duration=duration;
    this.onState?.(playing,this.position,duration);
  }
  private async token(){return (await apiClient.request<{token:string}>('/music-accounts/spotify/playback-token')).token;}
  private async command(method:string,path:string,body?:unknown,params?:Record<string,string|number>){return apiClient.request<any>('/music-accounts/spotify/player',{method:'POST',body:JSON.stringify({method,path,body,...params})});}
  private async sdk(){
    if(this.player)return this.deviceId;
    if(!window.Spotify)await new Promise<void>((resolve,reject)=>{const script=document.createElement('script');script.src='https://sdk.scdn.co/spotify-player.js';script.onerror=()=>reject(new Error('Spotify SDK не загрузился'));window.onSpotifyWebPlaybackSDKReady=()=>resolve();document.head.appendChild(script);});
    const player=new window.Spotify.Player({name:'Осколок',getOAuthToken:(done:(s:string)=>void)=>{void this.token().then(done).catch(()=>done(''));},volume:0.8});
    this.player=player;
    player.addListener('ready',({device_id}:{device_id:string})=>{this.deviceId=device_id;});
    player.addListener('player_state_changed',(state:any)=>{if(!state||!this.confirmed||this.mode!=='sdk'||state.track_window?.current_track?.id!==this.currentSpotifyId)return;if(state.position>1000)this.hadProgress=true;this.report(!state.paused,state.position/1000,state.duration/1000);if(this.current&&this.hadProgress&&state.paused&&state.position===0&&!this.ended){this.ended=true;this.onEnd?.();}});
    player.addListener('initialization_error',()=>{this.deviceId='';});
    player.addListener('account_error',()=>{this.deviceId='';});
    player.addListener('autoplay_failed',()=>{this.report(false,this.getCurrentTime(),this.current?.duration||0);});
    const connected=await player.connect();if(!connected)throw new Error('Spotify SDK недоступен');
    await new Promise<void>((resolve,reject)=>{let count=0;const timer=setInterval(()=>{if(this.deviceId){clearInterval(timer);resolve();}else if(++count>50){clearInterval(timer);reject(new Error('Spotify SDK не создал устройство'));}},100);});
    return this.deviceId;
  }
  private async match(track:Track):Promise<Match>{
    return apiClient.request<Match>('/music-accounts/spotify/match',{method:'POST',body:JSON.stringify({trackId:track.id})});
  }
  async play(track:Track,preferredSource:string|undefined,onState:(playing:boolean,time:number,duration:number)=>void,onEnd:()=>void):Promise<{deviceName:string}|null>{
    if(preferredSource&&preferredSource!=='auto'&&preferredSource!=='spotify')return null;
    let match:Match;
    try{match=await this.match(track);}catch(e){if(preferredSource==='spotify')throw e;return null;}
    if(!match){if(preferredSource==='spotify')throw new Error('Этой версии нет в Spotify');return null;}
    const generation=++this.generation;
    this.onState=onState;this.onEnd=onEnd;this.current=track;this.currentSpotifyId=match.id;this.ended=false;this.hadProgress=false;this.confirmed=false;this.position=0;this.positionUpdatedAt=performance.now();this.playing=false;this.duration=track.duration;
    const desktop=Boolean((window as any).electronAPI||navigator.userAgent.includes('Electron'));
    let deviceName='Осколок';
    if(!desktop){try{this.deviceId=await this.sdk();this.mode='sdk';await this.player.activateElement?.();}catch{this.deviceId='';}}
    if(!this.deviceId){
      const result=await this.command('GET','me/player/devices');const devices:Device[]=result.devices||[];
      const selected=devices.find(d=>d.id===localStorage.getItem('oskolok_spotify_device'))||devices.find(d=>d.is_active)||devices[0];
      if(!selected){this.mode=null;throw new Error('Откройте Spotify на одном из ваших устройств');}
      this.deviceId=selected.id;deviceName=selected.name;this.mode='connect';
    }
    if(generation!==this.generation)return null;
    try{
      await this.command('PUT','me/player/play',{uris:[match.uri]},{deviceId:this.deviceId});
      let confirmed=false;
      for(let attempt=0;attempt<10;attempt++){
        if(generation!==this.generation)return null;
        const state=await this.command('GET','me/player').catch(()=>null);
        if(state?.item?.id===match.id&&state.is_playing){confirmed=true;break;}
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      if(!confirmed)throw new Error('Spotify не подтвердил начало воспроизведения');
    }catch(error){if(generation===this.generation)this.stop();throw error;}
    this.confirmed=true;this.report(true,0,track.duration);
    this.poll();
    return {deviceName};
  }
  private poll(){if(this.poller)clearInterval(this.poller);const generation=this.generation;this.poller=setInterval(()=>{void this.command('GET','me/player').then(state=>{if(generation!==this.generation||!state||!this.current)return;const same=state.item?.id===this.currentSpotifyId;if(!same)return;const time=(state.progress_ms||0)/1000,duration=(state.item?.duration_ms||this.current.duration*1000)/1000;if(time>1)this.hadProgress=true;this.report(!!state.is_playing,time,duration);if(this.hadProgress&&state.is_playing&&time>=duration-0.6&&!this.ended){this.ended=true;this.onEnd?.();}}).catch(()=>{});},2000);}
  get active(){return !!this.mode;}
  get isPlaying(){return this.playing;}
  getCurrentTime(){return Math.min(this.duration||Infinity,this.position+(this.playing?(performance.now()-this.positionUpdatedAt)/1000:0));}
  activateFromGesture(){try{void this.player?.activateElement?.();}catch{}}
  async pause(){const generation=this.generation,position=this.getCurrentTime();if(this.mode==='sdk')await this.player.pause();else if(this.mode)await this.command('PUT','me/player/pause',undefined,{deviceId:this.deviceId});if(generation===this.generation)this.report(false,position,this.current?.duration||this.duration);}
  async resume(){const generation=this.generation,position=this.getCurrentTime();if(this.mode==='sdk')await this.player.resume();else if(this.mode)await this.command('PUT','me/player/play',undefined,{deviceId:this.deviceId});if(generation===this.generation)this.report(true,position,this.current?.duration||this.duration);}
  async seek(seconds:number){const generation=this.generation;if(this.mode==='sdk')await this.player.seek(seconds*1000);else if(this.mode)await this.command('PUT','me/player/seek',undefined,{deviceId:this.deviceId,positionMs:Math.round(seconds*1000)});if(generation===this.generation)this.report(this.playing,seconds,this.current?.duration||this.duration);}
  async volume(value:number){if(this.mode==='sdk')await this.player.setVolume(value);else if(this.mode)await this.command('PUT','me/player/volume',undefined,{deviceId:this.deviceId,volumePercent:Math.round(value*100)});}
  stop(){this.generation++;this.confirmed=false;if(this.poller)clearInterval(this.poller);this.poller=null;this.mode=null;this.current=null;this.currentSpotifyId='';this.playing=false;this.position=0;}
}
export const spotifyPlayback=new SpotifyPlayback();
