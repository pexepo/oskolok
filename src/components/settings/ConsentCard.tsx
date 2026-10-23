import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useConsentStore } from '../../telemetry/consent.js';
import { useTranslation } from '../../stores/useLanguageStore.js';

/** Asked once, until the listener decides; the same choices live in Settings → «Персонализация и данные». */
export function ConsentCard() {
  const t = useTranslation();
  const { loaded, decided, update } = useConsentStore();
  const [busy, setBusy] = React.useState(false);
  if (!loaded || decided) return null;
  const choose = async (personalization: boolean, training: boolean) => { if (busy) return; setBusy(true); try { await update({ personalization, training }); } finally { setBusy(false); } };
  return <section className="consent-card crystal-slab" aria-labelledby="consent-title">
    <ShieldCheck size={22} aria-hidden="true" />
    <div>
      <h3 id="consent-title">{t('Подстраивать рекомендации под то, как вы слушаете?', 'Tune recommendations to how you listen?')}</h3>
      <p>{t('Осколок будет учитывать дослушивания, пропуски, повторы и лайки. Поисковые запросы, контакты и данные устройства не собираются; события хранятся 180 дней. Отказ ничего не ограничивает — изменить можно в настройках.', 'Oskolok will count full listens, skips, repeats and likes. No search queries, contacts or device data; events are kept 180 days. Saying no limits nothing — change it any time in Settings.')}</p>
      <div className="consent-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={() => void choose(true, false)}>{t('Да, для моих рекомендаций', 'Yes, for my recommendations')}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void choose(true, true)}>{t('Да, и помогать улучшать для всех', 'Yes, and help improve them for everyone')}</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => void choose(false, false)}>{t('Нет', 'No')}</button>
      </div>
    </div>
  </section>;
}
