import type { Track } from '../types/index.js';
import { apiClient } from '../api/apiClient.js';
import { scopedStorageKey } from '../telegram/runtime.js';

/* «Резонанс» settings: the language of the music (RU / EN / JA, or none), a subgenre and a mood
   inside that language — remembered separately for each language — and one of two selection modes.
   Persisted per account; the session feedback (skips, likes) steers the next batches. */
export type MusicLang = 'ru' | 'en' | 'ja';
export type WaveMode = 'niche' | 'collection';
/** Where the picks come from: «Моя волна» of a connected Yandex account, or Осколок's own builder. */
export type WaveEngine = 'yandex' | 'oskolok';
/** What the listener is doing (Yandex «Моя волна» agents): reshapes the stream around their taste. */
export type WaveActivity = 'wake' | 'work' | 'workout' | 'road' | 'sleep';
export const WAVE_ACTIVITIES: Array<{ id: WaveActivity; ru: string; en: string }> = [
  { id: 'wake', ru: 'Просыпаюсь', en: 'Waking up' },
  { id: 'work', ru: 'Работаю', en: 'Working' },
  { id: 'workout', ru: 'Тренируюсь', en: 'Workout' },
  { id: 'road', ru: 'В дороге', en: 'On the road' },
  { id: 'sleep', ru: 'Засыпаю', en: 'Falling asleep' },
];
export interface LangPrefs { subgenre: string | null; mood: string | null }
export interface WaveSettings { language: MusicLang | 'all'; mode: WaveMode | null; perLanguage: Record<MusicLang, LangPrefs>; engine: WaveEngine; activity: WaveActivity | null }
/** Older call sites (collections, shelves) may still pass legacy fields; they are mapped on read. */
export type WaveOptionInput = Partial<Omit<WaveSettings, 'perLanguage'>> & { perLanguage?: Partial<Record<MusicLang, Partial<LangPrefs>>>; character?: string; scenario?: string; mood?: string };
export interface WaveChoice { id: string; ru: string; en: string; anime?: boolean }
export interface WaveCatalog { ru: { subgenres: WaveChoice[]; moods: WaveChoice[] }; en: { subgenres: WaveChoice[]; moods: WaveChoice[] }; ja: { subgenres: WaveChoice[]; moods: WaveChoice[] } }

export const MUSIC_LANGS: Array<{ id: MusicLang; code: string; ru: string; en: string }> = [
  { id: 'ru', code: 'RU', ru: 'Русский', en: 'Russian' },
  { id: 'en', code: 'EN', ru: 'Английский', en: 'English' },
  { id: 'ja', code: 'JA', ru: 'Японский', en: 'Japanese' },
];
export const WAVE_MODES: Array<{ id: WaveMode; ru: string; en: string; hint: [string, string] }> = [
  { id: 'niche', ru: 'Что-то нишевое', en: 'Something niche', hint: ['Менее известные артисты и записи в рамках выбранного', 'Lesser-known artists and recordings within your filters'] },
  { id: 'collection', ru: 'Из коллекции', en: 'From your collection', hint: ['Только ваши лайки и плейлисты', 'Only your likes and playlists'] },
];

const emptyPrefs = (): Record<MusicLang, LangPrefs> => ({ ru: { subgenre: null, mood: null }, en: { subgenre: null, mood: null }, ja: { subgenre: null, mood: null } });
export const DEFAULT_WAVE_SETTINGS: WaveSettings = { language: 'all', mode: null, perLanguage: emptyPrefs(), engine: 'yandex', activity: null };
const LANGS = new Set<string>(['ru', 'en', 'ja']);
// Earlier versions: «Любимое» was the collection, «Незнакомое» the discovery mode; «Знакомое» is the default now.
const LEGACY_MODES: Record<string, WaveMode | null> = { favorite: 'collection', discovery: 'niche', discover: 'niche', familiar: null, popular: null };
const id = (value: unknown) => typeof value === 'string' && /^[a-z-]{2,24}$/.test(value) ? value : null;

