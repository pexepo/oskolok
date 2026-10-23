import type { Artist, Release, SearchResult, Track } from '../types/index.js';

const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const compact = (text: string) => normalize(text).replace(/ /g, '');
const popularity = (artist: Artist) => Math.log10(1 + Math.max(0, artist.followersCount || 0)) * 20 + Math.max(0, Math.min(100, artist.popularity || 0)) * .3;
const best = <T,>(items: T[], score: (item: T) => number): T | undefined => items.reduce<T | undefined>((kept, item) => !kept || score(item) > score(kept) ? item : kept, undefined);

/** Audience breaks ties between equally matching names, regardless of provider order. */
export function bestSearchArtist(artists: Artist[], query: string): Artist | undefined {
  const q = normalize(query), key = compact(query);
  if (!q) return undefined;
  const exact = artists.filter(artist => compact(artist.name) === key);
  if (exact.length) return best(exact, popularity);
  const prefix = artists.filter(artist => {
    const name = normalize(artist.name);
    return q.length >= 3 && name.startsWith(q) && name.length - q.length <= 4;
  });
  return best(prefix, artist => popularity(artist) - (normalize(artist.name).length - q.length) * 10);
}

export type BestSearchResult = { type: 'artist'; artist: Artist } | { type: 'track'; track: Track } | { type: 'album'; album: Release };

/** Exact recordings and releases cannot be displaced by a popular partial artist match. */
export function selectBestSearchResult(results: Pick<SearchResult, 'artists' | 'tracks' | 'albums' | 'bestHint'>, query: string): BestSearchResult | undefined {
  const q = normalize(query);
  if (!q) return undefined;
  // Yandex Music's own pick reads intent best («пирокинезис» is the artist, not a song titled so).
  const hint = results.bestHint;
  if (hint?.type === 'artist') { const artist = results.artists.find(a => a.id === hint.id); if (artist) return { type: 'artist', artist }; }
  if (hint?.type === 'track') { const track = results.tracks.find(t => t.id === hint.id && t.access !== 'blocked' && t.access !== 'unavailable'); if (track) return { type: 'track', track }; }
  if (hint?.type === 'album') { const album = (results.albums || []).find(a => a.id === hint.id); if (album) return { type: 'album', album }; }
  const artist = bestSearchArtist(results.artists, query);
  const tracks = results.tracks.filter(track => track.access !== 'blocked' && track.access !== 'unavailable');
  const exactTracks = tracks.filter(track => [track.title, `${track.artist.name} ${track.title}`, `${track.title} ${track.artist.name}`].some(value => normalize(value) === q));
  const exactTrack = best(exactTracks, track => (track.popularity || 0) + (track.access === 'preview' ? -100 : 0));
  // An exact name leads — unless it is an almost empty account (a SoundCloud fan page named after a
  // half-typed query, an unknown namesake) while a real artist or a popular exact song answers the query.
  const credible = (a: Artist) => (a.followersCount || 0) >= 1000 || (a.popularity || 0) >= 20;
  if (artist && compact(artist.name) === compact(q)) {
    if (credible(artist) || !(exactTrack && (exactTrack.popularity || 0) >= 30)) {
      const real = !credible(artist) ? results.artists.find(a => a !== artist && credible(a) && normalize(a.name).startsWith(q)) : undefined;
      return { type: 'artist', artist: real || artist };
    }
  }
  if (exactTrack) return { type: 'track', track: exactTrack };
  const exactAlbums = (results.albums || []).filter(album => [album.title, `${album.artist?.name || ''} ${album.title}`, `${album.title} ${album.artist?.name || ''}`].some(value => normalize(value) === q));
  const album = best(exactAlbums, album => (album.popularity || 0) + (album.artist ? popularity(album.artist) : 0));
  if (album) return { type: 'album', album };
  if (artist) return { type: 'artist', artist };
  // A slip in the name («kai angle»): the server still put the artist first, and the top songs are theirs.
  const top = results.artists[0];
  if (top && tracks.slice(0, 5).filter(track => normalize(track.artist.name).includes(normalize(top.name))).length >= 3) return { type: 'artist', artist: top };
  const track = tracks[0];
  if (track) return { type: 'track', track };
  if (results.albums?.[0]) return { type: 'album', album: results.albums[0] };
  return undefined;
}
