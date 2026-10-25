import React from 'react';
import {audioManager} from '../../audio/AudioManager.js';
import type {MixSettings as Settings} from '../../audio/mixPlanner.js';
import {useTranslation} from '../../stores/useLanguageStore.js';

/** «ИИ-микс» controls in the wave settings: an on/off switch; style, length, beatmatch and effect amounts stay behind one button. */
export function MixSettings({compact=false}:{compact?:boolean}){
  const t=useTranslation();
  const [on,setOn]=React.useState(()=>audioManager.getMix()),[s,setS]=React.useState(()=>audioManager.getMixSettings()),[open,setOpen]=React.useState(false);
  React.useEffect(()=>{const sync=()=>{setOn(audioManager.getMix());setS(audioManager.getMixSettings());};window.addEventListener('oskolok-mix',sync);return()=>window.removeEventListener('oskolok-mix',sync);},[]);
  if(!audioManager.crossfadeSupported())return compact?null:<small className="media-fx-note">{t('На iPhone и iPad браузер не даёт сводить треки.','iPhone and iPad browsers do not allow mixing tracks.')}</small>;
  const set=(next:Partial<Settings>)=>{audioManager.setMixSettings(next);setS({...s,...next});};
  const styles:Array<[Settings['style'],string,string]>=[['auto','Авто','Auto'],['bass-swap','Обмен басами','Bass swap'],['filter','Фильтр','Filter'],['echo','Эхо-срез','Echo cut'],['dissolve','Растворение','Dissolve'],['afterglow','Послесвечение','Afterglow'],['rise','Подъём','Rise'],['blend','Плавно','Fade']];
  const bars:Array<Settings['bars']>=['auto',2,4,8,16];
  const slider=(key:'echo'|'reverb'|'muffle',ru:string,en:string)=><label className="mix-slider"><span>{t(ru,en)}</span><input type="range" min={0} max={100} step={5} value={Math.round(s[key]*100)} onChange={e=>set({[key]:Number(e.target.value)/100})} aria-valuetext={`${Math.round(s[key]*100)}%`}/><output>{Math.round(s[key]*100)}%</output></label>;
  return <div className="mix-settings">
    <label className="media-fx-switch"><span><b>{t('ИИ-микс','AI mix')}</b><small>{t('В Резонансе сводит треки как диджей: подгоняет темп, меняет басы на сильной доле, уводит фильтром, эхом или ревербом.','In Resonance, mixes tracks like a DJ: matches tempo, swaps the bass on the downbeat, takes the old track out with a filter, echo or reverb.')}</small></span><input type="checkbox" role="switch" checked={on} onChange={()=>{audioManager.setMix(!on);setOn(!on);}}/></label>
    {on&&<button type="button" className="mix-more" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?t('Скрыть настройки перехода','Hide transition settings'):t('Настроить переход','Transition settings')}</button>}
    {on&&open&&<>
      <div className="mix-row"><span>{t('Переход','Transition')}</span><div className="media-fx-presets" role="radiogroup" aria-label={t('Стиль перехода','Transition style')}>{styles.map(([id,ru,en])=><button key={id} type="button" role="radio" aria-checked={s.style===id} className={s.style===id?'is-active':''} onClick={()=>set({style:id})}>{t(ru,en)}</button>)}</div></div>
      <div className="mix-row"><span>{t('Длина','Length')}</span><div className="media-fx-presets" role="radiogroup" aria-label={t('Длина перехода в тактах','Transition length in bars')}>{bars.map(b=><button key={b} type="button" role="radio" aria-checked={s.bars===b} className={s.bars===b?'is-active':''} onClick={()=>set({bars:b})}>{b==='auto'?t('Авто','Auto'):t(`${b} т.`,`${b} bars`)}</button>)}</div></div>
      <label className="mix-check"><input type="checkbox" checked={s.beatmatch} onChange={e=>set({beatmatch:e.target.checked})}/><span>{t('Сводить по битам (подгонять темп)','Beatmatch (match the tempo)')}</span></label>
      {slider('echo','Эхо (дилей)','Echo (delay)')}
      {slider('reverb','Реверб','Reverb')}
      {slider('muffle','Заглушение','Muffle')}
      <small className="media-fx-note">{t('50% — как задумано стилем. Пока трек не разобран, звучит плавный переход.','50% is the style as designed. Until a track is analysed, a plain fade plays.')}</small>
    </>}
  </div>;
}
