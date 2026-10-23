import React,{useEffect,useState} from 'react';
import {create} from 'zustand';
import {Laptop,MonitorSmartphone,Smartphone,Tablet,Send,Globe,SkipBack,SkipForward,Play,Pause,ArrowDownToLine,ArrowUpFromLine,Download} from 'lucide-react';
import {Modal} from '../common/Modal.js';
import {ArtworkImage} from '../common/ArtworkImage.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {deviceLabel,initConnect,listenHere,livePosition,otherDevices,playOn,remote,thisDevice,useConnectStore,type ConnectDevice,type DeviceKind} from '../../connect/connect.js';
import {formatTime} from '../../utils/formatters.js';
import './connect.css';

export const useDevicesPanel=create<{open:boolean}>(()=>({open:false}));
export const openDevicesPanel=()=>useDevicesPanel.setState({open:true});

const KindIcon=({kind,size=18}:{kind:DeviceKind;size?:number})=>kind==='desktop'?<Laptop size={size}/>:kind==='phone'?<Smartphone size={size}/>:kind==='tablet'?<Tablet size={size}/>:kind==='telegram'?<Send size={size}/>:<Globe size={size}/>;

/** Re-renders once a second while a remote device plays, for its progress bar. */
function useTick(active:boolean){const [,set]=useState(0);useEffect(()=>{if(!active)return;const id=setInterval(()=>set(x=>x+1),1000);return()=>clearInterval(id);},[active]);}

/** Button for the player bars: shows how many other devices are online. */
export function DevicesButton({className='',size=18}:{className?:string;size?:number}){
  const t=useTranslation();
  const others=useConnectStore(s=>otherDevices(s).length),playingElsewhere=useConnectStore(s=>otherDevices(s).some(d=>d.state?.isPlaying));
  const label=others?t(`Устройства: ещё ${others} в сети`,`Devices: ${others} more online`):t('Устройства','Devices');
  return <button type="button" className={`${className} connect-button${playingElsewhere?' is-elsewhere':''}`} onClick={openDevicesPanel} title={label} aria-label={label} aria-haspopup="dialog">
    <MonitorSmartphone size={size}/>{others>0&&<span className="connect-button__badge" aria-hidden="true">{others}</span>}
  </button>;
}

function DeviceRow({device,hasLocalTrack}:{device:ConnectDevice;hasLocalTrack:boolean}){
  const t=useTranslation(),st=device.state,track=st?.track,selfId=useConnectStore(s=>s.selfId);
  const name=deviceLabel(device,selfId,t('другая вкладка','another tab'));
  useTick(!!st?.isPlaying);
  const position=livePosition(device),duration=st?.duration||track?.duration||0;
  return <li className={`connect-device${st?.isPlaying?' is-playing':''}`}>
    <span className="connect-device__icon" aria-hidden="true"><KindIcon kind={device.kind}/></span>
    <div className="connect-device__body">
      <strong>{name}</strong>
      {track?<>
        <span className="connect-device__track">{st?.isPlaying?t('Играет','Playing'):t('На паузе','Paused')} · {track.artist} — {track.title}</span>
        {duration>0&&<span className="connect-device__bar" aria-hidden="true"><i style={{width:`${Math.min(100,position/duration*100)}%`}}/></span>}
      </>:<span className="connect-device__track">{t('Ничего не играет','Nothing playing')}</span>}
      <div className="connect-device__actions">
        {track&&<button type="button" className="sg-btn sg-btn--primary" onClick={()=>{void listenHere(device.id);useDevicesPanel.setState({open:false});}}><ArrowDownToLine size={14}/>{t('Слушать здесь','Listen here')}</button>}
        {hasLocalTrack&&<button type="button" className="sg-btn" onClick={()=>{void playOn(device.id);useDevicesPanel.setState({open:false});}}><ArrowUpFromLine size={14}/>{t('Играть там','Play there')}</button>}
        {track&&<span className="connect-remote" role="group" aria-label={t(`Пульт: ${name}`,`Remote: ${name}`)}>
          <button type="button" onClick={()=>void remote(device.id,'previous')} aria-label={t('Предыдущий трек','Previous track')}><SkipBack size={15}/></button>
          <button type="button" onClick={()=>void remote(device.id,'toggle')} aria-label={st?.isPlaying?t('Пауза','Pause'):t('Воспроизвести','Play')}>{st?.isPlaying?<Pause size={15}/>:<Play size={15}/>}</button>
          <button type="button" onClick={()=>void remote(device.id,'next')} aria-label={t('Следующий трек','Next track')}><SkipForward size={15}/></button>
        </span>}
      </div>
    </div>
    {duration>0&&track&&<small className="connect-device__time">{formatTime(Math.floor(position))}</small>}
  </li>;
}

