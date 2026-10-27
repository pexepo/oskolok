import React, {useEffect, useState} from 'react';
import {AnimatePresence, motion, useReducedMotion} from 'framer-motion';
import {Send, X} from 'lucide-react';
import {useTelegramStore} from '../../telegram/runtime.js';
import {useTranslation} from '../../stores/useLanguageStore.js';

const KEY = 'oskolok-channel-invite', CHANNEL = 'https://t.me/oskolokch';
type State = {visits: number; nextAt: number; done: boolean};
const read = (): State => { try { return {visits: 0, nextAt: 0, done: false, ...JSON.parse(localStorage.getItem(KEY) || '{}')}; } catch { return {visits: 0, nextAt: 0, done: false}; } };
const write = (patch: Partial<State>) => { try { localStorage.setItem(KEY, JSON.stringify({...read(), ...patch})); } catch { /* private mode */ } };

/** Now and then (from the second visit, at most every 4 days) invites the listener to the @oskolokch news channel. */
export function ChannelInvite() {
  const user = useTelegramStore(s => s.user), t = useTranslation(), reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!user) return;
    if (!sessionStorage.getItem(KEY)) { sessionStorage.setItem(KEY, '1'); write({visits: read().visits + 1}); }
    const state = read();
    if (state.done || state.visits < 2 || Date.now() < state.nextAt) return;
    const timer = window.setTimeout(() => setVisible(true), 40_000);
    return () => window.clearTimeout(timer);
  }, [user]);
  const later = () => { write({nextAt: Date.now() + 4 * 86_400_000}); setVisible(false); };
  const never = () => { write({done: true}); setVisible(false); };
  const open = () => {
    write({done: true}); setVisible(false);
    const tg = window.Telegram?.WebApp;
    if (tg?.initData) tg.openTelegramLink(CHANNEL); else window.open(CHANNEL, '_blank', 'noopener,noreferrer');
  };
  return <AnimatePresence>
    {visible && <motion.aside className="channel-invite" role="dialog" aria-labelledby="channel-invite-title"
      initial={reduced ? {opacity: 0} : {opacity: 0, y: 24, scale: .96, filter: 'blur(6px)'}}
      animate={{opacity: 1, y: 0, scale: 1, filter: 'blur(0px)'}}
      exit={reduced ? {opacity: 0} : {opacity: 0, y: 16, scale: .97, filter: 'blur(4px)', transition: {duration: .18}}}
      transition={{type: 'spring', stiffness: 260, damping: 26}}>
      <button type="button" className="channel-invite-close" onClick={never} aria-label={t('Больше не показывать', 'Do not show again')} title={t('Больше не показывать', 'Do not show again')}><X size={15}/></button>
      <span className="channel-invite-icon" aria-hidden="true"><Send size={18}/></span>
      <div className="channel-invite-copy">
        <strong id="channel-invite-title">{t('Новости Осколка — в Telegram', 'Oskolok news on Telegram')}</strong>
        <small>{t('Обновления, планы и закулисье в @oskolokch. Подпишитесь, чтобы ничего не пропустить.', 'Updates, plans and behind the scenes at @oskolokch.')}</small>
        <span className="channel-invite-actions">
          <button type="button" className="sg-btn sg-btn--primary" onClick={open}>{t('Подписаться', 'Subscribe')}</button>
          <button type="button" className="sg-btn" onClick={later}>{t('Позже', 'Later')}</button>
        </span>
      </div>
    </motion.aside>}
  </AnimatePresence>;
}
