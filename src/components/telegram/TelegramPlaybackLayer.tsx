import React,{useEffect,useSyncExternalStore} from 'react';
import {Send,SkipBack,SkipForward,History,X,Loader2} from 'lucide-react';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {openTelegramChat} from '../../telegram/runtime.js';
import {answerRecommendation,dismissResume,fmtTime,initTelegramPlayback,resumePlayback,stepTelegram,useTelegramPlayback} from '../../telegram/telegramPlayback.js';
import {telegramSourceActive} from '../../utils/playbackPreferences.js';
import {otherDevices,useConnectStore} from '../../connect/connect.js';
import './telegram-playback.css';

const subscribeSource=(cb:()=>void)=>{window.addEventListener('oskolok-source-change',cb);return()=>window.removeEventListener('oskolok-source-change',cb);};

/** Слой Telegram-воспроизведения: рекомендация источника, «Продолжить с 1:23», компактная плашка «Играет в Telegram». */
export function TelegramPlaybackLayer(){
  const t=useTranslation();
  const {remote,sending,resume,recommend}=useTelegramPlayback();
  const telegramMode=useSyncExternalStore(subscribeSource,telegramSourceActive,()=>false);
  useEffect(()=>{initTelegramPlayback();},[]);
  const track=remote?.mode==='telegram'?remote.queue[remote.index]:undefined;
  // Music that plays on another device right now is offered by Connect («Играет на …»), not as an old position.
  const playingElsewhere=useConnectStore(s=>otherDevices(s).some(d=>d.state?.isPlaying));
  const resumeTrack=playingElsewhere?undefined:resume?.queue[resume.index];
  return <>
    {recommend&&<div className="tgp-sheet" role="dialog" aria-modal="false" aria-labelledby="tgp-rec-title">
      <span className="tgp-sheet__icon" aria-hidden="true"><Send size={18}/></span>
      <div className="tgp-sheet__body">
        <strong id="tgp-rec-title">{t('Источник Telegram','Telegram source')}</strong>
        <p>{t('Вы в мини-приложении. С источником Telegram музыка играет здесь, а когда закроете приложение, бот продолжит очередь в чате — плеером Telegram, в фоне.','You are in the Mini App. With the Telegram source music plays here, and when you close the app the bot continues the queue in the chat, in the background.')}</p>
        <div className="tgp-sheet__actions">
          <button type="button" className="sg-btn sg-btn--primary" onClick={()=>answerRecommendation(true)}>{t('Сделать Telegram источником','Make Telegram the source')}</button>
          <button type="button" className="text-button" onClick={()=>answerRecommendation(false)}>{t('Позже','Later')}</button>
        </div>
      </div>
    </div>}
    {!recommend&&resume&&resumeTrack&&<div className="tgp-sheet" role="dialog" aria-modal="false" aria-labelledby="tgp-resume-title">
      <span className="tgp-sheet__icon" aria-hidden="true"><History size={18}/></span>
      <div className="tgp-sheet__body">
        <strong id="tgp-resume-title">{t('Продолжим с того же места?','Pick up where you left off?')}</strong>
        <p className="tgp-sheet__track">{resumeTrack.artist.name} — {resumeTrack.title}</p>
        <div className="tgp-sheet__actions">
          <button type="button" className="sg-btn sg-btn--primary" onClick={()=>void resumePlayback(resume)}>{resume.position>=3?t(`Продолжить с ${fmtTime(resume.position)}`,`Resume from ${fmtTime(resume.position)}`):t('Продолжить','Resume')}</button>
          <button type="button" className="text-button" onClick={dismissResume}>{t('Не нужно','No thanks')}</button>
        </div>
      </div>
      <button type="button" className="tgp-sheet__close" aria-label={t('Закрыть','Close')} onClick={dismissResume}><X size={16}/></button>
    </div>}
    {telegramMode&&(track||sending)&&<div className="tgp-bar" role="region" aria-label={t('Играет в Telegram','Playing in Telegram')}>
      <button type="button" className="tgp-bar__step" aria-label={t('Предыдущий трек','Previous track')} disabled={sending||!remote||remote.index<=0} onClick={()=>void stepTelegram(-1)}><SkipBack size={16}/></button>
      <button type="button" className="tgp-bar__main" onClick={openTelegramChat}>
        {sending?<Loader2 size={15} className="tgp-spin" aria-hidden="true"/>:<Send size={15} aria-hidden="true"/>}
        <span><small>{sending?t('Отправляем в Telegram…','Sending to Telegram…'):t('Играет в Telegram · открыть чат','Playing in Telegram · open chat')}</small><b>{track?`${track.artist.name} — ${track.title}`:'…'}</b></span>
      </button>
      <button type="button" className="tgp-bar__step" aria-label={t('Следующий трек','Next track')} disabled={sending||!remote||remote.index>=remote.queue.length-1} onClick={()=>void stepTelegram(1)}><SkipForward size={16}/></button>
    </div>}
  </>;
}
