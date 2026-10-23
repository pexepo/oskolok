import {apiClient} from './apiClient.js';
import {apiBase} from '../telegram/runtime.js';
import type {Track} from '../types/index.js';

export type UnreleasedKind='leak'|'snippet'|'demo'|'other';
export type ReviewStatus='pending'|'approved'|'rejected';
export interface UnreleasedSubmission {id:string;title:string;artistName:string;artistId?:string|null;kind:UnreleasedKind;source:string;description:string;duration:number;status:ReviewStatus;reviewNote:string;createdAt:string;track:Track}
export interface UnreleasedInput {title:string;artistName:string;artistId?:string;audioFileId:string;coverFileId?:string;kind:UnreleasedKind;source?:string;description?:string;duration?:number}
export interface GeniusUpcomingAlbum {id:number;name:string;url:string;cover?:string;date?:string;dateKnown:boolean;trackCount?:number}
export interface GeniusUnreleasedSong {id:number;title:string;url:string;art?:string;views?:number;date?:string;reason:string;track?:Track}
export interface GeniusUpcoming {artist?:{id:number;name:string;url:string};upcoming:GeniusUpcomingAlbum[];unreleased:GeniusUnreleasedSong[]}
export interface FollowStatus {following:boolean;followers:number;artistKey:string}
export interface FollowedArtist {id:string;artistKey:string;artistId:string|null;name:string;avatar:string|null;createdAt:string}
export interface AppNotification {id:string;kind:string;title:string;body:string;url:string|null;artworkUrl:string|null;readAt:string|null;createdAt:string}

/** Server-relative "/api/…" URLs (covers) must follow the client's API base (Electron, tunnels). */
const absolute=(url?:string)=>url?.startsWith('/api/')?`${apiBase}${url.slice(4)}`:url;
export const withApiBase=(track:Track):Track=>({...track,artworkUrl:absolute(track.artworkUrl)});

export const UNRELEASED_KIND_LABELS:Record<UnreleasedKind,[string,string]>={leak:['Слив','Leak'],snippet:['Сниппет','Snippet'],demo:['Демо','Demo'],other:['Другое','Other']};

export const communityApi={
 uploadUnreleasedFile:(file:File,kind:'audio'|'cover')=>apiClient.request<{id:string;fileName:string;size:number}>(`/unreleased/files?${new URLSearchParams({kind,fileName:file.name})}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file}),
 submitUnreleased:(data:UnreleasedInput)=>apiClient.request<UnreleasedSubmission>('/unreleased',{method:'POST',body:JSON.stringify(data)}).then(s=>({...s,track:withApiBase(s.track)})),
 myUnreleased:()=>apiClient.request<UnreleasedSubmission[]>('/unreleased/mine').then(rows=>rows.map(s=>({...s,track:withApiBase(s.track)}))),
 deleteUnreleased:(id:string)=>apiClient.request<{ok:boolean}>(`/unreleased/${encodeURIComponent(id)}`,{method:'DELETE'}),
 artistUnreleased:(name:string,ids:string[])=>apiClient.request<Track[]>(`/unreleased/artist?${new URLSearchParams({name,ids:ids.filter(Boolean).join(',')})}`).then(rows=>rows.map(withApiBase)),
 searchUnreleased:(q:string,signal?:AbortSignal)=>apiClient.request<Track[]>(`/unreleased/search?${new URLSearchParams({q})}`,{signal}).then(rows=>rows.map(withApiBase)),
 geniusUpcoming:(name:string)=>apiClient.request<GeniusUpcoming>(`/genius/upcoming?${new URLSearchParams({name})}`).then(d=>({...d,unreleased:d.unreleased.map(s=>s.track?{...s,track:withApiBase(s.track)}:s)})),
 followStatus:(name:string)=>apiClient.request<FollowStatus>(`/follows/status?${new URLSearchParams({name})}`),
 follow:(data:{name:string;artistId?:string;avatar?:string})=>apiClient.request<FollowStatus>('/follows',{method:'POST',body:JSON.stringify(data)}),
 unfollow:(name:string)=>apiClient.request<FollowStatus>(`/follows?${new URLSearchParams({name})}`,{method:'DELETE'}),
 follows:()=>apiClient.request<FollowedArtist[]>('/follows'),
 notifications:()=>apiClient.request<{items:AppNotification[];unread:number}>('/notifications'),
 markRead:(ids?:string[])=>apiClient.request<{ok:boolean}>('/notifications/read',{method:'POST',body:JSON.stringify(ids?{ids}:{})}),
};
