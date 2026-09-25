import React from 'react';
import type { Track } from '../../types/index.js';
import { catalogSource, audioSourceLabel } from '../../utils/trackSource.js';
export function SourceBadge({ track, detailed = false }: { track: Track; detailed?: boolean }) {
  return <span className="source-badge" title={`Каталог: ${catalogSource(track)}. Аудио: ${audioSourceLabel(track.audioSource)}${track.playbackDevice?` на ${track.playbackDevice}`:''}`}>
    <i data-source={catalogSource(track)} />{detailed ? 'Каталог · ' : ''}{catalogSource(track)}
    {detailed && <span> / Аудио · {audioSourceLabel(track.audioSource)}{track.playbackDevice?` · ${track.playbackDevice}`:''}</span>}
  </span>;
}
