import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const pidFile = path.join(tmpdir(), 'oskolok-mobile-test.pid');
if (!existsSync(pidFile)) { console.log('Мобильный запуск уже остановлен.'); process.exit(0); }
const pid = Number(readFileSync(pidFile, 'utf8').trim());
try {
  const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  if (!command.includes('startMobileTest.mjs')) throw new Error('PID больше не принадлежит мобильному запуску');
  process.kill(pid, 'SIGTERM');
  console.log('Останавливаю мобильный сервер, бота и туннель.');
} catch (error) {
  if (error?.code !== 'ESRCH') console.log('Записанный процесс уже не работает.');
  try { unlinkSync(pidFile); } catch {}
}
