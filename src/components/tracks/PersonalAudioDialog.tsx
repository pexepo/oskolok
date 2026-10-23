import React from 'react';
import {Modal} from '../common/Modal.js';
import {FileUploader} from '../common/FileUploader.js';
import {useReportStore} from '../common/ReportDialog.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import type {Track} from '../../types/index.js';
export function PersonalAudioDialog({track,isOpen,onClose,onSaved}:{track:Track;isOpen:boolean;onClose:()=>void;onSaved?:()=>void}){
 const t=useTranslation(),[fileId,setFileId]=React.useState(''),[report,setReport]=React.useState(false),[platform,setPlatform]=React.useState('soundcloud'),[uploading,setUploading]=React.useState(false);
 React.useEffect(()=>{setFileId('');setReport(false);setPlatform('soundcloud');},[track.id,isOpen]);
 return <Modal isOpen={isOpen} onClose={()=>{if(!uploading)onClose();}} title={t('Личный источник','Personal audio source')}><div className="content-form"><p>{track.artist.name} — {track.title}</p><FileUploader kind="audio" trackId={track.id} onBusyChange={setUploading} onUploaded={f=>{setFileId(f.id);onSaved?.();}}/><label className="content-check"><input type="checkbox" checked={report} onChange={e=>setReport(e.target.checked)}/>{t('Неверный источник в SoundCloud или YouTube? Отправь верный трек нам','Wrong SoundCloud or YouTube recording? Send us the correct track')}</label>{report&&<label>{t('Площадка с неверной записью','Provider with incorrect recording')}<select className="glass-input" value={platform} onChange={e=>setPlatform(e.target.value)}><option value="soundcloud">SoundCloud</option><option value="youtube">YouTube</option></select></label>}<small>{t('Файл доступен только вам. Публикация возможна после отдельной заявки и одобрения.','Only you can access this file. Publishing requires a separate submission and approval.')}</small><button type="button" className="primary-button" disabled={!fileId||uploading} onClick={()=>{onClose();if(report)useReportStore.getState().open({track,kind:'source',platform,attachmentIds:[fileId]});}}>{t('Готово','Done')}</button></div></Modal>;
}
