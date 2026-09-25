import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function log(msg) {
  console.log(`\n\x1b[36m[build-dist]\x1b[0m ${msg}`);
}

function run(cmd, desc) {
  if (desc) log(desc);
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: process.env });
}

async function main() {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

  const args = process.argv.slice(2);
  const onlyPortable = args.includes('--portable');
  const onlyInstaller = args.includes('--installer');
  const buildBoth = !onlyPortable && !onlyInstaller;

  const rootDir = process.cwd();
  const releaseDir = path.join(rootDir, 'release');

  // Clean any stale tmp query_engine files in .prisma/client
  const prismaClientDir = path.join(rootDir, 'node_modules', '.prisma', 'client');
  if (fs.existsSync(prismaClientDir)) {
    try {
      const entries = fs.readdirSync(prismaClientDir);
      for (const entry of entries) {
        if (entry.includes('.tmp')) {
          fs.rmSync(path.join(prismaClientDir, entry), { force: true });
        }
      }
    } catch {}
  }

  // Purge audio cache so it is never bundled into release packages
  const audioCacheDir = path.join(rootDir, 'server', 'data', 'audio_cache');
  if (fs.existsSync(audioCacheDir)) {
    try {
      const entries = fs.readdirSync(audioCacheDir);
      for (const entry of entries) {
        fs.rmSync(path.join(audioCacheDir, entry), { recursive: true, force: true });
      }
      log('Кэш аудио (server/data/audio_cache) очищен.');
    } catch (err) {
      console.warn('Warning while clearing audio cache:', err.message);
    }
  }

  log('Шаг 1/5: Компиляция сервера (TypeScript + Prisma + ytdlp_worker)...');
  run('npm run build:server');

  log('Шаг 2/5: Компиляция фронтенда (Vite + React)...');
  run('npm run build:client');

  log('Шаг 3/5: Упаковка приложения через electron-packager...');
  const packCmd = 'npx electron-packager . Oskolok --platform=win32 --arch=x64 --out=release --overwrite --asar.unpack="{dist-server/**,prisma/**,node_modules/.prisma/**,node_modules/@prisma/client/**}" --ignore="^/(server/data|release|tests|scratch|nginx|\\.git|\\.github)" --icon=electron/icon.ico';
  run(packCmd);

  const packagerOutDir = path.join(releaseDir, 'Oskolok-win32-x64');
  const unpackedDir = path.join(releaseDir, 'win-unpacked');

  log('Шаг 4/5: Синхронизация файлов в win-unpacked...');
  if (fs.existsSync(packagerOutDir)) {
    if (fs.existsSync(unpackedDir)) {
      try {
        fs.rmSync(unpackedDir, { recursive: true, force: true });
      } catch (err) {
        console.warn('Could not remove existing win-unpacked folder, copying on top:', err.message);
      }
    }
    try {
      fs.cpSync(packagerOutDir, unpackedDir, { recursive: true, force: true });
    } catch (err) {
      console.warn('Warning during copy to win-unpacked:', err.message);
    }
  }

  // Ensure dev.db template exists in app.asar.unpacked/prisma
  const targetUnpackedDb = path.join(unpackedDir, 'resources', 'app.asar.unpacked', 'prisma', 'dev.db');
  const srcDb = path.join(rootDir, 'prisma', 'dev.db');
  if (fs.existsSync(srcDb)) {
    fs.mkdirSync(path.dirname(targetUnpackedDb), { recursive: true });
    fs.copyFileSync(srcDb, targetUnpackedDb);
    log(`База SQLite скопирована в ${targetUnpackedDb}`);
  }

  // Ensure ytdlp_worker.py is unpacked
  const targetWorker = path.join(unpackedDir, 'resources', 'app.asar.unpacked', 'dist-server', 'services', 'ytdlp_worker.py');
  const srcWorker = path.join(rootDir, 'server', 'src', 'services', 'ytdlp_worker.py');
  if (fs.existsSync(srcWorker)) {
    fs.mkdirSync(path.dirname(targetWorker), { recursive: true });
    fs.copyFileSync(srcWorker, targetWorker);
    log(`ytdlp_worker.py скопирован в ${targetWorker}`);
  }

  log('Шаг 5/5: Сборка исполняемых файлов через electron-builder...');
  const targetDir = fs.existsSync(unpackedDir) ? unpackedDir : packagerOutDir;

  if (onlyPortable || buildBoth) {
    log('Сборка Portable .exe (один файл без установки)...');
    run(`npx electron-builder --win portable --prepackaged "${targetDir}"`);
  }

  if (onlyInstaller || buildBoth) {
    log('Сборка Setup .exe (инсталлятор)...');
    run(`npx electron-builder --win nsis --prepackaged "${targetDir}"`);
  }

  log('✨ Сборка успешно завершена!');
  console.log('\nИтоговые файлы:');
  const files = fs.readdirSync(releaseDir);
  for (const file of files) {
    if (file.endsWith('.exe')) {
      const filePath = path.join(releaseDir, file);
      const stat = fs.statSync(filePath);
      const sizeMb = (stat.size / (1024 * 1024)).toFixed(1);
      console.log(` - release/${file} (${sizeMb} MB)`);
    }
  }
}

main().catch((err) => {
  console.error('\n❌ Ошибка сборки:', err);
  process.exit(1);
});