import 'dotenv/config';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import dns from 'node:dns';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

// Serveo is the default: measured from here it serves the 600 KB bundle in ~0.9 s against ~14 s through
// localhost.run, which stays as the automatic fallback. MOBILE_TUNNEL=cloudflared|localhost.run|serveo picks the
// first one to try; Cloudflare quick tunnels are never chosen on their own (some ISPs, e.g. in Russia, break their TLS).
const hasCloudflared = (() => { try { execFileSync('cloudflared', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const order = ['serveo', 'localhost.run'];
const wanted = process.env.MOBILE_TUNNEL;
if (wanted === 'cloudflared' && hasCloudflared) order.unshift('cloudflared');
else if (order.includes(wanted)) order.sort((a, b) => (b === wanted) - (a === wanted));
let providerIndex = 0, failuresHere = 0;
const providerName = () => order[providerIndex % order.length];
const PATTERNS = {
  cloudflared: /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/g,
  'localhost.run': /tunneled with tls termination, (https:\/\/[a-z0-9-]+\.lhr\.life)/g,
  serveo: /(https:\/\/[a-z0-9-]+\.serveousercontent\.com|https:\/\/[a-z0-9-]+\.serveo\.net)/g,
};
/** Two failures in a row on one provider move on to the next. */
function providerFailed() {
  if (++failuresHere < 2) return;
  failuresHere = 0;
  providerIndex++;
  console.log(`Переключаю туннель на ${providerName()}`);
}
console.log(`Туннель: ${providerName()} (запасные: ${order.filter(name => name !== providerName()).join(', ') || 'нет'})`);

const port = Number(process.env.PORT || 5000);
const urlFile = '/tmp/oskolok-mobile-tunnel-url';
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let stopped = false;
let child;
let latest = '';
let buffer = '';
let healthFailures = 0;
let update = Promise.resolve();
let checkingMenu = false;

// A fresh *.trycloudflare.com name may be missing from the Mac's resolver for a
// while (it caches the early "no such host"), so readiness is probed through a
// public resolver instead. Phones use their own DNS and see the name at once.
const resolver = new dns.Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);
const publicLookup = (hostname, options, callback) => resolver.resolve4(hostname, (error, addresses) => {
  if (error || !addresses?.length) return dns.lookup(hostname, options, callback);
  if (options?.all) return callback(null, addresses.map(address => ({ address, family: 4 })));
  callback(null, addresses[0], 4);
});
function get(url) {
  return new Promise((resolve, reject) => {
    // Only fresh trycloudflare.com names need the public resolver; others (Serveo) resolve fine through the system.
    const request = https.get(url, { ...(String(url).includes('trycloudflare.com') ? { lookup: publicLookup } : {}), timeout: 8000, headers: { 'Cache-Control': 'no-store' } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, body }));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

async function appIsReady(url) {
  const page = await get(url);
  if (!page.ok || !page.body.includes('<title>Oskolok</title>')) return false;
  const health = await get(new URL('/api/health', url).toString());
  return health.ok && JSON.parse(health.body).status === 'ok';
}

async function botApi(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram ${method} failed`);
  return result.result;
}

async function publish(url) {
  const appUrl = new URL('/', url).toString();
  let lastError;
  const attempts = providerName() === 'cloudflared' ? 12 : 6;
  for (let attempt = 0; attempt < attempts && !stopped && url === latest; attempt++) {
    try {
      if (!await appIsReady(url)) throw new Error('Адрес ещё не отдаёт Осколок и API');
      await botApi('setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Открыть Осколок', web_app: { url: appUrl } },
      });
      if (url !== latest) return;
      await writeFile(urlFile, `${appUrl}\n`);
      healthFailures = 0;
      failuresHere = 0;
      console.log(`Бот обновлён: ${appUrl}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await wait(Math.min(1500 * (attempt + 1), 5000));
    }
  }
  if (!stopped && url === latest) {
    console.error(`Не удалось подключить туннель: ${lastError?.message || 'неизвестная ошибка'}`);
    providerFailed();
    child?.kill();
  }
}

function watch(data) {
  buffer = (buffer + data.toString()).slice(-10000);
  const pattern = PATTERNS[providerName()];
  pattern.lastIndex = 0;
  const matches = [...buffer.matchAll(pattern)];
  const url = matches.at(-1)?.[1];
  if (url && url !== latest) {
    latest = url;
    healthFailures = 0;
    update = update.catch(() => {}).then(() => publish(url));
  }
}

function run() {
  if (stopped) return;
  latest = '';
  buffer = '';
  healthFailures = 0;
  const name = providerName(), started = Date.now();
  const ssh = host => spawn('ssh', [
    '-T', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=2',
    '-o', 'ExitOnForwardFailure=yes', '-R', `80:127.0.0.1:${port}`, host,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child = name === 'cloudflared'
    ? spawn('cloudflared', ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    : ssh(name === 'serveo' ? 'serveo.net' : 'nokey@localhost.run');
  // A tunnel that dies before giving an address (or within a minute) counts against its provider.
  child.on('exit', () => { if (!latest || Date.now() - started < 60000) providerFailed(); });
  child.stdout.on('data', watch);
  child.stderr.on('data', watch);
  child.on('error', error => console.error(`Туннель не запустился: ${error.message}`));
  child.on('exit', () => { child = undefined; if (!stopped) setTimeout(run, 2000); });
}

if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('Добавьте TELEGRAM_BOT_TOKEN в .env');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный PORT в .env');

const healthTimer = setInterval(async () => {
  if (stopped || !latest || !child) return;
  try {
    if (await appIsReady(latest)) { healthFailures = 0; return; }
  } catch { /* Count a network failure below. */ }
  healthFailures++;
  if (healthFailures >= 2) {
    console.error(`Туннель перестал отвечать: ${latest}. Переподключаю.`);
    healthFailures = 0;
    child.kill();
  }
}, 20000);

// Telegram can briefly return the previous menu after accepting an update.
// Repair the menu in place instead of throwing away an otherwise healthy URL.
const menuTimer = setInterval(async () => {
  if (stopped || !latest || !child || checkingMenu) return;
  checkingMenu = true;
  try {
    const expected = new URL('/', latest).toString();
    const menu = await botApi('getChatMenuButton', {});
    if (menu.web_app?.url !== expected) {
      await botApi('setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Открыть Осколок', web_app: { url: expected } },
      });
      console.log(`Кнопка бота синхронизирована: ${expected}`);
    }
  } catch (error) {
    console.error(`Проверка кнопки бота: ${error.message}`);
  } finally { checkingMenu = false; }
}, 60000);

function stop() {
  stopped = true;
  clearInterval(healthTimer);
  clearInterval(menuTimer);
  child?.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
run();
