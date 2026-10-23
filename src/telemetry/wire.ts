/* Connects the player to listening sessions and the library/playlist stores to their events. Imported once at start. */
import { audioManager } from '../audio/AudioManager.js';
import { queueManager } from '../audio/QueueManager.js';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { libraryActions } from './bus.js';
import { useConsentStore } from './consent.js';
import { ListeningSession } from './listening.js';
import { trackEvent } from './events.js';

let session: ListeningSession | null = null;
const speed = () => audioManager.getEffects().speed;
export const currentListeningSessionId = () => session?.id || 'library';

audioManager.subscribe({
  onTrackChange: track => {
    if (session && session.track.id !== track?.id) {
      const fromNext = Date.now() - audioManager.advanceAt < 4000 && audioManager.lastAdvance === 'manual';
      session.finish(!track ? 'stop' : fromNext ? 'manual-skip' : 'auto');
      session = null;
    }
    if (track && !session && useConsentStore.getState().personalization) session = new ListeningSession(track, usePlayerStore.getState().playContext, speed);
  },
  onAudioStarted: () => session?.audioStarted(),
  onStateChange: (playing, buffering) => session?.state(playing, buffering),
  onTimeUpdate: current => session?.time(current),
  onSeek: position => session?.seek(position),
  onEnded: () => session?.endedNaturally(queueManager.getState().repeatMode === 'one'),
  onError: type => { if (type === 'SOURCE_UNAVAILABLE') session?.fail('error'); },
});
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { session?.finish('interrupted'); session = null; });

libraryActions.on((action, track, data, context) => trackEvent(action, track, currentListeningSessionId(), context ?? usePlayerStore.getState().playContext, data || {}));
