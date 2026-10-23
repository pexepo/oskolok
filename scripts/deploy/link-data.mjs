import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Tests can create a disposable server/data directory before publication.
// Move it aside so the link replaces that directory, rather than appearing inside it.
export async function linkReleaseData(data,shared) {
  const target=await fs.realpath(shared);
  await fs.mkdir(path.dirname(data),{recursive:true});
  const existing=await fs.lstat(data).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(existing?.isSymbolicLink()) {
    if(await fs.realpath(data)!==target)throw new Error('Release data points at an unexpected directory');
    return;
  }
  if(existing&&!existing.isDirectory())throw new Error('Release data is not a directory');
  const disposable=`${data}.qa`;
  if(existing)await fs.rename(data,disposable);
  try {
    await fs.symlink(target,data,'dir');
    if(await fs.realpath(data)!==target)throw new Error('Shared cache link verification failed');
  } catch(error) {
    await fs.unlink(data).catch(()=>{});
    if(existing)await fs.rename(disposable,data);
    throw error;
  }
  if(existing)await fs.rm(disposable,{recursive:true,force:true});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2]||!process.argv[3])throw new Error('Release data and shared data paths required');
  await linkReleaseData(path.resolve(process.argv[2]),path.resolve(process.argv[3]));
}
