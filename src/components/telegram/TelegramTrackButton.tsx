import React, { useState } from 'react';
import { Send, Download, Check, X } from 'lucide-react';
import type { Track } from '../../types/index.js';
import { apiClient } from '../../api/apiClient.js';
import { useTelegramStore, openTelegramChat, requestBotWriteAccess } from '../../telegram/runtime.js';
import {Link} from 'react-router-dom';
import UniqueLoading from '../ui/morph-loading.js';
export function TelegramTrackButton({ track }: { track: Track }) {
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false), [sent,setSent] = useState(false), [error,setError] = useState('');
  const { profileExportAvailable, botUsername } = useTelegramStore();
  const transfer = async () => {
    setBusy(true); setError('');
    try {
      await apiClient.request('/telegram/profile-music',{method:'POST',body:JSON.stringify({trackId:track.id})});
      setSent(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось передать трек.'); }
    finally { setBusy(false); }
  };
  return <>
    <button className="telegram-track-button" onClick={() => {setOpen(true);setError('');}}><Send size={13}/> В Telegram-профиль</button>
    {open && <div className="telegram-transfer-backdrop" role="dialog" aria-modal="true" aria-label="Добавить музыку в Telegram-профиль">
      <section className="telegram-transfer-panel">
        <button className="transfer-close" onClick={() => setOpen(false)} aria-label="Закрыть передачу трека"><X size={20}/></button>
        <span className="eyebrow">@{botUsername}</span><h2>Музыка в вашем профиле</h2>
        <p className="transfer-track">{track.artist.name} — {track.title}</p>
        {sent ? <p className="transfer-success"><Check size={18}/> Трек добавлен в ваш Telegram-профиль.</p> : <>
          <p>Осколок подготовит аудио и добавит его в музыку вашего Telegram-профиля.</p>
          <button className="primary-button" disabled={busy || track.access !== 'playable'} onClick={transfer}>{busy ? <UniqueLoading size="sm" className="morph-loading-compact" label="Добавляем трек"/> : <Send size={16}/>} {busy ? 'Загружаем и добавляем…' : 'Добавить в профиль'}</button>
          <Link className="text-button" to="/profile" onClick={()=>setOpen(false)}>Подключить сессию Telegram</Link>
        </>}
        {error && <p className="lyrics-error" role="alert">{error}</p>}
      </section>
    </div>}
  </>;
}
