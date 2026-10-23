import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Export a client for the shared server, never private data from this checkout.
export function prepareDesktopStage(appUrl, stage) {
  const url = new URL(appUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || /^(localhost|127\.|\[::1\])/.test(url.hostname) || /\.(invalid|test|local)$/.test(url.hostname)) {
    throw new Error('OSKOLOK_APP_URL must be the public HTTPS origin of the deployed site.');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  fs.mkdirSync(path.join(stage, 'electron'), { recursive: true });
  for (const name of ['distributed.cjs', 'distributed-preload.cjs', 'desktop-extras.cjs', 'discord-rpc.cjs', 'mini.html', 'mini.js', 'mini-preload.cjs', 'updater.cjs', 'offline.html', 'offline.js', 'icon.png', 'icon.ico']) {
    fs.copyFileSync(path.join(project, 'electron', name), path.join(stage, 'electron', name));
  }
  // Discord status needs the public Application ID of the «Осколок» Discord app (not a secret); without it the status stays off.
  const discordClientId = /^\d{15,25}$/.test(process.env.OSKOLOK_DISCORD_CLIENT_ID || '') ? process.env.OSKOLOK_DISCORD_CLIENT_ID : '';
  fs.writeFileSync(path.join(stage, 'electron', 'app-url.json'), JSON.stringify({ url: url.origin, ...(discordClientId ? { discordClientId } : {}) }));
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: manifest.name, version: manifest.version, description: manifest.description,
    author: manifest.author, private: true, main: 'electron/distributed.cjs',
  }, null, 2));
  return url.origin;
}

function main() {
  if (!process.env.OSKOLOK_APP_URL) {
    throw new Error('First deploy the site, then set OSKOLOK_APP_URL=https://your-domain. Old EXE files in release/ contain private data and must not be distributed.');
  }
  const args = process.argv.slice(2);
  const mac = args.includes('--mac');
  if (mac && process.platform !== 'darwin') throw new Error('DMG must be built on macOS.');
  const stage = fs.mkdtempSync(path.join(project, 'build-desktop-'));
  try {
    const origin = prepareDesktopStage(process.env.OSKOLOK_APP_URL, stage);
    const electronVersion = JSON.parse(fs.readFileSync(path.join(project, 'node_modules/electron/package.json'), 'utf8')).version;
    const config = {
      appId: 'com.oskolok.app', productName: 'Oskolok', electronVersion,
      directories: { app: stage, output: path.join(project, 'release', 'distribution') },
      files: ['electron/**/*', 'package.json'], asar: true,
      win: { icon: 'electron/icon.ico', target: ['nsis', 'portable'] },
      nsis: { oneClick: false, allowToChangeInstallationDirectory: true, artifactName: '${productName}-Setup-${version}.${ext}' },
      portable: { artifactName: '${productName}-Portable-${version}.${ext}' },
      mac: { icon: 'electron/icon.png', target: ['dmg'], category: 'public.app-category.music' },
      dmg: { artifactName: '${productName}-${version}-${arch}.${ext}' },
    };
    const configPath = path.join(stage, 'builder.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    const targets = mac ? ['--mac', 'dmg', '--arm64', '--x64']
      : ['--win', ...(args.includes('--portable') ? ['portable'] : args.includes('--installer') ? ['nsis'] : ['nsis', 'portable']), '--x64'];
    console.log(`Building Oskolok client for ${origin}`);
    execFileSync(process.execPath, [path.join(project, 'node_modules/electron-builder/cli.js'),
      '--projectDir', stage, '--config', configPath, ...targets], {
      stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    });
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
