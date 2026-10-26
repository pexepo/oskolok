import React from 'react';
import {useTelegramStore} from '../telegram/runtime.js';
import {apiClient} from '../api/apiClient.js';
import {useTranslation} from '../stores/useLanguageStore.js';
import { TelegramLoginFlow } from '../components/telegram/TelegramLoginFlow.js';
import { startDiscord } from '../discord/discordAuth.js';
import logo from '../assets/logo.png';
import mascot from '../assets/oskolok-mascot.webp';
import '../styles/login.css';

// Decorative glass shards around the card: [file, className].
const SHARDS:Array<[string,string]>=[['shard_tl','s1'],['shard_mini_tr','s2'],['shard_mini_ml','s3'],['shard_br','s4'],['shard_mini_bc','s5'],['shard_mini_top','s6'],['shard_mini_mr','s7']];

export function LoginPage() {
  const t=useTranslation();
  const denied=useTelegramStore(s=>s.access==='beta_denied');
  const base=import.meta.env.BASE_URL;
  return <main className="login-stage">
    <div className="login-sky" aria-hidden="true">
      <span className="login-glow g1"/><span className="login-glow g2"/>
      {SHARDS.map(([file,cls])=><span key={cls} className={`login-shard ${cls}`} style={{'--shard':`url(${base}shards/${file}.png)`} as React.CSSProperties}/>)}
      <span className="login-horizon"/>
    </div>

    <header className="login-top">
      <a href="/" aria-label={t('На главную','Home')}><img src={logo} alt="" className="login-logo"/></a>
      <span className="login-name">{t('Осколок','Oskolok')}</span>
      <span className="login-beta">{t('бета','beta')}</span>
    </header>

    <section className="login-card">
      <h1 className="login-wordmark" data-text={t('Осколок','Oskolok')}>{t('Осколок','Oskolok')}</h1>
      <p className="login-lead">{t('Войдите через Telegram — музыка, любимое и текущий трек в профиле.','Sign in with Telegram — your music, favourites and now playing on your profile.')}</p>
      {denied?<div role="alert" className="login-denied"><p>{t('Проект в бета-тесте, и у этого аккаунта пока нет доступа.','The project is in beta and this account has no access yet.')}</p><button className="secondary-button" onClick={()=>location.reload()}>{t('Проверить доступ','Check access')}</button><a className="secondary-button login-beta-link" href="/beta">{t('Подать заявку на бету','Apply for the beta')}</a><button className="text-button" onClick={()=>void apiClient.request('/telegram/login/logout',{method:'POST',body:'{}'}).then(()=>location.reload())}>{t('Сменить аккаунт','Switch account')}</button></div>:<><TelegramLoginFlow /><button type="button" className="secondary-button login-discord" onClick={()=>void startDiscord('login')}>{t('Войти через Discord','Sign in with Discord')}</button><small className="login-discord-note">{t('Для аккаунтов, где Discord подключён в настройках.','For accounts that connected Discord in settings.')}</small></>}
      <p className="login-site-links"><a href="/">{t('Об Осколке','About Oskolok')}</a><a href="/beta">{t('Бета-тест','Beta')}</a><a href="/download">{t('Приложения','Apps')}</a></p>
    </section>

    <figure className="login-mascot">
      <figcaption className="login-bubble">{t('Это кэкэра. Познакомитесь на релизе или в будущих бета-обновлениях.','This is Kekera. You’ll meet properly at release or in future beta updates.')}</figcaption>
      <img src={mascot} alt={t('Кэкэра, маскот Осколка, сидит на корточках','Kekera, the Oskolok mascot, crouching')} decoding="async"/>
      <span className="login-mascot-shadow" aria-hidden="true"/>
    </figure>
  </main>;
}
