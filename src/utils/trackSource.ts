import type { Track } from '../types/index.js';
export function catalogSource(track: Track): string {
  if (track.trackUrl?.includes('deezer.com') || track.source === 'deezer') return 'Deezer';
  if (track.id.startsWith('youtube:') || track.source === 'youtube') return 'YouTube';
  return { soundcloud: 'SoundCloud', spotify: 'Spotify', licensed: 'Каталог', local: 'Ваш файл' }[track.source] || track.source;
}
export function audioSourceLabel(source?: string): string {
  return ({ youtube: 'YouTube', soundcloud: 'SoundCloud', spotify:'Spotify', deezer:'Deezer', cache: 'Локальный кэш', unknown: 'Не определён' } as Record<string,string>)[source || ''] || 'Определяется при запуске';
}
