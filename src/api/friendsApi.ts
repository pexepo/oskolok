import {apiClient} from './apiClient.js';

export type Relation='none'|'friends'|'outgoing'|'incoming'|'self';
export interface Person {userId:string;publicId:string;displayName:string;username:string|null;avatarUrl:string;listening:{id:string;title:string;artist?:string;artworkUrl?:string}|null;relation:Relation}
export interface FriendLists {friends:Person[];incoming:Person[];outgoing:Person[]}

export const friendsApi={
 lists:()=>apiClient.request<FriendLists>('/friends'),
 search:(q:string,signal?:AbortSignal)=>apiClient.request<Person[]>(`/people/search?q=${encodeURIComponent(q)}`,{signal}),
 contacts:()=>apiClient.request<{connected:boolean;people:Person[]}>('/people/contacts'),
 status:(publicId:string)=>apiClient.request<{relation:Relation}>(`/friends/status/${encodeURIComponent(publicId)}`),
 add:(publicId:string)=>apiClient.request<{relation:Relation}>(`/friends/${encodeURIComponent(publicId)}`,{method:'POST',body:'{}'}),
 remove:(publicId:string)=>apiClient.request<{relation:Relation}>(`/friends/${encodeURIComponent(publicId)}`,{method:'DELETE'}),
};
