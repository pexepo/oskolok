/* How new a recording is, without an extra request per track. Deezer numbers albums in the order it
   ingests them, and new music is ingested on release day, so the album id dates a release closely
   (calibrated on ~600 albums, 2026-10: monotonic within a few weeks). Old catalogue ingested in
   2007–2016 sits below 25 M; a remaster or compilation of an old song looks new — the price of
   asking no one. A release date from the artist's discography, when known, wins. */
import type { Track } from '../../types/index.js';

/** [first album id, year]: ids at or above the threshold were released in that year or later. */
const DEEZER_ALBUM_YEARS: Array<[number, number]> = [
  [25_000_000, 2017], [52_000_000, 2018], [85_000_000, 2019], [125_000_000, 2020], [200_000_000, 2021],
  [275_000_000, 2022], [375_000_000, 2023], [505_000_000, 2024], [690_000_000, 2025], [870_000_000, 2026],
];
/** Album ids above this are not in the sequential range the table describes. */
const DEEZER_ID_CEILING = 1_100_000_000;

export function deezerAlbumYear(albumId: number): number | undefined {
  if (!Number.isFinite(albumId) || albumId <= 0 || albumId >= DEEZER_ID_CEILING) return undefined;
  // Below the first threshold: catalogue ingested before 2017 — at least a decade old as a release.
  if (albumId < DEEZER_ALBUM_YEARS[0][0]) return 2012;
  let year = DEEZER_ALBUM_YEARS[0][1];
  for (const [from, y] of DEEZER_ALBUM_YEARS) if (albumId >= from) year = y;
  return year;
}

/** Known release dates (album id → year) learned from discographies, for the ids the table only estimates. */
const knownYears = new Map<number, number>();
export function noteReleaseYear(albumId: number, date: string) {
  const year = Number(date.slice(0, 4));
  if (albumId && year > 1900) { knownYears.set(albumId, year); if (knownYears.size > 20_000) knownYears.delete(knownYears.keys().next().value!); }
}

export function trackYear(track: Pick<Track, 'release'>): number | undefined {
  const match = /^deezer:album:(\d+)$/.exec(track.release?.id || '');
  if (!match) return undefined;
  const id = Number(match[1]);
  return knownYears.get(id) ?? deezerAlbumYear(id);
}

/** Score for a release's age: new music leads, decade-old hits fall back; unknown age is neutral. */
export function recencyScore(year: number | undefined, now = new Date().getFullYear()): number {
  if (!year) return 0;
  const age = now - year;
  return age <= 0 ? 18 : age === 1 ? 14 : age === 2 ? 8 : age <= 4 ? 2 : age <= 7 ? -6 : age <= 12 ? -14 : -22;
}
