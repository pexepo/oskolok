import {useTranslation} from '../../stores/useLanguageStore.js';
import wipArt from '../../assets/oskolok-wip.webp';
import '../../styles/wip.css';

/** «В разработке»: stands in for a section that is closed for the beta. */
export function WipPlaceholder({title,text,compact=false}:{title?:string;text?:string;compact?:boolean}){
 const t=useTranslation();
 return <section className={`wip-placeholder crystal-slab${compact?' is-compact':''}`}>
  <img src={wipArt} alt={t('Осколок в строительной каске сидит на ящике и ничего не понимает','Oskolok in a hard hat sits on a crate, completely lost')} loading="lazy" decoding="async"/>
  <div className="wip-copy">
   <span className="soon-badge">{t('в разработке','in development')}</span>
   <h2>{title||t('Здесь пока стройка','Under construction')}</h2>
   <p>{text||t('Раздел ещё собираем. Загляните чуть позже.','We are still building this section. Check back a bit later.')}</p>
  </div>
 </section>;
}
