import React from 'react';
import {Flag} from 'lucide-react';
import {useReportStore} from './ReportDialog.js';
import {useTranslation} from '../../stores/useLanguageStore.js';

/** «Не тот артист?» / «Не тот релиз?»: sends this page to the admins as someone else's or mixed up. */
export function WrongCatalogButton({subject}:{subject:{type:'artist'|'release';id:string;name:string;artist?:string}}){
  const t=useTranslation();
  return <button type="button" className="wrong-catalog" onClick={()=>useReportStore.getState().open({kind:'catalog',subject,pageName:subject.name})}>
    <Flag size={13} aria-hidden="true"/>{subject.type==='artist'?t('Не тот артист?','Wrong artist?'):t('Не тот релиз?','Wrong release?')}
  </button>;
}
