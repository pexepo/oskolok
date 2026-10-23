import {randomBytes} from 'node:crypto';
import type {Track} from '../types/index.js';
import {Msg,sendText,editText,type Markup} from './telegramBotApi.js';
import {likedRepository} from '../repositories/likedRepository.js';
import {compactTrack,currentTrack,miniAppUrl,playTracksInTelegram,type SessionTrack} from './telegramPlayback.js';

/**
 * Interactive pieces of the bot beyond playback controls: the persistent quick menu, «Моя волна»,
 * «Похожие», liked tracks and the lyrics of the current song. Lists are kept for 30 minutes under a
 * short token so their buttons stay valid while the user scrolls.
 */

// Persistent reply keyboard: the four things people do most, one tap away.
export const QUICK = { now: '🎧 Сейчас играет', wave: '🌊 Моя волна', liked: '❤️ Любимое', search: '🔍 Поиск' } as const;
export const quickKeyboard = { keyboard: [[{ text: QUICK.now }, { text: QUICK.wave }], [{ text: QUICK.liked }, { text: QUICK.search }]], resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Название трека или артиста' };

type List = { tracks: SessionTrack[]; at: number; title: string; kind: 'wave' | 'similar' | 'liked' };
const lists = new Map<string, List>();
function keep(list: Omit<List, 'at'>) {
  for (const [k, v] of lists) if (Date.now() - v.at > 1800_000) lists.delete(k);
  const token = randomBytes(4).toString('hex');
  lists.set(token, { ...list, at: Date.now() });
  return token;
}
export const getList = (token: string) => lists.get(token);

const line = (t: SessionTrack) => `${t.artist.name} — ${t.title}`;
function listMessage(token: string, list: List, page = 0): { msg: Msg; markup: Markup } {
  const per = 6, start = page * per, items = list.tracks.slice(start, start + per);
  const icon = list.kind === 'liked' ? 'heart' : list.kind === 'wave' ? 'music' : 'refresh';
  const msg = new Msg().e(icon).t(' ').b(list.title).t(` · ${list.tracks.length}`).n(2).i('Нажмите на трек — он придёт сюда и заиграет в фоне, следующие встанут в очередь.');
  const rows: Array<Array<Record<string, unknown>>> = items.map((t, i) => [{ text: `▸ ${line(t)}`.slice(0, 62), callback_data: `l:${token}:${start + i}` }]);
  rows.unshift([{ text: '▶️ Слушать всё', callback_data: `l:${token}:0` }, ...(list.kind === 'wave' ? [{ text: '🔄 Другая волна', callback_data: 'wave:new' }] : [])]);
  const nav = [...(page > 0 ? [{ text: '← Назад', callback_data: `lp:${token}:${page - 1}` }] : []), ...(start + per < list.tracks.length ? [{ text: 'Дальше →', callback_data: `lp:${token}:${page + 1}` }] : [])];
  if (nav.length) rows.push(nav);
  return { msg, markup: { inline_keyboard: rows } };
}

async function showList(chat: string, list: Omit<List, 'at'>, editId?: number) {
  if (!list.tracks.length) {
    const empty = list.kind === 'liked' ? new Msg().e('heart').t(' В любимых пока пусто. Нажмите ❤️ под треком — и он появится здесь.') : new Msg().e('info').t(' Не удалось собрать подборку. Послушайте пару треков — волна подстроится.');
    await sendText(chat, empty); return;
  }
  const token = keep(list);
  const { msg, markup } = listMessage(token, lists.get(token)!);
  if (editId) try { await editText(chat, editId, msg, markup); return; } catch { /* fall through */ }
  await sendText(chat, msg, markup);
}

export async function pageList(chat: string, messageId: number | undefined, token: string, page: number) {
  const list = lists.get(token);
  if (!list) return false;
  const { msg, markup } = listMessage(token, list, page);
  if (messageId) try { await editText(chat, messageId, msg, markup); return true; } catch { /* resend */ }
  await sendText(chat, msg, markup);
  return true;
}

export async function playFromList(userId: string, token: string, index: number) {
  const list = lists.get(token);
  if (!list) return null;
  const i = Math.max(0, Math.min(index, list.tracks.length - 1));
  await playTracksInTelegram(userId, list.tracks, i);
  return list.tracks[i];
}

const compactAll = (tracks: Track[]) => tracks.filter(t => t.access === 'playable').map(t => compactTrack(t)).filter(Boolean) as SessionTrack[];

export async function sendWave(chat: string, userId: string, editId?: number) {
  const { recommendationService } = await import('./RecommendationService.js');
  const tracks = await recommendationService.getRecommendations({ userId, limit: 18 }).catch(() => []);
  await showList(chat, { tracks: compactAll(tracks), title: 'Моя волна', kind: 'wave' }, editId);
}

export async function sendSimilar(chat: string, userId: string) {
  const now = await currentTrack(userId);
  if (!now) { await sendText(chat, new Msg().e('music').t(' Сейчас ничего не играет — похожие подбираются к текущему треку.')); return; }
  const { recommendationService } = await import('./RecommendationService.js');
  const seed = { id: now.track.id, artist: now.track.artist.name, title: now.track.title, reason: 'seed' };
  const tracks = await recommendationService.getRecommendations({ userId, limit: 18, liked: [seed, seed, seed], excludeTrackIds: [now.track.id] }).catch(() => []);
  await showList(chat, { tracks: compactAll(tracks), title: `Похоже на «${now.track.title}»`.slice(0, 60), kind: 'similar' });
}

export async function sendLiked(chat: string, userId: string) {
  const tracks = await likedRepository.getLikedTracks(userId).catch(() => []);
  await showList(chat, { tracks: compactAll(tracks).slice(0, 120), title: 'Любимое', kind: 'liked' });
}

/** First lines of the current song, with a button to the full synced lyrics in the Mini App. */
export async function sendLyrics(chat: string, userId: string) {
  const now = await currentTrack(userId);
  if (!now) { await sendText(chat, new Msg().e('music').t(' Сейчас ничего не играет. Включите трек — и я покажу его текст.')); return; }
  const { lyricsService } = await import('./LyricsService.js');
  const data = await lyricsService.getLyrics(now.track.id, now.track.title, now.track.artist.name, now.track.duration).catch(() => null);
  const lines = (data?.syncedLyrics?.map(l => l.text) || data?.plainLyrics?.split('\n') || []).map(l => l.trim()).filter(Boolean);
  const url = await miniAppUrl();
  const markup: Markup = url ? { inline_keyboard: [[{ text: '📝 Весь текст в Осколке', web_app: { url } }]] } : undefined;
  if (!lines.length) { await sendText(chat, new Msg().e('info').t(' Текста для ').b(line(now.track)).t(' пока нет.'), markup); return; }
  const shown = lines.slice(0, 16);
  const m = new Msg().e('chat').t(' ').b(line(now.track)).n(2).t(shown.join('\n'));
  if (lines.length > shown.length) m.n(2).i(`…ещё ${lines.length - shown.length} строк`);
  await sendText(chat, m, markup);
}
