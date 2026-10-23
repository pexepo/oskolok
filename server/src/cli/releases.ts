/* Published builds for the /download page.
   node dist-server/cli/releases.js list
   node dist-server/cli/releases.js add --platform ios --version 1.0.0 --build 1 --file /var/lib/oskolok/releases/Oskolok-1.0.0.ipa \
        [--variant ""] [--label "IPA"] [--private] [--beta-only] [--availability beta] [--changelog "…"] [--requirements "iOS 15+"]
   node dist-server/cli/releases.js deactivate <id>     — hide a build (the row stays for history)
   node dist-server/cli/releases.js activate <id>
   Size and SHA-256 are computed from the file. Private files must lie in PRIVATE_RELEASES_DIR; public ones are
   served by Nginx from /var/www/oskolok-downloads and must use one of the names Nginx allows. */
import {createHash} from 'node:crypto';
import {createReadStream,statSync} from 'node:fs';
import path from 'node:path';
import {env} from '../config/env.js';
import {prisma} from '../database/client.js';
import {ensureBetaSchema} from '../database/ensureBetaSchema.js';
import {RELEASE_PLATFORMS} from '../services/releases.js';

const [command,...rest]=process.argv.slice(2);
const flags=new Map<string,string|true>();
for(let i=0;i<rest.length;i++){
 const key=rest[i];
 if(!key.startsWith('--'))continue;
 const value=rest[i+1];
 if(value===undefined||value.startsWith('--'))flags.set(key.slice(2),true);else{flags.set(key.slice(2),value);i++;}
}
const str=(name:string,fallback='')=>{const v=flags.get(name);return typeof v==='string'?v:fallback;};
const sha256=(file:string)=>new Promise<string>((resolve,reject)=>{const h=createHash('sha256');createReadStream(file).on('data',d=>h.update(d)).on('end',()=>resolve(h.digest('hex'))).on('error',reject);});

try{
 await ensureBetaSchema();
 if(command==='list'){
  const rows=await prisma.appRelease.findMany({orderBy:[{platform:'asc'},{releaseDate:'desc'}]});
  console.table(rows.map(r=>({id:r.id,platform:r.platform,variant:r.variant,version:r.version,build:r.buildNumber,date:r.releaseDate.toISOString().slice(0,10),file:r.fileName,size:r.fileSize,storage:r.storage,betaOnly:r.betaOnly,active:r.active})));
 }else if(command==='add'){
  const platform=str('platform'),version=str('version'),file=str('file');
  if(!(RELEASE_PLATFORMS as readonly string[]).includes(platform)||platform==='web')throw new Error(`--platform: ${RELEASE_PLATFORMS.filter(p=>p!=='web').join('|')}`);
  if(!/^\d+\.\d+\.\d+([-.][A-Za-z0-9.]+)?$/.test(version))throw new Error('--version like 1.2.0');
  if(!file)throw new Error('--file is required');
  const isPrivate=flags.has('private');
  const resolved=path.resolve(file),fileName=path.basename(resolved);
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(fileName))throw new Error('file name: latin letters, digits, dot, dash, underscore');
  if(isPrivate){
   if(!env.PRIVATE_RELEASES_DIR)throw new Error('PRIVATE_RELEASES_DIR is not set');
   if(path.dirname(resolved)!==path.resolve(env.PRIVATE_RELEASES_DIR))throw new Error(`private builds must be placed directly in ${env.PRIVATE_RELEASES_DIR}`);
  }
  const size=statSync(resolved).size,checksum=await sha256(resolved);
  const data={platform,variant:str('variant'),label:str('label'),version,buildNumber:Number(str('build','0'))||0,releaseDate:new Date(str('date')||Date.now()),changelog:str('changelog'),fileName,fileSize:size,checksum,availability:str('availability',flags.has('beta-only')?'beta':'available'),betaOnly:flags.has('beta-only'),storage:isPrivate?'private':'public',requirements:str('requirements'),active:true};
  const row=await prisma.appRelease.upsert({where:{platform_variant_version:{platform,variant:data.variant,version}},create:data,update:data});
  console.log(JSON.stringify({saved:row.id,platform,version,fileName,size,checksum,storage:data.storage,betaOnly:data.betaOnly},null,2));
 }else if((command==='deactivate'||command==='activate')&&rest[0]){
  await prisma.appRelease.update({where:{id:rest[0]},data:{active:command==='activate'}});
  console.log(`${command}d ${rest[0]}`);
 }else{
  console.error('usage: releases.js list | add --platform <p> --version <v> --file <path> [--private] [--beta-only] … | activate <id> | deactivate <id>');
  process.exitCode=2;
 }
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
finally{await prisma.$disconnect();}