/** Accepts the current shape and every saved legacy shape; unknown ids become «без ограничения». */
export function normalizeWaveSettings(input?: WaveOptionInput | null, base: WaveSettings = DEFAULT_WAVE_SETTINGS): WaveSettings {
  const perLanguage = emptyPrefs();
  for (const lang of ['ru', 'en', 'ja'] as MusicLang[]) {
    const from = input?.perLanguage?.[lang] ?? base.perLanguage[lang];
    perLanguage[lang] = { subgenre: id(from?.subgenre), mood: id(from?.mood) };
  }
  const language = input?.language && LANGS.has(input.language) ? input.language as MusicLang : input?.language === 'all' ? 'all' : input && 'language' in input ? 'all' : base.language;
  const mode = input?.mode === 'niche' || input?.mode === 'collection' ? input.mode
    : input?.mode === null ? null
    : input?.character && input.character in LEGACY_MODES ? LEGACY_MODES[input.character]
    : base.mode;
  const engine = input?.engine === 'oskolok' || input?.engine === 'yandex' ? input.engine : base.engine ?? 'yandex';
  const activity = input && 'activity' in input ? (WAVE_ACTIVITIES.some(a => a.id === input.activity) ? input.activity as WaveActivity : null) : base.activity ?? null;
  return { language, mode, perLanguage, engine, activity };
}

/** Drop ids the server no longer offers for that language (catalogue changes, an old saved value). */
export function validateAgainst(settings: WaveSettings, catalog: WaveCatalog | null): WaveSettings {
  if (!catalog) return settings;
  const perLanguage = emptyPrefs();
  for (const lang of ['ru', 'en', 'ja'] as MusicLang[]) {
    const prefs = settings.perLanguage[lang];
    perLanguage[lang] = {
      subgenre: catalog[lang].subgenres.some(s => s.id === prefs.subgenre) ? prefs.subgenre : null,
      mood: catalog[lang].moods.some(m => m.id === prefs.mood) ? prefs.mood : null,
    };
  }
  return { ...settings, perLanguage };
}

/** What the server needs for one batch: the chosen language's own subgenre and mood only. */
export function waveRequest(settings: WaveSettings) {
  const prefs = settings.language === 'all' ? { subgenre: null, mood: null } : settings.perLanguage[settings.language];
  return { language: settings.language, subgenre: prefs.subgenre, mood: prefs.mood, mode: settings.mode, engine: settings.engine, activity: settings.activity };
}

