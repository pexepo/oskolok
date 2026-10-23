/** Quieter maximum with a useful, smooth slider range near the bottom. */
export const outputVolume=(volume:number)=>Math.max(0,Math.min(1,volume))**2*.7;
/** Phones hide the slider and use their hardware buttons: the app then plays at full level instead of a forgotten 25 %. */
export const touchOnlyDevice=()=>{try{return matchMedia('(hover: none) and (pointer: coarse)').matches;}catch{return false;}};
export const elementVolume=(volume:number,touchOnly=touchOnlyDevice())=>touchOnly?1:outputVolume(volume);
export const normalizationGain=(gainDb:number,enabled:boolean,equalizer:number[])=>10**(((enabled?Math.max(-24,Math.min(0,gainDb)):0)-Math.max(0,...equalizer))/20);
