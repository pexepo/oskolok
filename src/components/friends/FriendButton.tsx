import React from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {UserPlus,UserCheck,Clock3,Check,X,AudioWaveform,UsersRound} from 'lucide-react';
import {friendsApi,type Relation} from '../../api/friendsApi.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {useToastStore} from '../../stores/useToastStore.js';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {listenTogether} from '../../connect/jam.js';

/** Add / accept / cancel / remove, depending on how you and this listener are related. */
export function FriendButton({publicId,relation,onChange,compact}:{publicId:string;relation:Relation;onChange?:(r:Relation)=>void;compact?:boolean}){
 const t=useTranslation(),client=useQueryClient(),[busy,setBusy]=React.useState(false),[confirm,setConfirm]=React.useState(false);
 const run=async(action:'add'|'remove')=>{
  setBusy(true);
  try{const {relation:next}=await friendsApi[action](publicId);onChange?.(next);setConfirm(false);void client.invalidateQueries({queryKey:['friends']});}
  catch(e){useToastStore.getState().addToast((e as Error).message||t('Не получилось. Попробуйте ещё раз.','That failed. Try again.'),'error');}
  finally{setBusy(false);}
 };
 if(relation==='self')return null;
 const cls=`friend-btn${compact?' friend-btn--compact':''}`;
 if(relation==='incoming')return <span className="friend-btn-group"><button type="button" className={`${cls} friend-btn--primary`} disabled={busy} onClick={()=>void run('add')}><Check size={15}/>{t('Принять','Accept')}</button><button type="button" className={cls} disabled={busy} aria-label={t('Отклонить заявку','Decline request')} onClick={()=>void run('remove')}><X size={15}/>{!compact&&t('Отклонить','Decline')}</button></span>;
 if(relation==='outgoing')return <button type="button" className={cls} disabled={busy} onClick={()=>void run('remove')} title={t('Нажмите, чтобы отменить','Tap to cancel')}><Clock3 size={15}/>{t('Заявка отправлена','Request sent')}</button>;
 if(relation==='friends')return confirm
  ?<span className="friend-btn-group"><button type="button" className={`${cls} friend-btn--danger`} disabled={busy} onClick={()=>void run('remove')}>{t('Удалить из друзей','Remove friend')}</button><button type="button" className={cls} onClick={()=>setConfirm(false)}>{t('Отмена','Cancel')}</button></span>
  :<button type="button" className={`${cls} friend-btn--done`} onClick={()=>setConfirm(true)}><UserCheck size={15}/>{t('В друзьях','Friends')}</button>;
 return <button type="button" className={`${cls} friend-btn--primary`} disabled={busy} onClick={()=>void run('add')}><UserPlus size={15}/>{t('Добавить в друзья','Add friend')}</button>;
}

/** With a friend: «Волна на двоих» (a Резонанс of both tastes) and «Слушать вместе» (a Jam with them). */
export function TogetherButtons({publicId,name,compact}:{publicId:string;name:string;compact?:boolean}){
 const t=useTranslation(),starting=usePlayerStore(s=>s.isStartingWave),blend=usePlayerStore(s=>s.isWaveActive&&s.waveBlend?.publicId===publicId);
 const [busy,setBusy]=React.useState(false);
 const cls=`friend-btn${compact?' friend-btn--compact':''}`,waveLabel=blend?t('Играет волна на двоих','Wave for two is on'):t('Волна на двоих','Wave for two');
 return <span className={`friend-btn-group${compact?'':' profile-together'}`}>
  <button type="button" className={`${cls} ${blend?'friend-btn--done':compact?'':'friend-btn--primary'}`} disabled={starting} aria-pressed={blend} aria-label={compact?waveLabel:undefined} title={t(`Резонанс из вашего вкуса и вкуса ${name}`,`Resonance from your taste and ${name}'s`)} onClick={()=>{if(!blend)void usePlayerStore.getState().startMyWave(undefined,{publicId,name});}}><AudioWaveform size={15}/>{!compact&&waveLabel}</button>
  <button type="button" className={cls} disabled={busy} aria-label={compact?t(`Слушать вместе с ${name}`,`Listen together with ${name}`):undefined} title={t(`Общая очередь с ${name}: каждый слушает на своём устройстве`,`A shared queue with ${name}: each listens on their own device`)} onClick={async()=>{setBusy(true);try{await listenTogether(publicId,name);}finally{setBusy(false);}}}><UsersRound size={15}/>{!compact&&t('Слушать вместе','Listen together')}</button>
 </span>;
}
