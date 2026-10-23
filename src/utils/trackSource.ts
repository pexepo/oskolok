import type { Track } from '../types/index.js';
import { tr } from '../stores/useLanguageStore.js';
/** Stable platform id of the catalog a track came from (for logos). */
export function catalogSourceId(track: Track): string {
  if (track.trackUrl?.includes('deezer.com') || track.source === 'deezer') return 'deezer';
  if (track.id.startsWith('youtube:') || track.source === 'youtube') return 'youtube';
  return track.source;
}
export function catalogSource(track: Track): string {
  if (track.trackUrl?.includes('deezer.com') || track.source === 'deezer') return 'Deezer';
  if (track.id.startsWith('youtube:') || track.source === 'youtube') return 'YouTube';
  return ({ soundcloud: 'SoundCloud', spotify: 'Spotify', licensed: tr('Каталог', 'Catalog'), local: tr('Ваш файл', 'Your file'), unreleased: tr('Анрелиз', 'Unreleased') } as Record<string,string>)[track.source] || track.source;
}
export function audioSourceLabel(source?: string): string {
  return ({ youtube: 'YouTube', soundcloud: 'SoundCloud', spotify:'Spotify', deezer:'Deezer', unreleased:tr('Анрелиз', 'Unreleased'), cache: tr('Локальный кэш', 'Local cache'), offline: tr('Скачано на устройство', 'Downloaded to this device'), unknown: tr('Не определён', 'Unknown') } as Record<string,string>)[source || ''] || tr('Определяется при запуске', 'Resolved on play');
}
