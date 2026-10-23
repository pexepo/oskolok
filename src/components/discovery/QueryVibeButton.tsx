import React, { useState } from 'react';
import { AudioWaveform } from 'lucide-react';
import type { Track } from '../../types/index.js';
import { apiClient } from '../../api/apiClient.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useToastStore } from '../../stores/useToastStore.js';
import { useTranslation } from '../../stores/useLanguageStore.js';
import LumaSpin from '../ui/luma-spin.js';

export type QueryVibeSeed = { kind: 'track'; track: Track } | { kind: 'artist'; name: string; tracks: Track[] };

/** «Резонанс по запросу» (Yandex: «запрос в волну»): the search's best result becomes an endless stream —
 * a song starts its track radio, an artist or album starts from the artist and drifts to its neighbours. */
export function QueryVibeButton({ seed, query }: { seed: QueryVibeSeed; query: string }) {
  const t = useTranslation();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let list: Track[];
      if (seed.kind === 'track') {
        list = await apiClient.request<Track[]>('/recommendations/radio', { method: 'POST', body: JSON.stringify(seed.track) });
      } else {
        const own = seed.tracks.filter(tr => tr.artist.name.toLowerCase().split(',')[0].trim() === seed.name.toLowerCase()).slice(0, 2);
        const next = await apiClient.request<Track[]>('/recommendations/release-continuation', { method: 'POST', body: JSON.stringify({ artists: [seed.name], trackIds: own.map(tr => tr.id), batch: 0, excludeTrackIds: [] }) });
        list = [...own, ...next];
      }
      if (list.length) await usePlayerStore.getState().playCollection(list, 0);
      else useToastStore.getState().addToast(t('Не нашлось музыки для такой волны.', 'Found nothing to build this wave from.'), 'warning');
    } catch {
      useToastStore.getState().addToast(t('Не удалось запустить волну. Попробуйте ещё раз.', 'Could not start the wave. Try again.'), 'warning');
    } finally { setBusy(false); }
  };
  return <button type="button" className="search-vibe" onClick={() => void start()} disabled={busy} aria-busy={busy}>
    {busy ? <LumaSpin size="sm" label={t('Собираем волну', 'Building the wave')} /> : <AudioWaveform size={16} aria-hidden="true" />}
    <span>{t('Резонанс по запросу', 'Resonance from this search')}<small>«{query}»</small></span>
  </button>;
}

export default QueryVibeButton;
