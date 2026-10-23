import React from 'react';
import play from '../../assets/player/play.png';
import playInk from '../../assets/player/play-ink.png';
import pause from '../../assets/player/pause.png';
import pauseInk from '../../assets/player/pause-ink.png';
import next from '../../assets/player/next.png';
import nextInk from '../../assets/player/next-ink.png';
import prev from '../../assets/player/prev.png';
import prevInk from '../../assets/player/prev-ink.png';
import like from '../../assets/player/like.png';
import likeInk from '../../assets/player/like-ink.png';
import volume from '../../assets/player/volume.png';
import volumeInk from '../../assets/player/volume-ink.png';
import report from '../../assets/player/report-shard.svg';
import reportInk from '../../assets/player/report-shard-ink.svg';
import info from '../../assets/player/info-shard.svg';
import infoInk from '../../assets/player/info-shard-ink.svg';
import add from '../../assets/player/add-shard.svg';
import addInk from '../../assets/player/add-shard-ink.svg';
import { useThemeStore } from '../../stores/useThemeStore.js';

/** Shard-style player glyphs. The originals are drawn for dark surfaces; the
 * "ink" variants are the same shapes recoloured for the light theme. */
const ICONS = {
  play: [play, playInk],
  pause: [pause, pauseInk],
  next: [next, nextInk],
  prev: [prev, prevInk],
  like: [like, likeInk],
  volume: [volume, volumeInk],
  info: [info, infoInk],
  report: [report, reportInk],
  add: [add, addInk],
} as const;

export type PlayerIconName = keyof typeof ICONS;

/** Set by surfaces that are dark in both themes (Интерференция paints the cover's colours behind white type). */
export const DarkPlayerSurface = React.createContext(false);

export function PlayerIcon({ name, size = 20, className = '' }: { name: PlayerIconName; size?: number; className?: string }) {
  const darkTheme = useThemeStore(s => s.isDark), darkSurface = React.useContext(DarkPlayerSurface);
  const isDark = darkTheme || darkSurface;
  const [onDark, onLight] = ICONS[name];
  return <img src={isDark ? onDark : onLight} width={size} height={size} alt="" aria-hidden="true" draggable={false} className={`player-icon player-icon--${name} ${className}`} />;
}
