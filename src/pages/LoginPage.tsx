import React from 'react';
import { AudioLines } from 'lucide-react';
import { TelegramLoginFlow } from '../components/telegram/TelegramLoginFlow.js';

export function LoginPage() {
  return <main className="login-stage">
    <section className="login-card frost-panel">
      <span className="eyebrow">ОСКОЛОК · ВАША МУЗЫКА</span>
      <div className="login-orb"><AudioLines size={38}/></div>
      <h1>Музыка<br/>в твоём ритме.</h1>
      <p>Подключите Telegram, чтобы слушать, сохранять любимое и показывать текущий трек в профиле.</p>
      <TelegramLoginFlow />
    </section>
  </main>;
}