function DevicesPanel(){
  const t=useTranslation(),open=useDevicesPanel(s=>s.open);
  const {devices,selfId,connected}=useConnectStore();
  const local=usePlayerStore(s=>s.currentTrack),playingHere=usePlayerStore(s=>s.isPlaying);
  const others=devices.filter(d=>d.id!==selfId);
  return <Modal isOpen={open} onClose={()=>useDevicesPanel.setState({open:false})} title={t('Устройства','Devices')} className="max-w-md connect-modal">
    <div className="connect-panel">
      <div className={`connect-self${playingHere?' is-playing':''}`}>
        <span className="connect-device__icon" aria-hidden="true"><KindIcon kind={thisDevice.kind}/></span>
        <div><small>{t('Это устройство','This device')}</small><strong>{thisDevice.name}</strong>
          {local&&<span className="connect-device__track">{playingHere?t('Играет','Playing'):t('На паузе','Paused')} · {local.artist.name} — {local.title}</span>}</div>
        {local?.artworkUrl&&<ArtworkImage src={local.artworkUrl} alt="" className="connect-self__art"/>}
      </div>
      {!connected&&<p className="connect-note" role="status">{t('Нет связи с сервером — устройства появятся, когда соединение вернётся.','No connection to the server — devices will appear once it is back.')}</p>}
      {connected&&others.length>0&&<ul className="connect-list" aria-label={t('Другие устройства','Other devices')}>{others.map(d=><DeviceRow key={d.id} device={d} hasLocalTrack={!!local}/>)}</ul>}
      {connected&&!others.length&&<div className="connect-empty">
        <p><b>{t('Слушайте где угодно.','Listen anywhere.')}</b> {t('Откройте Осколок на телефоне, компьютере или в Telegram — здесь появятся устройства. Музыку можно перенести одним нажатием и управлять ей с другого устройства.','Open Oskolok on your phone, computer or in Telegram and your devices show up here. Move the music with one tap and control it from another device.')}</p>
        <a className="sg-btn" href="/download" target="_blank" rel="noreferrer"><Download size={14}/>{t('Скачать приложения','Get the apps')}</a>
      </div>}
    </div>
  </Modal>;
}

/** Spotify-style strip: something plays on another device while this one is silent. */
function RemoteBar(){
  const t=useTranslation();
  const device=useConnectStore(s=>otherDevices(s).filter(d=>d.state?.isPlaying&&d.state.track).sort((a,b)=>(b.state?.at||0)-(a.state?.at||0))[0]);
  const playingHere=usePlayerStore(s=>s.isPlaying),fullOpen=usePlayerStore(s=>s.isFullPlayerOpen),selfId=useConnectStore(s=>s.selfId);
  useTick(!!device);
  if(!device||playingHere||fullOpen)return null;
  const st=device.state!,track=st.track!,duration=st.duration||track.duration||0,name=deviceLabel(device,selfId,t('другая вкладка','another tab'));
  return <div className="connect-bar" role="region" aria-label={t(`Играет на «${name}»`,`Playing on “${name}”`)}>
    {duration>0&&<span className="connect-bar__progress" aria-hidden="true"><i style={{width:`${Math.min(100,livePosition(device)/duration*100)}%`}}/></span>}
    <button type="button" className="connect-bar__main" onClick={openDevicesPanel}>
      <span className="connect-bar__icon" aria-hidden="true"><KindIcon kind={device.kind} size={15}/></span>
      <span><small>{t(`Играет на «${name}»`,`Playing on “${name}”`)}</small><b>{track.artist} — {track.title}</b></span>
    </button>
    <button type="button" className="connect-bar__step" onClick={()=>void remote(device.id,'toggle')} aria-label={t('Пауза','Pause')}><Pause size={16}/></button>
    <button type="button" className="connect-bar__step" onClick={()=>void remote(device.id,'next')} aria-label={t('Следующий трек','Next track')}><SkipForward size={16}/></button>
    <button type="button" className="connect-bar__here" onClick={()=>void listenHere(device.id)}><ArrowDownToLine size={14}/>{t('Сюда','Here')}</button>
  </div>;
}

export function ConnectLayer(){
  useEffect(()=>{initConnect();},[]);
  return <><RemoteBar/><DevicesPanel/></>;
}
