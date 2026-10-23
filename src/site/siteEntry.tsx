import React from 'react';
import ReactDOM from 'react-dom/client';
import { SiteApp } from './SiteApp.js';
import './site.css';
import { registerServiceWorker } from '../utils/serviceWorker.js';

/** The public site. Ships without the player, Telegram SDK or Tailwind. */
export function startSite(container: HTMLElement) {
  document.documentElement.classList.add('site-mode');
  document.documentElement.classList.remove('dark');
  document.body.removeAttribute('class');
  // A reload of this tab stays on the site even if this browser has used the player before.
  try { sessionStorage.setItem('oskolok_site_seen', '1'); } catch { /* Private mode. */ }
  registerServiceWorker();
  ReactDOM.createRoot(container).render(<React.StrictMode><SiteApp /></React.StrictMode>);
}
