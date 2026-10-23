import {scopedStorageKey} from '../telegram/runtime.js';
// TIDAL and the Telegram source are gone: a saved choice of either plays through «Auto» instead of failing.
const allowed=['auto','soundcloud','youtube','personal'];
const retired=['tidal','telegram'];
export function getPreferredSource(trackId?:string):string{try{const value=localStorage.getItem(scopedStorageKey(trackId?`source:${trackId}`:'source:default'));if(value&&allowed.includes(value))return value;if(value&&retired.includes(value))return 'auto';}catch{}return trackId?getPreferredSource():'auto';}
export function setPreferredSource(source:string,trackId?:string):void{if(!allowed.includes(source))return;if(source==='telegram')trackId=undefined;try{localStorage.setItem(scopedStorageKey(trackId?`source:${trackId}`:'source:default'),source);}catch{}window.dispatchEvent(new Event('oskolok-source-change'));}

/** "Lossless first": automatic playback asks the listener's own TIDAL account
 * for FLAC before the regular sources. */
export function getLosslessPreferred():boolean{try{return localStorage.getItem(scopedStorageKey('lossless'))==='1';}catch{return false;}}
export function setLosslessPreferred(on:boolean):void{try{localStorage.setItem(scopedStorageKey('lossless'),on?'1':'0');}catch{}window.dispatchEvent(new Event('oskolok-lossless'));}

/** «Telegram» — глобальный режим Mini App: треки присылает бот, играет нативный плеер Telegram (в фоне). Вне Mini App не действует. */
export const inTelegramMiniApp=()=>typeof window!=='undefined'&&!!window.Telegram?.WebApp?.initData;
/** The Telegram source mode was removed: inside Telegram the Mini App is simply the web version. */
export const telegramSourceActive=()=>false;

export function getRecording(trackId:string,source?:string):string|undefined{try{return localStorage.getItem(scopedStorageKey(`recording:${trackId}:${source}`))||undefined;}catch{return undefined;}}
export function setRecording(trackId:string,source:string,id?:string){try{const key=scopedStorageKey(`recording:${trackId}:${source}`);if(id)localStorage.setItem(key,id);else localStorage.removeItem(key);}catch{}}
export function recordingBetaEnabled(){try{return localStorage.getItem(scopedStorageKey('recording-beta'))!=='off';}catch{return true;}}
export function setRecordingBetaEnabled(value:boolean){try{localStorage.setItem(scopedStorageKey('recording-beta'),value?'on':'off');}catch{}}
