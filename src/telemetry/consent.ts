import { create } from 'zustand';
import { apiClient } from '../api/apiClient.js';

/* Two separate permissions, asked for in plain words (Settings → «Персонализация и данные»):
   personalization — your listening events shape your own recommendations;
   training — those events may also be used (pseudonymous, aggregated) to improve recommendations for everyone.
   Refusing either never limits playback or search. */
export interface ConsentState {
  loaded: boolean;
  decided: boolean;
  personalization: boolean;
  training: boolean;
  retentionDays: number;
  load: () => Promise<void>;
  update: (next: { personalization: boolean; training: boolean }) => Promise<void>;
  resetData: () => Promise<number>;
}
type ConsentAnswer = { personalization: boolean; training: boolean; decided: boolean; retentionDays: number };

const listeners = new Set<(personalization: boolean) => void>();
/** The event buffer listens here: a revoked permission empties it at once. */
export const onPersonalizationChange = (fn: (personalization: boolean) => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export const useConsentStore = create<ConsentState>((set, get) => ({
  loaded: false, decided: false, personalization: false, training: false, retentionDays: 180,
  load: async () => {
    try { const c = await apiClient.request<ConsentAnswer>('/consent'); set({ ...c, loaded: true }); listeners.forEach(fn => fn(c.personalization)); }
    catch { set({ loaded: true }); }
  },
  update: async next => {
    const c = await apiClient.request<ConsentAnswer>('/consent', { method: 'PUT', body: JSON.stringify(next) });
    const before = get().personalization;
    set({ ...c, loaded: true });
    if (before !== c.personalization) listeners.forEach(fn => fn(c.personalization));
  },
  resetData: async () => (await apiClient.request<{ deleted: number }>('/events', { method: 'DELETE' })).deleted,
}));
