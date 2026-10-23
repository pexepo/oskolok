// Static HTML per public route: the right title, description, canonical URL and Open Graph tags for
// crawlers and Telegram link previews (they do not run JavaScript). The page itself is the same SPA.
// Also stamps the service worker with the build id so a new release replaces its caches.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SITE = 'https://oskolok.lol';
export const ROUTES = [
  { path: '/', file: 'index', title: 'Осколок: музыкальный плеер с волной, текстами и Telegram', description: 'Кроссплатформенный музыкальный плеер: SoundCloud и YouTube в одном месте, Резонанс, текст по слогам, трек в профиле Telegram. Веб-версия, Windows, macOS и Android.', h1: 'Осколок', lead: 'Музыкальный плеер: SoundCloud и YouTube в одном месте, волна рекомендаций и трек в профиле Telegram.' },
  { path: '/beta', file: 'beta', title: 'Бета-тест Осколка: подать заявку', description: 'Заявка на закрытое бета-тестирование музыкального плеера Осколок. Подтверждение через Telegram-бота, решение придёт в Telegram.', h1: 'Заявка на бета-тест Осколка', lead: 'Три коротких поля и подтверждение через Telegram-бота.' },
  { path: '/beta/status', file: 'beta-status', title: 'Статус заявки на бета-тест Осколка', description: 'Статус заявки на бета-тест Осколка.', h1: 'Статус заявки', lead: 'Статус заявки на бета-тест.', noindex: true },
  { path: '/download', file: 'download', title: 'Скачать Осколок: Windows, macOS, Android, iPhone и веб', description: 'Загрузки музыкального плеера Осколок: версии, даты выпуска, контрольные суммы и инструкции по установке для каждой платформы.', h1: 'Скачать Осколок', lead: 'Windows, macOS, Android, iPhone и веб-версия.' },
  { path: '/download/ios', file: 'download-ios', title: 'Как установить Осколок на iPhone: подробный гайд', description: 'Пошаговая инструкция с картинками: веб-приложение без компьютера, Sideloadly, AltStore Classic. Ограничения и решения частых проблем.', h1: 'Осколок на iPhone', lead: 'Пошаговый гайд по установке с картинками.' },
  { path: '/download/android', file: 'download-android', title: 'Как установить Осколок на Android', description: 'Установка APK Осколка на Android 8 и новее: разрешения, Play Защита, частые проблемы.', h1: 'Осколок на Android', lead: 'Установка APK за минуту.' },
  { path: '/download/desktop', file: 'download-desktop', title: 'Как установить Осколок на Windows и macOS', description: 'Установка десктопного Осколка: SmartScreen, Gatekeeper, выбор сборки для Apple Silicon или Intel.', h1: 'Осколок на компьютере', lead: 'Windows и macOS.' },
  { path: '/privacy', file: 'privacy', title: 'Политика конфиденциальности Осколка', description: 'Какие данные собирает Осколок, зачем, сколько хранит и как их удалить.', h1: 'Политика конфиденциальности', lead: 'Какие данные мы собираем и зачем.' },
];
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderRoute(template, r) {
  const url = SITE + (r.path === '/' ? '/' : r.path);
  let html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(r.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(r.description)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta name="robots" content=")[^"]*(")/, `$1${r.noindex ? 'noindex, nofollow' : 'index, follow'}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(r.title)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(r.description)}$2`)
    .replace(/<h1([^>]*)>[^<]*<\/h1>/, `<h1$1>${esc(r.h1)}</h1>`)
    .replace(/(<h1[^>]*>[^<]*<\/h1>\s*<p[^>]*>)[^<]*(<\/p>)/, `$1${esc(r.lead)}$2`);
  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const template = await readFile(path.join(dist, 'index.html'), 'utf8');
  await mkdir(path.join(dist, 'site-pages'), { recursive: true });
  for (const r of ROUTES) await writeFile(path.join(dist, 'site-pages', `${r.file}.html`), renderRoute(template, r));
  // The player shell (/app) is private: not indexed, no app content in the static HTML.
  await writeFile(path.join(dist, 'site-pages', 'app.html'), renderRoute(template, { path: '/app', title: 'Осколок · веб-плеер', description: 'Веб-версия музыкального плеера Осколок.', h1: 'Осколок', lead: 'Подключаем музыку…', noindex: true }));
  const today = new Date().toISOString().slice(0, 10);
  await writeFile(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${ROUTES.filter(r => !r.noindex).map(r => `  <url><loc>${SITE}${r.path === '/' ? '/' : r.path}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  let build = 'dev';
  try { build = JSON.parse(await readFile(path.join(dist, 'version.json'), 'utf8')).buildId || build; } catch { /* Unstamped dev build. */ }
  const sw = path.join(dist, 'sw.js');
  await writeFile(sw, (await readFile(sw, 'utf8')).replace('__BUILD_ID__', build.replace(/[^A-Za-z0-9:.-]/g, '')));
  console.log(`sitePages: ${ROUTES.length + 1} pages, sitemap, sw ${build}`);
}
