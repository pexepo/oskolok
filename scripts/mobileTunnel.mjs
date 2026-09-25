import 'dotenv/config';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

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

async function appIsReady(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!response.ok || !(await response.text()).includes('<title>Oskolok</title>')) return false;
  const health = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  return health.ok && (await health.json()).status === 'ok';
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
  for (let attempt = 0; attempt < 6 && !stopped && url === latest; attempt++) {
    try {
      if (!await appIsReady(url)) throw new Error('Адрес ещё не отдаёт Осколок и API');
      await botApi('setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Открыть Осколок', web_app: { url: appUrl } },
      });
      if (url !== latest) return;
      await writeFile(urlFile, `${appUrl}\n`);
      healthFailures = 0;
      console.log(`Бот обновлён: ${appUrl}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await wait(Math.min(1500 * (attempt + 1), 5000));
    }
  }
  if (!stopped && url === latest) {
    console.error(`Не удалось подключить туннель: ${lastError?.message || 'неизвестная ошибка'}`);
    child?.kill();
  }
}

function watch(data) {
  buffer = (buffer + data.toString()).slice(-10000);
  const matches = [...buffer.matchAll(/tunneled with tls termination, (https:\/\/[a-z0-9-]+\.lhr\.life)/g)];
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
  child = spawn('ssh', [
    '-T', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=2',
    '-o', 'ExitOnForwardFailure=yes', '-R', `80:127.0.0.1:${port}`, 'nokey@localhost.run',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
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
