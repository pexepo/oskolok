import React from 'react';
import { HardDrive, Library } from 'lucide-react';
import type { Track } from '../../types/index.js';
import { catalogSource, catalogSourceId, audioSourceLabel } from '../../utils/trackSource.js';
import { tr } from '../../stores/useLanguageStore.js';
import { ServiceLogo } from '../discovery/MusicAccounts.js';

const LOGOS = new Set(['spotify', 'soundcloud', 'deezer', 'youtube', 'tidal']);

/** Catalog of a track as a small platform mark; the name lives in the tooltip
 * (and in the detailed variant, used by the full player). */
export function SourceBadge({ track, detailed = false }: { track: Track; detailed?: boolean }) {
  const id = catalogSourceId(track), name = catalogSource(track);
  // One hybrid catalogue: which service a release came from is no longer shown. Only the listener's own file is marked.
  if (id !== 'local') return null;
  const title = `${tr('Каталог', 'Catalog')}: ${name}. ${tr('Аудио', 'Audio')}: ${audioSourceLabel(track.audioSource)}${track.playbackDevice ? ` ${tr('на', 'on')} ${track.playbackDevice}` : ''}`;
  const mark = LOGOS.has(id) ? <ServiceLogo id={id} size={12} /> : id === 'local' ? <HardDrive size={11} /> : <Library size={11} />;
  return <span className="source-badge" title={title} aria-label={title}>
    <span className="source-mark" data-source={id} aria-hidden="true">{mark}</span>
    {detailed && <>{tr('Каталог', 'Catalog')} · {name}<span> / {tr('Аудио', 'Audio')} · {audioSourceLabel(track.audioSource)}{track.playbackDevice ? ` · ${track.playbackDevice}` : ''}</span></>}
  </span>;
}
