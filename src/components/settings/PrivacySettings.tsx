import React from 'react';
import { Check } from 'lucide-react';
import { useConsentStore } from '../../telemetry/consent.js';
import { useTranslation } from '../../stores/useLanguageStore.js';
import { useToastStore } from '../../stores/useToastStore.js';

/** «Персонализация и данные»: two independent permissions, what they cover, how long, and a reset. */
export function PrivacySettings() {
  const t = useTranslation();
  const { loaded, personalization, training, retentionDays, update, resetData, load } = useConsentStore();
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (!loaded) void load(); }, [loaded, load]);
  const change = async (next: { personalization: boolean; training: boolean }) => {
    if (busy) return;
    setBusy(true);
    try { await update(next); } catch (e) { useToastStore.getState().addToast((e as Error).message, 'warning'); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (busy) return;
    setBusy(true);
    try { const n = await resetData(); useToastStore.getState().addToast(t(`Удалено событий: ${n}`, `Events deleted: ${n}`), 'success'); }
    catch (e) { useToastStore.getState().addToast((e as Error).message, 'warning'); } finally { setBusy(false); }
  };
  return <section className="set-group">
    <h4>{t('Персонализация и данные', 'Personalisation and data')}</h4>
    <label className={`set-row set-check ${personalization ? 'is-on' : ''}`} aria-busy={busy}>
      <span>{t('Учитывать, как я слушаю', 'Learn from how I listen')}<small>{t('Дослушивания, пропуски, повторы, лайки и плейлисты влияют на ваш Резонанс и миксы дня. Без этого рекомендации строятся только по лайкам, плейлистам и истории.', 'Full listens, skips, repeats, likes and playlists shape your Resonance and daily mixes. Without it, recommendations use only likes, playlists and history.')}</small></span>
      <input type="checkbox" checked={personalization} disabled={busy || !loaded} onChange={e => void change({ personalization: e.target.checked, training: e.target.checked && training })} />
      <i className="set-check-box" aria-hidden="true"><Check size={14} strokeWidth={3} /></i>
    </label>
    <label className={`set-row set-check ${training ? 'is-on' : ''}`} aria-busy={busy}>
      <span>{t('Помогать улучшать рекомендации для всех', 'Help improve recommendations for everyone')}<small>{t('Ваши события без имени и Telegram-данных участвуют в проверке и настройке алгоритма. Отдельное согласие, можно отозвать.', 'Your events, without your name or Telegram data, are used to evaluate and tune the algorithm. Separate consent, revocable.')}</small></span>
      <input type="checkbox" checked={training} disabled={busy || !loaded || !personalization} onChange={e => void change({ personalization, training: e.target.checked })} />
      <i className="set-check-box" aria-hidden="true"><Check size={14} strokeWidth={3} /></i>
    </label>
    <div className="set-row set-row--stack">
      <span><small>{t(`Собираются только действия с треками в Осколке: что и откуда включено, сколько прослушано, скорость, лайки и плейлисты. Поисковые запросы, контакты, геолокация и данные устройства не собираются. События хранятся ${retentionDays} дней. Отзыв согласия удаляет их; уже настроенные общие веса алгоритма не «забывают» прошлое мгновенно — это агрегаты без ваших данных.`, `Only actions with tracks in Oskolok are collected: what played and from where, how much, speed, likes and playlists. No search queries, contacts, location or device data. Events are kept ${retentionDays} days. Revoking consent deletes them; already tuned shared algorithm weights do not «forget» instantly — they are aggregates without your data.`)}</small></span>
      <button type="button" className="sg-btn" disabled={busy || !loaded} onClick={() => void reset()}>{t('Удалить мои события', 'Delete my events')}</button>
    </div>
  </section>;
}
