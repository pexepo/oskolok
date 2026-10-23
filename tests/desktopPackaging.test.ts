import {describe, it, expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import asar from '@electron/asar';
import {prepareDesktopStage} from '../scripts/buildDist.js';

describe('desktop distribution', () => {
  it('exports only the cloud client, without database, env, tokens or server', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oskolok-package-'));
    try {
      const stage = path.join(root, 'app');
      expect(prepareDesktopStage('https://music.example.com', stage)).toBe('https://music.example.com');
      const archive = path.join(root, 'app.asar');
      await asar.createPackage(stage, archive);
      expect(asar.listPackage(archive, {isPack: false}).filter((f: string) => !('files' in asar.statFile(archive, f.slice(1)))).sort()).toEqual([
        '/electron/app-url.json', '/electron/desktop-extras.cjs', '/electron/discord-rpc.cjs', '/electron/distributed-preload.cjs', '/electron/distributed.cjs',
        '/electron/icon.ico', '/electron/icon.png', '/electron/mini-preload.cjs', '/electron/mini.html', '/electron/mini.js', '/electron/offline.html', '/electron/offline.js', '/electron/updater.cjs', '/package.json',
      ]);
      const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString());
      expect(manifest.main).toBe('electron/distributed.cjs');
      expect(manifest.dependencies).toBeUndefined();
      const source = asar.extractFile(archive, 'electron/distributed.cjs').toString();
      expect(source).toContain('sandbox: true');
      expect(source).toContain('webSecurity: true');
      expect(source).not.toContain('ignore-certificate-errors');
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });
  it.each(['http://music.example.com', 'https://localhost', 'https://user:secret@music.example.com',
    'https://music.example.com/path', 'https://music.example.com/?token=secret', 'https://oskolok.invalid'])
  ('rejects a non-production origin: %s', url => {
    expect(() => prepareDesktopStage(url, '/unused')).toThrow();
  });
});
