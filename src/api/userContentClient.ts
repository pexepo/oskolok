import {apiClient} from './apiClient.js';
import {telegramAuthHeaders} from '../telegram/runtime.js';
import type {LyricLine} from '../types/index.js';
export interface UploadedFile {id:string;fileName:string;size:number;url:string}
export interface PersonalContent {trackId:string;offset:number;lines:LyricLine[]|null;audio:UploadedFile|null}
export interface GeniusPerson {id?:number;name:string;url?:string;image?:string}
/** Mirrors server/src/services/GeniusSongService.ts. */
export interface GeniusSongInfo {id:number;url:string;title:string;artist:string;artwork?:string;description?:string;releaseDate?:string;album?:{name:string;url?:string;cover?:string};primaryArtists:GeniusPerson[];featuredArtists:GeniusPerson[];credits:Array<{role:string;people:GeniusPerson[]}>;labels:string[];recordingLocation?:string;relationships:Array<{type:string;songs:Array<{title:string;artist:string;url:string}>}>}
export interface TrackInfo {trackId:string;genius:GeniusSongInfo|null;releaseDate:string|null;description:string|null;descriptionSource?:string;descriptionUrl?:string}
export interface ReportPayload {requestId:string;kind:'bug'|'playback'|'source'|'lyrics'|'timing'|'catalog'|'other';reason:string;description:string;trackId?:string;trackTitle?:string;artistName?:string;page?:string;attachmentIds?:string[];platform?:string;proposedUrl?:string;offset?:number;lines?:LyricLine[];diagnostics?:{pageName?:string;route?:string;errors:string[];userAgent?:string;viewport?:string;nowPlaying?:string}}
export const contentApi={
 personal:(trackId:string)=>apiClient.request<PersonalContent>(`/content/tracks/${encodeURIComponent(trackId)}/personal`),
 save:(trackId:string,data:Partial<Pick<PersonalContent,'offset'|'lines'>>&{trackTitle?:string;artistName?:string;source?:string})=>apiClient.request<PersonalContent>(`/content/tracks/${encodeURIComponent(trackId)}/personal`,{method:'PUT',body:JSON.stringify(data)}),
 info:(trackId:string)=>apiClient.request<TrackInfo>(`/content/tracks/${encodeURIComponent(trackId)}/info`),
 report:(data:ReportPayload)=>apiClient.request<{id:string;status:string}>('/content/reports',{method:'POST',body:JSON.stringify(data)}),
 upload:async(file:File,kind:'audio'|'attachment',trackId?:string):Promise<UploadedFile>=>{
  return apiClient.request<UploadedFile>(`/content/files?${new URLSearchParams({kind,fileName:file.name,...(trackId?{trackId}:{})})}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
 },
 download:async(url:string,name:string)=>{const response=await fetch(url,{credentials:'include',headers:telegramAuthHeaders()});if(!response.ok)throw new Error('Не удалось скачать файл');const objectUrl=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=objectUrl;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);}
};