const SETTINGS_KEY = 'wave_settings_v3', LEGACY_KEY = 'wave_settings_v2', SKIPS_KEY = 'wave_skips_v1', CATALOG_KEY = 'wave_catalog_v1';
const readJson = <T,>(key: string, fallback: T): T => {
  try { const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(scopedStorageKey(key)) : null; return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const writeJson = (key: string, value: unknown) => { try { localStorage.setItem(scopedStorageKey(key), JSON.stringify(value)); } catch { /* quota / private mode */ } };

export function loadWaveSettings(): WaveSettings {
  const current = readJson<WaveOptionInput | null>(SETTINGS_KEY, null);
  if (current) return normalizeWaveSettings(current);
  // One-time migration from the scenario / character settings.
  const legacy = readJson<WaveOptionInput | null>(LEGACY_KEY, null);
  return normalizeWaveSettings(legacy ? { character: legacy.character } : null);
}
export function saveWaveSettings(settings: WaveSettings) { writeJson(SETTINGS_KEY, settings); }

/** Settings catalogue (subgenres and moods per language), cached for the next launch. */
export function cachedWaveCatalog(): WaveCatalog | null { return readJson<WaveCatalog | null>(CATALOG_KEY, null); }
export async function fetchWaveCatalog(): Promise<WaveCatalog> {
  const catalog = await apiClient.request<WaveCatalog>('/recommendations/wave/options');
  writeJson(CATALOG_KEY, catalog);
  return catalog;
}

export interface WaveSignal { id: string; artist: string; title?: string; reason?: string }
type StoredSkip = WaveSignal & { at: number };
const SKIP_TTL = 30 * 24 * 60 * 60_000;
const signalOf = (track: Track): WaveSignal => ({ id: track.id, artist: track.artist.name, title: track.title, reason: track.recommendationReason });

export function loadWaveSkips(): WaveSignal[] {
  const now = Date.now();
  return readJson<StoredSkip[]>(SKIPS_KEY, []).filter(s => s && s.id && s.artist && now - s.at < SKIP_TTL).map(({ at: _at, ...signal }) => signal);
}
export function recordWaveSkip(track: Track) {
  const now = Date.now();
  const kept = readJson<StoredSkip[]>(SKIPS_KEY, []).filter(s => s && s.id !== track.id && now - s.at < SKIP_TTL);
  writeJson(SKIPS_KEY, [...kept, { ...signalOf(track), at: now }].slice(-120));
}
export function clearWaveSkips() { writeJson(SKIPS_KEY, []); }

/* Running session: what was played, liked and how far the refills went. Bounded: long sessions keep memory flat. */
export const waveSession = {
  batch: 0,
  played: [] as string[],
  recentArtists: [] as string[],
  liked: [] as WaveSignal[],
  /** Wave tracks played to the end (Yandex: trackFinished) — a softer «more like this». */
  finished: [] as WaveSignal[],
  skipStreak: 0,
  /** Ids the wave itself queued — only these may be swapped out by a refresh. */
  issued: new Set<string>(),
  /** Ids picked by Yandex «Моя волна»: their plays, skips and likes are reported back to it. */
  fromYandex: new Set<string>(),
  reset() { this.batch = 0; this.played = []; this.recentArtists = []; this.liked = []; this.finished = []; this.skipStreak = 0; this.issued = new Set(); this.fromYandex = new Set(); },
  notePlayed(track: Track) {
    this.played = [...this.played.filter(x => x !== track.id), track.id].slice(-300);
    this.recentArtists = [...this.recentArtists.filter(a => a !== track.artist.name), track.artist.name].slice(-12);
  },
  noteLiked(track: Track) { this.liked = [...this.liked.filter(s => s.id !== track.id), signalOf(track)].slice(-40); },
  noteFinished(track: Track) { this.finished = [...this.finished.filter(s => s.id !== track.id), signalOf(track)].slice(-40); },
  noteIssued(tracks: Track[]) { tracks.forEach(t => this.issued.add(t.id)); if (this.issued.size > 600) this.issued = new Set([...this.issued].slice(-400)); },
};

export type WaveEmptyReason = 'empty-collection' | 'no-match' | 'unavailable';
export interface WaveBatch { tracks: Track[]; status: 'ok' | 'empty'; reason?: WaveEmptyReason; repeating?: boolean; moodUnverified?: boolean; source?: 'yandex' | 'oskolok'; yandexConnected?: boolean; blend?: WaveBlend }
/** «Волна на двоих»: the friend whose taste is mixed in. */
export interface WaveBlend { publicId: string; name: string }
/** What the last answer was built from, for the settings screen. */
export const waveSourceState = { source: null as WaveBatch['source'] | null, yandexConnected: false };

export async function fetchWaveBatch(settings: WaveSettings, limit: number, excludeTrackIds: string[] = [], blendWith?: string): Promise<WaveBatch> {
  const body = {
    v: 2, ...waveRequest(settings), limit, batch: waveSession.batch++, ...(blendWith ? { blendWith } : {}),
    excludeTrackIds: [...new Set([...waveSession.played, ...excludeTrackIds])].slice(-300),
    skipped: loadWaveSkips().slice(-80),
    liked: waveSession.liked,
    finished: waveSession.finished,
    recentArtists: waveSession.recentArtists,
  };
  const batch = await apiClient.request<WaveBatch>('/recommendations/wave', { method: 'POST', body: JSON.stringify(body) });
  const result: WaveBatch = Array.isArray(batch) ? { tracks: batch as unknown as Track[], status: (batch as unknown as Track[]).length ? 'ok' : 'empty' } : batch;
  waveSession.noteIssued(result.tracks || []);
  if (result.source === 'yandex') (result.tracks || []).forEach(t => waveSession.fromYandex.add(t.id));
  if (result.source) { waveSourceState.source = result.source; waveSourceState.yandexConnected = !!result.yandexConnected; }
  return { ...result, tracks: result.tracks || [] };
}

export type WaveFeedbackEvent = 'trackStarted' | 'trackFinished' | 'skip' | 'like' | 'unlike' | 'dislike';
/** Tells Yandex what happened to a track its wave picked (fire and forget; other tracks are not reported). */
export function sendWaveFeedback(track: Track | null | undefined, event: WaveFeedbackEvent, playedSeconds?: number) {
  if (!track || !waveSession.fromYandex.has(track.id)) return;
  void apiClient.request('/recommendations/wave/feedback', { method: 'POST', body: JSON.stringify({ trackId: track.id, event, playedSeconds }) }).catch(() => {});
}

/** Continuation after a release, built from its artists (POST /recommendations/release-continuation). */
export async function fetchReleaseContinuation(seed: { artists: string[]; trackIds: string[] }, excludeTrackIds: string[]): Promise<Track[]> {
  const tracks = await apiClient.request<Track[]>('/recommendations/release-continuation', { method: 'POST', body: JSON.stringify({ ...seed, batch: waveSession.batch++, excludeTrackIds: [...new Set([...waveSession.played, ...excludeTrackIds])].slice(-300) }) });
  waveSession.noteIssued(tracks || []);
  return tracks || [];
}

/** Human text for an empty answer; the wave never pretends the music just ended. */
export function emptyWaveMessage(reason: WaveEmptyReason | undefined, t: (ru: string, en: string) => string): string {
  if (reason === 'empty-collection') return t('В коллекции пока нет треков. Лайкните музыку или выберите другой режим.', 'Your collection is empty. Like some music or pick another mode.');
  if (reason === 'no-match') return t('Под эти фильтры ничего не нашлось. Снимите поджанр или настроение.', 'Nothing matches these filters. Clear the subgenre or mood.');
  return t('Каталог сейчас не отвечает. Попробуем ещё раз чуть позже.', 'The catalogue is not answering right now. We will try again shortly.');
}

/** What a release was, for the continuation that starts after its last track ends naturally. */
export interface ReleaseSeed { releaseId: string; title?: string; artists: string[]; trackIds: string[] }
/** A queue whose tracks all come from one release (album, EP or single) is that release. */
export function releaseSeedOf(tracks: Track[]): ReleaseSeed | null {
  const id = tracks[0]?.release?.id;
  if (!id || !tracks.every(t => t.release?.id === id)) return null;
  return { releaseId: id, title: tracks[0].release?.title, artists: [...new Set(tracks.map(t => t.artist.name.split(',')[0].trim()))].slice(0, 3), trackIds: tracks.map(t => t.id) };
}
/** The continuation starts only after the last track played to its end, and never while a repeat mode loops the release. */
export const continuationAllowed = (reason: 'natural' | 'manual', repeatMode: 'off' | 'all' | 'one') => reason === 'natural' && repeatMode === 'off';

/** Autoplay (Spotify, liner): when any queue — playlist, liked, search, a single track — ends, similar music follows. */
export {queueSeedOf} from '../audio/retention.js';
const AUTOPLAY_KEY = 'oskolok-autoplay';
export function autoplayEnabled(): boolean { try { return localStorage.getItem(AUTOPLAY_KEY) !== 'off'; } catch { return true; } }
export function setAutoplayEnabled(on: boolean) { try { localStorage.setItem(AUTOPLAY_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } window.dispatchEvent(new Event('oskolok-autoplay')); }
