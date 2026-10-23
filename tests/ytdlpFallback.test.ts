import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ytdlpSearch } from '../server/src/services/ytdlpFallback.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(p => rm(p, { recursive: true, force: true }))); });

it.skipIf(process.platform === 'win32')('passes hostile catalogue text literally without executing shell substitutions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oskolok fallback '));
  temporary.push(dir);
  const executable = path.join(dir, 'fake python');
  const marker = path.join(dir, 'injected');
  await writeFile(executable, '#!/bin/sh\nprintf \'%s\\n\' "$@"\n', { mode: 0o700 });
  const query = `Artist "title" $(touch "${marker}") \`touch "${marker}"\`; echo injected`;
  const ffmpeg = path.join(dir, 'ffmpeg with spaces');
  const stdout = await ytdlpSearch(executable, ffmpeg, query);
  expect(stdout.trim().split('\n').at(-1)).toBe(`ytsearch4:${query}`);
  expect(stdout).toContain(`--ffmpeg-location\n${ffmpeg}\n`);
  await expect(access(marker)).rejects.toThrow();
});
