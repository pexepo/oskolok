import fs from 'node:fs/promises';
import path from 'node:path';

const data=path.resolve('server/data'),shared=path.resolve('/var/lib/oskolok/data');
if(await fs.realpath(data)!==await fs.realpath(shared))throw new Error('Cache is not shared across releases');
const cache=path.join(data,'audio_cache_originals_v7');
await fs.mkdir(cache,{recursive:true});
const temporary=await fs.mkdtemp(path.join(cache,'.deployment-check-'));
try {
  const source=path.join(temporary,'audio.tmp'),destination=path.join(temporary,'audio.m4a');
  await fs.writeFile(source,'cache write check',{flag:'wx'});
  await fs.rename(source,destination);
  if(await fs.readFile(destination,'utf8')!=='cache write check')throw new Error('Cache contents differ');
} finally {
  await fs.rm(temporary,{recursive:true,force:true});
}
console.log('Shared audio cache: write and atomic rename succeeded under service restrictions');
