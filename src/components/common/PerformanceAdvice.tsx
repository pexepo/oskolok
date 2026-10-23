import {Gauge,X} from 'lucide-react';
import {usePerformance} from '../../utils/performance.js';
import {useTranslation} from '../../stores/useLanguageStore.js';

/** One-time note when the frame-rate check finds the device struggling. */
export function PerformanceAdvice(){
 const t=useTranslation(),{advice,mode,setMode,dismissAdvice}=usePerformance();
 if(!advice)return null;
 const name=advice==='lite'?t('экономный','economy'):t('сбалансированный','balanced');
 const auto=mode==='auto';
 return <div className="perf-advice" role="status">
  <Gauge size={18} aria-hidden="true"/>
  <p>{auto?t(`Устройство не справляется со всеми эффектами — включили ${name} режим. Сменить можно в настройках.`,`This device struggles with every effect — switched to ${name} mode. Change it in settings.`):t(`Интерфейс подтормаживает. Включить ${name} режим?`,`The interface stutters. Switch to ${name} mode?`)}</p>
  <div>{auto?<><button type="button" className="text-button" onClick={dismissAdvice}>{t('Хорошо','OK')}</button><button type="button" className="text-button" onClick={()=>setMode('full')}>{t('Вернуть максимум','Back to max')}</button></>:<><button type="button" className="primary-button" onClick={()=>setMode(advice)}>{t('Включить','Turn on')}</button><button type="button" className="icon-button" aria-label={t('Не нужно','No thanks')} onClick={dismissAdvice}><X size={16}/></button></>}</div>
 </div>;
}
