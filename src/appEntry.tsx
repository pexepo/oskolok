import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './index.css';
import './styles/crystal.css';
import './styles/starglow.css';
import './styles/lyrics.css';
import './styles/liquid-controls.css';
import './styles/profile.css';
import './styles/mobile.css';
import './styles/redesign.css';
import './styles/fixes.css';
import './styles/collection-search.css';
import { initializeTelegram } from './telegram/runtime.js';
import { initPerformance } from './utils/performance.js';
import { tr } from './stores/useLanguageStore.js';
import { registerServiceWorker } from './utils/serviceWorker.js';

/** The player (/app and native shells). Loaded on demand so the public site ships none of it. */
export function startApp(container: HTMLElement) {
  initPerformance();
  // The player is the app: remember it so an old tab that reloads on «/» returns here.
  try { localStorage.setItem('oskolok_app_seen', '1'); } catch { /* Private mode. */ }
  registerServiceWorker();
  const root = ReactDOM.createRoot(container);
  initializeTelegram().then(() => root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )).catch(error => root.render(<main style={{padding:32,fontFamily:'sans-serif'}}><h1>{tr('Осколок', 'Oskolok')}</h1><p>{error.message}</p><button onClick={() => location.reload()}>{tr('Попробовать снова', 'Try again')}</button></main>));
}
