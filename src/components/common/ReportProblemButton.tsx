import React from 'react';
import {useLocation} from 'react-router-dom';
import {Bug} from 'lucide-react';
import {useReportStore} from './ReportDialog.js';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {useLanguageStore,useTranslation} from '../../stores/useLanguageStore.js';
import {pageName,recentErrors} from '../../utils/diagnostics.js';
import '../../styles/community.css';

/** Opens the shared ReportDialog pre-filled with the current page, track and recent client errors. */
export function openPageReport(){
 const route=location.hash.startsWith('#/')?location.hash.slice(1):location.pathname,language=useLanguageStore.getState().language,track=usePlayerStore.getState().currentTrack||undefined;
 const name=pageName(route.split('?')[0],language);
 useReportStore.getState().open({track,kind:'bug',pageName:name,diagnostics:{pageName:name,route:route.split('?')[0],errors:recentErrors(),userAgent:navigator.userAgent.slice(0,400),viewport:`${innerWidth}x${innerHeight}`,nowPlaying:track?`${track.id} · ${track.artist.name} — ${track.title}${track.audioSource?` · ${track.audioSource}`:''}`.slice(0,400):undefined}});
}

/** Small floating «Сообщить о проблеме» action shown on every tab. */
export function ReportProblemButton(){
 const t=useTranslation(),open=useReportStore(s=>Boolean(s.context)),{pathname}=useLocation();
 if(open||pathname.startsWith('/admin'))return null;
 return <button type="button" className="report-fab" onClick={openPageReport} aria-label={t('Сообщить о проблеме','Report a problem')} title={t('Сообщить о проблеме на этой странице','Report a problem on this page')}><Bug size={16}/><span>{t('Проблема?','Issue?')}</span></button>;
}
