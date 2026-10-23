import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Globe, Laptop, Menu, Monitor, Smartphone, Terminal, X } from 'lucide-react';
import logo from '../../assets/logo.png';
import type { Platform } from '../api.js';

export const SITE_URL = 'https://oskolok.lol';
export const CHANNEL_URL = 'https://t.me/oskolokch';
export const BOT_URL = 'https://t.me/oskolokplayerbot';

export const PlatformIcon = ({ platform, size = 20 }: { platform: Platform; size?: number }) => {
  const Icon = { windows: Monitor, macos: Laptop, linux: Terminal, android: Smartphone, ios: Smartphone, web: Globe }[platform];
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
};

/** Sets title, description and canonical URL for client-side navigation (static HTML carries the same tags). */
export function usePageMeta(title: string, description: string, path: string, noindex = false) {
  React.useEffect(() => {
    document.title = title;
    const set = (selector: string, attr: string, value: string, create: () => HTMLElement) => {
      let el = document.head.querySelector<HTMLElement>(selector);
      if (!el) { el = create(); document.head.appendChild(el); }
      el.setAttribute(attr, value);
    };
    const meta = (key: string, value: string, prop = false) => set(`meta[${prop ? 'property' : 'name'}="${key}"]`, 'content', value, () => { const m = document.createElement('meta'); m.setAttribute(prop ? 'property' : 'name', key); return m; });
    meta('description', description);
    meta('og:title', title, true); meta('og:description', description, true); meta('og:url', SITE_URL + path, true);
    meta('robots', noindex ? 'noindex, nofollow' : 'index, follow');
    set('link[rel="canonical"]', 'href', SITE_URL + path, () => { const l = document.createElement('link'); l.rel = 'canonical'; return l; });
  }, [title, description, path, noindex]);
}

/** Adds .is-in once an element scrolls into view. One shared observer; no scroll listeners. */
let observer: IntersectionObserver | null = null;
export function useReveal<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.classList.add('is-in'); return; }
    observer ??= new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); observer!.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    observer.observe(el);
    return () => observer?.unobserve(el);
  }, []);
  return ref;
}
export function Reveal({ as = 'div', delay = 0, className = '', children, ...rest }: { as?: keyof JSX.IntrinsicElements; delay?: number; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  const ref = useReveal<HTMLElement>();
  return React.createElement(as, { ref, className: `s-reveal ${className}`.trim(), style: { '--d': delay } as React.CSSProperties, ...rest }, children);
}

const SHARD_FILES = ['shard_tl', 'shard_mini_tr', 'shard_mini_ml', 'shard_br', 'shard_mini_bc', 'shard_mini_top', 'shard_mini_mr', 'shard_mini_fl'];
/** Decorative glass fragments from the player's own shard masks. */
export function Shards({ items }: { items: Array<{ i: number; style: React.CSSProperties }> }) {
  return <div aria-hidden="true">{items.map(({ i, style }, n) => <span key={n} className="s-shard" style={{ '--shard': `url(/shards/${SHARD_FILES[i % SHARD_FILES.length]}.png)`, '--delay': `${-n * 2.3}s`, '--dur': `${12 + (n % 4) * 2}s`, ...style } as React.CSSProperties} />)}</div>;
}

const NAV: Array<[string, string]> = [['/#about', 'О проекте'], ['/#features', 'Возможности'], ['/beta', 'Бета-тест'], ['/download', 'Загрузки']];

export function SiteHeader() {
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const sentinel = React.useRef<HTMLDivElement>(null);
  const location = useLocation();
  React.useEffect(() => setOpen(false), [location.pathname, location.hash]);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', close); document.body.style.overflow = ''; };
  }, [open]);
  return <>
    <div ref={sentinel} style={{ position: 'absolute', top: 0, height: 8, width: 1 }} aria-hidden="true" />
    <header className={`s-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="s-wrap s-header-row">
        <Link to="/" className="s-brand" aria-label="Осколок, на главную"><img src={logo} alt="" width="34" height="34" />Осколок</Link>
        <nav className="s-nav" aria-label="Разделы сайта">
          {NAV.map(([to, label]) => to.includes('#') ? <a key={to} href={to}>{label}</a> : <NavLink key={to} to={to}>{label}</NavLink>)}
        </nav>
        <a className="s-btn s-btn-primary s-btn-sm s-header-cta" href="/app">Открыть плеер</a>
        <button className="s-menu-btn" type="button" aria-label="Открыть меню" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={20} /></button>
      </div>
    </header>
    {open && <div className="s-sheet" role="dialog" aria-modal="true" aria-label="Меню">
      <div className="s-sheet-top">
        <Link to="/" className="s-brand"><img src={logo} alt="" width="34" height="34" />Осколок</Link>
        <button className="s-menu-btn" style={{ display: 'grid' }} type="button" aria-label="Закрыть меню" onClick={() => setOpen(false)} autoFocus><X size={20} /></button>
      </div>
      <nav aria-label="Разделы сайта">
        {[...NAV, ['/privacy', 'Конфиденциальность'] as [string, string]].map(([to, label], i) => <a key={to} href={to} style={{ '--i': i } as React.CSSProperties} onClick={() => setOpen(false)}>{label}</a>)}
      </nav>
      <a className="s-btn s-btn-primary s-btn-lg s-btn-block" href="/app">Открыть веб-плеер</a>
    </div>}
  </>;
}

export function SiteFooter() {
  return <footer className="s-footer">
    <div className="s-wrap">
      <div className="s-footer-grid">
        <div>
          <Link to="/" className="s-brand"><img src={logo} alt="" width="34" height="34" />Осколок</Link>
          <p>Кроссплатформенный музыкальный плеер для тех, кто любит Telegram и очень любит музыку. Проект в бета-тесте и делается на энтузиазме.</p>
        </div>
        <div><h4>Плеер</h4><ul><li><a href="/app">Веб-версия</a></li><li><Link to="/download">Загрузки</Link></li><li><Link to="/download/ios">Установка на iPhone</Link></li><li><Link to="/download/android">Android</Link></li><li><Link to="/download/desktop">Windows и macOS</Link></li></ul></div>
        <div><h4>Бета</h4><ul><li><Link to="/beta">Подать заявку</Link></li><li><Link to="/beta/status">Статус заявки</Link></li><li><a href={BOT_URL} target="_blank" rel="noopener noreferrer">Бот @oskolokplayerbot</a></li></ul></div>
        <div><h4>Проект</h4><ul><li><a href={CHANNEL_URL} target="_blank" rel="noopener noreferrer">Telegram-канал</a></li><li><a href="https://boosty.to/oskolokplayer/donate" target="_blank" rel="noopener noreferrer">Поддержать</a></li><li><Link to="/privacy">Конфиденциальность</Link></li></ul></div>
      </div>
      <div className="s-footer-bottom"><span>© {new Date().getFullYear()} Осколок</span><span>Музыка воспроизводится из открытых источников. Права на записи принадлежат их владельцам.</span></div>
    </div>
  </footer>;
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="site">
    <a className="site-skip" href="#main">К содержанию</a>
    <div className="site-sky" aria-hidden="true" />
    <SiteHeader />
    <main id="main" tabIndex={-1}>{children}</main>
    <SiteFooter />
  </div>;
}
