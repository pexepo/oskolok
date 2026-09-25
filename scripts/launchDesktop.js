import { spawn } from 'child_process';
import 'dotenv/config';
import electronPath from 'electron';
import fs from 'fs';
import path from 'path';

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // wait for server
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

async function main() {
  console.log('[Desktop] Waiting for Oskolok service on http://localhost:3000...');
  const ready = await waitForServer('http://localhost:3000');
  if (!ready) {
    console.warn('[Desktop] Warning: Server response timeout, launching window anyway...');
  }

  const electronBin = electronPath;
  const mainCjs = path.resolve('electron/main.cjs');

  if (fs.existsSync(electronBin) && fs.existsSync(mainCjs)) {
    console.log('[Desktop] Launching Oskolok via Electron Native Desktop Shell...');
    // Electron expects the application directory here. Passing main.cjs
    // directly can open Electron's default welcome app on macOS.
    const child = spawn(electronBin, ['.'], {
      detached: false,
      stdio: 'inherit',
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(ready ? { VITE_DEV_SERVER_URL: 'http://localhost:3000' } : {}),
      },
    });
    child.on('error', (error) => {
      console.error('[Desktop] Failed to launch Electron:', error.message);
      process.exitCode = 1;
    });
    child.on('exit', (code) => {
      process.exitCode = code ?? 0;
    });
    console.log('[Desktop] Oskolok native desktop window launched successfully!');
    return;
  }

  // Fallback: Dedicated standalone app window via Chromium / Edge
  let appBinary = CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!appBinary) {
    console.error('[Desktop] Neither Electron, Chrome, nor Edge found on system.');
    process.exit(1);
  }

  const userProfileDir = path.join(
    process.env.LOCALAPPDATA || process.env.TEMP || 'C:\\Temp',
    'Oskolok-Desktop-App'
  );

  const targetAppUrl = ready ? 'http://localhost:3000' : 'http://127.0.0.1:5000';
  console.log(`[Desktop] Launching dedicated app window via ${path.basename(appBinary)} on ${targetAppUrl}...`);
  const args = [
    `--app=${targetAppUrl}`,
    `--user-data-dir=${userProfileDir}`,
    `--window-size=1380,860`,
    `--window-position=100,50`,
    `--disable-extensions`,
    `--disable-default-apps`,
    `--no-first-run`,
    `--app-id=OskolokMusicApp`,
  ];

  const child = spawn(appBinary, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  console.log('[Desktop] Oskolok standalone window launched successfully!');
}

main();
