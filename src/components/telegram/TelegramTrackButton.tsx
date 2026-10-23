import React, { useEffect, useRef, useState } from 'react';
import { Send, Check } from 'lucide-react';
import type { Track } from '../../types/index.js';
import { apiClient } from '../../api/apiClient.js';
import { useTelegramStore } from '../../telegram/runtime.js';
import {Link} from 'react-router-dom';
import LumaSpin from '../ui/luma-spin.js';
import {Modal} from '../common/Modal.js';
import { useTranslation } from '../../stores/useLanguageStore.js';
export function TelegramTrackButton({ track }: { track: Track }) {
  const t = useTranslation();
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false), [sent,setSent] = useState(false), [error,setError] = useState('');
  const [elapsed,setElapsed]=useState(0);
  const inFlight=useRef(false);
  const botUsername=useTelegramStore(s=>s.botUsername);
  useEffect(()=>{
    if(!busy)return;
    const started=Date.now();setElapsed(0);
    const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);
    return()=>clearInterval(timer);
  },[busy]);
  const transfer = async () => {
    if(inFlight.current)return;
    inFlight.current=true;
    setBusy(true); setError('');
    try {
      await apiClient.addTrackToTelegramProfile(track.id);
      setSent(true);
    } catch (e) { setError(e instanceof Error ? e.message : t('Не удалось передать трек.', 'Could not send the track.')); }
    finally { inFlight.current=false;setBusy(false); }
  };
  return <>
    <button className="telegram-track-button" onClick={() => {setOpen(true);setError('');}}><Send size={13}/> {t('В Telegram-профиль', 'To Telegram profile')}</button>
    <Modal isOpen={open} onClose={()=>setOpen(false)} title={t('Музыка в вашем профиле','Music in your profile')} className="telegram-transfer-panel">
        <span className="eyebrow">@{botUsername}</span>
        <p className="transfer-track">{track.artist.name} — {track.title}</p>
        {sent ? <p className="transfer-success"><Check size={18}/> {t('Трек добавлен в ваш Telegram-профиль.', 'The track was added to your Telegram profile.')}</p> : <>
          <p>{t('Осколок подготовит аудио и добавит его в музыку вашего Telegram-профиля.', 'Oskolok will prepare the audio and add it to your Telegram profile music.')}</p>
          <button type="button" className="primary-button telegram-transfer-submit" disabled={busy || track.access !== 'playable'} onClick={()=>void transfer()} aria-busy={busy}>{busy ? <LumaSpin size="sm" label={t('Добавляем трек', 'Adding track')}/> : <Send size={16} aria-hidden="true"/>}<span>{busy ? t('Добавляем…','Adding…') : t('Добавить в профиль','Add to profile')}</span></button>
          {busy&&<p className="transfer-note" role="status">{elapsed>=15?t('Подготовка и загрузка аудио могут занять до двух минут.','Preparing and uploading audio can take up to two minutes.'):t('Готовим аудио и передаём в Telegram…','Preparing audio and sending it to Telegram…')}{elapsed>0&&<span className="transfer-elapsed"> · {elapsed} {t('с','s')}</span>}</p>}
          <Link className="text-button" to="/profile" onClick={()=>setOpen(false)}>{t('Подключить сессию Telegram', 'Connect Telegram session')}</Link>
        </>}
        {error && <p className="lyrics-error" role="alert">{error}</p>}
    </Modal>
  </>;
}
