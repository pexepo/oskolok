import {afterEach,beforeEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
// @ts-expect-error Deployment helper is a standalone Node module.
import {linkReleaseData} from '../scripts/deploy/link-data.mjs';

let root:string,data:string,shared:string;
beforeEach(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),'oskolok-deploy-cache-'));
  data=path.join(root,'release/server/data');shared=path.join(root,'persistent');
  await fs.mkdir(shared,{recursive:true});await fs.writeFile(path.join(shared,'existing-audio'),'keep');
});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});

it('replaces a cache directory created by QA with the shared link, preserving existing audio',async()=>{
  await fs.mkdir(path.join(data,'audio_cache_originals_v7'),{recursive:true});
  await fs.writeFile(path.join(data,'qa-only'),'discard');
  await linkReleaseData(data,shared);
  expect((await fs.lstat(data)).isSymbolicLink()).toBe(true);
  expect(await fs.realpath(data)).toBe(await fs.realpath(shared));
  expect(await fs.readFile(path.join(data,'existing-audio'),'utf8')).toBe('keep');
  await fs.writeFile(path.join(data,'new-audio'),'new');
  expect(await fs.readFile(path.join(shared,'new-audio'),'utf8')).toBe('new');
});

it('is repeatable for the expected link and rejects an unrelated link without changing it',async()=>{
  await linkReleaseData(data,shared);await linkReleaseData(data,shared);
  const unrelated=path.join(root,'unrelated');await fs.mkdir(unrelated);
  await fs.unlink(data);await fs.symlink(unrelated,data);
  await expect(linkReleaseData(data,shared)).rejects.toThrow('unexpected directory');
  expect(await fs.realpath(data)).toBe(await fs.realpath(unrelated));
  expect(await fs.readFile(path.join(shared,'existing-audio'),'utf8')).toBe('keep');
});
