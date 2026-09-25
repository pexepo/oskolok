import dotenv from 'dotenv';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });
const port = Number(process.env.PORT || 5000);
const pidFile = path.join(tmpdir(), 'oskolok-mobile-test.pid');
const urlFile = '/tmp/oskolok-mobile-tunnel-url';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server;
let tunnel;
let stopping = false;

function managedProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).includes('startMobileTest.mjs');
  } catch { return false; }
}

async function replacePreviousRun() {
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (pid !== process.pid && managedProcess(pid)) {
    console.log('Останавливаю предыдущий мобильный запуск…');
    process.kill(pid, 'SIGTERM');
    for (let attempt = 0; attempt < 30 && managedProcess(pid); attempt++) await wait(200);
    if (managedProcess(pid)) throw new Error('Предыдущий запуск не остановился');
  }
  try { unlinkSync(pidFile); } catch {}
}

async function health() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { reachable: true, ready: false };
    const body = await response.json();
    return { reachable: true, ready: body.status === 'ok' };
  } catch { return { reachable: false, ready: false }; }
}

async function ensureServer() {
  const current = await health();
  if (current.ready) { console.log(`Сервер Осколка уже работает на порту ${port}`); return; }
  if (current.reachable) throw new Error(`Порт ${port} занят, но Осколок или база не готовы`);
  if (!existsSync(path.join(root, 'dist-server/server.js')) || !existsSync(path.join(root, 'dist/index.html'))) {
    throw new Error('Нет собранного приложения. Запустите npm run build.');
  }
  server = spawn(process.execPath, ['dist-server/server.js'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit',
  });
  server.on('error', error => console.error(`Не удалось запустить сервер: ${error.message}`));
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error(`Сервер завершился с кодом ${server.exitCode}`);
    const state = await health();
    if (state.ready) { console.log(`Сервер и бот запущены на порту ${port}`); return; }
    if (state.reachable) throw new Error('Сервер запустился, но база данных недоступна');
    await wait(500);
  }
  throw new Error('Сервер не ответил за 30 секунд');
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  tunnel?.kill('SIGTERM');
  server?.kill('SIGTERM');
  try { if (readFileSync(pidFile, 'utf8').trim() === String(process.pid)) unlinkSync(pidFile); } catch {}
  process.exitCode = code;
  setTimeout(() => process.exit(code), 2000).unref();
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
process.on('exit', () => {
  try { if (readFileSync(pidFile, 'utf8').trim() === String(process.pid)) unlinkSync(pidFile); } catch {}
});

try {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('Добавьте TELEGRAM_BOT_TOKEN в .env');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный PORT в .env');
  await replacePreviousRun();
  writeFileSync(pidFile, `${process.pid}\n`, { mode: 0o600 });
  await ensureServer();
  try { unlinkSync(urlFile); } catch {}
  tunnel = spawn(process.execPath, ['scripts/mobileTunnel.mjs'], {
    cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  tunnel.stdout.on('data', data => process.stdout.write(data));
  tunnel.stderr.on('data', data => process.stderr.write(data));
  tunnel.on('error', error => { console.error(`Туннель не запустился: ${error.message}`); stop(1); });
  tunnel.on('exit', code => { if (!stopping) { console.error(`Туннель завершился: ${code}`); stop(1); } });
  server?.on('exit', code => { if (!stopping) { console.error(`Сервер завершился: ${code}`); stop(1); } });
  console.log('Ожидаю HTTPS-домен и обновление кнопки бота…');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  stop(1);
}
