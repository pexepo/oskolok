import React from 'react';
import { apiClient } from '../../api/apiClient.js';
import { useToastStore } from '../../stores/useToastStore.js';
import { useLanguageStore } from '../../stores/useLanguageStore.js';
import type { OwnRewards, Tier } from './Rewards.js';

/* Polls own rewards on app focus (at most every 3 min) and every 10 min; toasts fresh unlocks once, then acks them. */
const MIN_GAP = 3 * 6e4, INTERVAL = 10 * 6e4, MAX_TOASTS = 3;
const TIER: Record<Tier, [string, string]> = { bronze: ['бронза', 'bronze'], silver: ['серебро', 'silver'], gold: ['золото', 'gold'] };

export function RewardUnlockWatcher() {
  const last = React.useRef(0), busy = React.useRef(false);
  React.useEffect(() => {
    const check = async () => {
      if (busy.current || Date.now() - last.current < MIN_GAP || document.visibilityState === 'hidden') return;
      busy.current = true; last.current = Date.now();
      try {
        const data = await apiClient.request<OwnRewards>('/profile/achievements');
        if (!data.unseen?.length) return;
        const en = useLanguageStore.getState().language === 'en', add = useToastStore.getState().addToast;
        for (const u of data.unseen.slice(0, MAX_TOASTS)) {
          const title = en ? u.title.en : u.title.ru, tier = u.tier ? ` · ${TIER[u.tier][en ? 1 : 0]}` : '';
          add(u.kind === 'medal' ? (en ? `New medal: ${title}` : `Новая медаль: ${title}`) : (en ? `Achievement unlocked: ${title}${tier}` : `Достижение: ${title}${tier}`), 'success', 5000);
        }
        if (data.unseen.length > MAX_TOASTS) add(en ? `And ${data.unseen.length - MAX_TOASTS} more — see Profile → Rewards` : `И ещё ${data.unseen.length - MAX_TOASTS} — смотрите в Профиле → Награды`, 'info', 5000);
        await apiClient.request('/profile/achievements/seen', { method: 'POST', body: '{}' });
      } catch { /* rewards are a nicety: never surface polling errors */ }
      finally { busy.current = false; }
    };
    const first = setTimeout(() => void check(), 8000);
    const timer = setInterval(() => void check(), INTERVAL);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
    return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, []);
  return null;
}
