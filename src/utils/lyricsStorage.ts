import { scopedStorageKey } from '../telegram/runtime.js';
import type { LyricLine } from '../types/index.js';
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
  const request=indexedDB.open('oskolok-interference',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('lyrics');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
export async function readLocalLyrics(id:string):Promise<LyricLine[]|undefined>{
  const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('lyrics');const req=tx.objectStore('lyrics').get(scopedStorageKey(id));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close();});
}
export async function saveLocalLyrics(id:string,lines:LyricLine[]):Promise<void>{
  const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('lyrics','readwrite');tx.objectStore('lyrics').put(lines,scopedStorageKey(id));tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});
}
export async function deleteLocalLyrics(id:string):Promise<void>{
  const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('lyrics','readwrite');tx.objectStore('lyrics').delete(scopedStorageKey(id));tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});
}
