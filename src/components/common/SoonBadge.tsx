import {useTranslation} from '../../stores/useLanguageStore.js';

/** «Скоро»: marks a section that is closed for the beta. */
export function SoonBadge(){
 const t=useTranslation();
 return <span className="soon-badge">{t('скоро','soon')}</span>;
}
