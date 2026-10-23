import { create } from 'zustand';
export type Language = 'ru' | 'en';
export const useLanguageStore = create<{language:Language;setLanguage:(language:Language)=>void}>((set)=>({
  language:typeof localStorage!=='undefined'&&localStorage.getItem('oskolok_language')==='en'?'en':'ru',
  setLanguage:(language)=>{localStorage.setItem('oskolok_language',language);document.documentElement.lang=language;set({language});},
}));
export function useTranslation(){const language=useLanguageStore(s=>s.language);return (ru:string,en:string)=>language==='en'?en:ru;}
/** Outside React (stores, audio, utils): reads the language at call time. */
export function tr(ru:string,en:string){return useLanguageStore.getState().language==='en'?en:ru;}
