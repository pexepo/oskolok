import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const id=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'oskolok-release-'));
const ssh=['-i',process.env.OSKOLOK_SSH_KEY||path.join(os.homedir(),'.ssh/oskolok_deploy_ed25519'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes'];
const host='root@185.166.153.240';
const run=(command,args,options={})=>execFileSync(command,args,{cwd:root,stdio:'inherit',...options});
try {
  run('npm',['run','build']);
  run('npm',['test']);
  // Explicit allowlist: no .env, databases, private sessions, audio or signing keys.
  const archive=path.join(temporary,'release.tar.gz');
  run('tar',['-czf',archive,'package.json','package-lock.json','dist','dist-server','src','tests','server/src','server/assets','server/python-requirements.txt','prisma/schema.prisma','tsconfig.json','server/tsconfig.json','vite.config.ts','scripts/compressDist.mjs','scripts/sitePages.mjs','scripts/buildDist.js','scripts/deploy/link-data.mjs','scripts/deploy/check-cache.mjs','electron/distributed.cjs','electron/distributed-preload.cjs','electron/offline.html','electron/offline.js','electron/desktop-extras.cjs','electron/discord-rpc.cjs','electron/mini.html','electron/mini.js','electron/mini-preload.cjs','electron/updater.cjs','electron/icon.png','electron/icon.ico'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
  run('scp',[...ssh,archive,`${host}:/tmp/oskolok-${id}.tar.gz`]);
  run('ssh',[...ssh,host,'bash','-s','--',id],{stdio:['pipe','inherit','inherit'],input:fs.readFileSync(path.join(root,'scripts/deploy/release.sh'))});
  run('curl',['-fsS','https://oskolok.lol/api/health']);
  const version=JSON.parse(execFileSync('curl',['-fsS','-H','Cache-Control: no-cache','https://oskolok.lol/version.json'],{encoding:'utf8'}));
  const expected=JSON.parse(fs.readFileSync(path.join(root,'dist/version.json'),'utf8'));
  if(version.buildId!==expected.buildId)throw new Error('Public build version differs; check DNS/CDN before retrying.');
  console.log(`\nPublished ${version.buildId}. Previous release retained for rollback.`);
} finally {
  fs.rmSync(temporary,{recursive:true,force:true});
}
