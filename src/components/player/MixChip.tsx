import React from 'react';
import {Disc3} from 'lucide-react';
import {audioManager} from '../../audio/AudioManager.js';
import {useTranslation} from '../../stores/useLanguageStore.js';

/** While «ИИ-микс» blends two tracks: which transition and, when beatmatched, the tempos it joined. */
export function MixChip(){
  const t=useTranslation(),[mix,setMix]=React.useState(audioManager.mixNow);
  React.useEffect(()=>{const sync=()=>setMix(audioManager.mixNow);window.addEventListener('oskolok-mix',sync);return()=>window.removeEventListener('oskolok-mix',sync);},[]);
  if(!mix)return null;
  const names:Record<string,[string,string]>={'bass-swap':['обмен басами','bass swap'],filter:['фильтр','filter'],echo:['эхо-срез','echo cut'],afterglow:['послесвечение','afterglow'],rise:['подъём','rise'],blend:['плавный переход','fade']};
  const [ru,en]=names[mix.preset]||names.blend;
  const tempo=mix.beatmatched&&mix.from&&mix.to?` · ${Math.round(mix.to)}→${Math.round(mix.from)} BPM`:'';
  return <span className="np-reason np-mix" role="status"><Disc3 size={12} aria-hidden="true"/>{t(`Сводим: ${ru}`,`Mixing: ${en}`)}{tempo}</span>;
}
