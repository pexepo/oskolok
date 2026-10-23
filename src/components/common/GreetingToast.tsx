import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Moon, Sun, Sunrise, Sunset } from 'lucide-react';
import { useTelegramStore } from '../../telegram/runtime.js';
import { useTranslation } from '../../stores/useLanguageStore.js';

const SHOWN_KEY = 'oskolok_greeting_shown';

function partOfDay(hour: number) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'day';
  if (hour >= 17 && hour < 23) return 'evening';
  return 'night';
}

/** A one-per-launch greeting that drops in from the top edge. */
export function GreetingToast() {
  const user = useTelegramStore(s => s.user);
  const t = useTranslation();
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user || sessionStorage.getItem(SHOWN_KEY)) return;
    // Mark as shown only when it actually appears: StrictMode re-runs effects.
    const show = window.setTimeout(() => {
      sessionStorage.setItem(SHOWN_KEY, '1');
      setVisible(true);
    }, 650);
    return () => window.clearTimeout(show);
  }, [user]);

  useEffect(() => {
    if (!visible) return;
    const hide = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(hide);
  }, [visible]);

  if (!user) return null;
  const name = user.username ? `@${user.username}` : [user.first_name, user.last_name].filter(Boolean).join(' ');
  const period = partOfDay(new Date().getHours());
  const greeting = {
    morning: t('Доброе утро', 'Good morning'),
    day: t('Добрый день', 'Good afternoon'),
    evening: t('Добрый вечер', 'Good evening'),
    night: t('Доброй ночи', 'Good night'),
  }[period];
  const Icon = { morning: Sunrise, day: Sun, evening: Sunset, night: Moon }[period];

  return <div className="greeting-toast-anchor" aria-live="polite">
    <AnimatePresence>
      {visible && <motion.button
        type="button"
        className="greeting-toast"
        onClick={() => setVisible(false)}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: -56, scale: 0.92, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: -40, scale: 0.96, filter: 'blur(6px)' }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      >
        <span className="greeting-toast-icon"><Icon size={17} /></span>
        <span className="greeting-toast-copy"><strong>{greeting}, {name}!</strong><small>{t('Осколки ждали вас', 'Your shards missed you')}</small></span>
      </motion.button>}
    </AnimatePresence>
  </div>;
}
