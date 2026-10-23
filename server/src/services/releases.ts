import {createHmac,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {env} from '../config/env.js';
import {prisma} from '../database/client.js';
import {siteSecret} from './betaApplications.js';

export const RELEASE_PLATFORMS=['windows','macos','linux','android','ios','web'] as const;
export type ReleasePlatform=typeof RELEASE_PLATFORMS[number];
export type PlatformStatus='available'|'beta'|'development'|'soon';
type ReleaseRow=Awaited<ReturnType<typeof prisma.appRelease.findUniqueOrThrow>>;

/** Builds already published in /var/www/oskolok-downloads (checksums verified on the server 2026-10-17). */
const PUBLISHED:Array<Omit<ReleaseRow,'id'|'createdAt'|'updatedAt'|'active'>>=[
 {platform:'windows',variant:'installer',label:'Установщик',version:'1.1.1',buildNumber:111,releaseDate:new Date('2026-10-13T14:22:49Z'),changelog:'Исправлен вылет при ПКМ по треку, пробел после нажатия на строку текста ставит паузу, оптимизированы большие плейлисты и очередь, мягче шкала громкости и нормализация.',fileName:'Oskolok-Setup.exe',fileSize:111890654,checksum:'6bc9f015ab221f1c117441539f060319eaa2b59c9747de44a8fb5ce0155082f3',availability:'available',betaOnly:false,storage:'public',requirements:'Windows 10 или 11, 64-бит'},
 {platform:'windows',variant:'portable',label:'Portable',version:'1.1.1',buildNumber:111,releaseDate:new Date('2026-10-13T14:22:49Z'),changelog:'Та же версия без установки: запускается из любой папки.',fileName:'Oskolok-Portable.exe',fileSize:111629935,checksum:'f9991b07fcd9c660bda23b2558835494afec3eb08fec365b86f247b1f51b47cc',availability:'available',betaOnly:false,storage:'public',requirements:'Windows 10 или 11, 64-бит'},
 {platform:'macos',variant:'arm64',label:'Apple Silicon (M1–M4)',version:'1.1.1',buildNumber:111,releaseDate:new Date('2026-10-13T14:22:49Z'),changelog:'Исправления навигации, плеера и стабильности Telegram-профиля.',fileName:'Oskolok-arm64.dmg',fileSize:129961966,checksum:'0efe7d10fb6720648c0a7bd90a45859c89f0e2b86ac64bf885392dc3dd4bcb56',availability:'available',betaOnly:false,storage:'public',requirements:'macOS 12 Monterey или новее, процессор Apple'},
 {platform:'macos',variant:'x64',label:'Intel',version:'1.1.1',buildNumber:111,releaseDate:new Date('2026-10-13T14:22:49Z'),changelog:'Исправления навигации, плеера и стабильности Telegram-профиля.',fileName:'Oskolok-x64.dmg',fileSize:133773973,checksum:'2594d4c79e1f88c6e1185110e7c5768e3088ab578aa6090eb5acb49c288bb157',availability:'available',betaOnly:false,storage:'public',requirements:'macOS 12 Monterey или новее, процессор Intel'},
 {platform:'android',variant:'',label:'APK',version:'1.1.1',buildNumber:111,releaseDate:new Date('2026-10-13T14:22:49Z'),changelog:'Нативная служба воспроизведения, системное уведомление и кнопки на экране блокировки.',fileName:'Oskolok.apk',fileSize:37332,checksum:'5304c6a41bd2408dbf256ee4057b3a40b726ac65c74a234eb78dd69af9b62e95',availability:'beta',betaOnly:false,storage:'public',requirements:'Android 8.0 или новее'},
];

/** Idempotent: inserts the known public builds once and never overwrites later edits. */
export async function seedPublishedReleases(){
 for(const r of PUBLISHED)await prisma.appRelease.upsert({where:{platform_variant_version:{platform:r.platform,variant:r.variant,version:r.version}},create:r,update:{}});
}

const SAFE_FILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
/** Without a published build a platform shows an honest status instead of a download button. */
const FALLBACK:Record<ReleasePlatform,{status:PlatformStatus;note:string}>={
 windows:{status:'soon',note:'Сборка готовится.'},
 macos:{status:'soon',note:'Сборка готовится.'},
 linux:{status:'soon',note:'Отдельной сборки для Linux пока нет. Веб-версия работает в любом современном браузере.'},
 android:{status:'soon',note:'Сборка готовится.'},
 ios:{status:'development',note:'Приложение для iPhone собирается и проверяется. Пока можно открыть веб-версию в Safari и добавить её на экран «Домой».'},
 web:{status:'available',note:'Работает в браузере: компьютер, телефон, планшет.'},
};

export type PublicRelease={id:string;variant:string;label:string;version:string;buildNumber:number;releaseDate:string;changelog:string;fileSize:number;checksum:string;availability:string;betaOnly:boolean;downloadUrl:string|null;requirements:string};
export function publicRelease(r:ReleaseRow):PublicRelease{
 return {id:r.id,variant:r.variant,label:r.label,version:r.version,buildNumber:r.buildNumber,releaseDate:r.releaseDate.toISOString(),changelog:r.changelog,fileSize:r.fileSize,checksum:r.checksum,availability:r.availability,betaOnly:r.betaOnly,
  // A beta-only file has no public address at all: the link is issued per request after an access check.
  downloadUrl:!r.betaOnly&&r.storage==='public'&&SAFE_FILE.test(r.fileName)?`/downloads/${r.fileName}`:null,requirements:r.requirements};
}

/** The newest active build per platform variant; platforms without builds carry their honest status. */
export async function releaseCatalog(){
 const rows=await prisma.appRelease.findMany({where:{active:true},orderBy:[{releaseDate:'desc'},{buildNumber:'desc'}]});
 return RELEASE_PLATFORMS.map(platform=>{
  const seen=new Set<string>(),builds:PublicRelease[]=[];
  for(const r of rows)if(r.platform===platform&&!seen.has(r.variant)){seen.add(r.variant);builds.push(publicRelease(r));}
  const status:PlatformStatus=platform==='web'?'available':builds.some(b=>!b.betaOnly&&b.availability==='available')?'available':builds.length?'beta':FALLBACK[platform].status;
  return {platform,status,note:builds.length?'':FALLBACK[platform].note,builds};
 });
}

const LINK_TTL_MS=10*60*1000;
const sign=(id:string,expires:number,userId:string)=>createHmac('sha256',siteSecret('release-links')).update(`${id}\n${expires}\n${userId}`).digest('base64url');
/** A short-lived link bound to the release and the requesting account; it still works if forwarded within ten minutes. */
export function signedDownloadPath(id:string,userId:string,now=Date.now()){
 const expires=now+LINK_TTL_MS,u=createHmac('sha256',siteSecret('release-links')).update(userId).digest('base64url').slice(0,16);
 return {url:`/api/site/releases/${encodeURIComponent(id)}/file?e=${expires}&u=${u}&s=${sign(id,expires,u)}`,expiresAt:new Date(expires).toISOString()};
}
export function verifyDownloadSignature(id:string,query:Record<string,unknown>,now=Date.now()):boolean{
 const e=Number(query.e),u=String(query.u||''),s=String(query.s||'');
 if(!Number.isSafeInteger(e)||e<now||e>now+LINK_TTL_MS+60000||!/^[A-Za-z0-9_-]{16}$/.test(u)||!/^[A-Za-z0-9_-]{43}$/.test(s))return false;
 const a=Buffer.from(sign(id,e,u)),b=Buffer.from(s);
 return a.length===b.length&&timingSafeEqual(a,b);
}

export async function findDownloadableRelease(id:string){
 if(!/^[0-9a-f-]{36}$/.test(id))return null;
 return prisma.appRelease.findFirst({where:{id,active:true}});
}
/** Resolves a private build inside PRIVATE_RELEASES_DIR only; names with separators are rejected. */
export function privateReleaseFile(r:ReleaseRow):string|null{
 if(!env.PRIVATE_RELEASES_DIR||!SAFE_FILE.test(r.fileName))return null;
 const root=path.resolve(env.PRIVATE_RELEASES_DIR),file=path.resolve(root,r.fileName);
 return file.startsWith(root+path.sep)?file:null;
}

/** Numeric comparison of «1.2.0»-style versions (pre-release suffixes count as older). */
export function compareVersions(a:string,b:string){
 const parse=(v:string)=>{const [main,pre]=v.split(/[-+]/,2);return {n:main.split('.').map(x=>Number(x)||0),pre:!!pre};};
 const x=parse(a),y=parse(b);
 for(let i=0;i<3;i++){const d=(x.n[i]||0)-(y.n[i]||0);if(d)return Math.sign(d);}
 return x.pre===y.pre?0:x.pre?-1:1;
}
const UPDATE_TARGETS:Record<string,{platform:ReleasePlatform;variants:string[]}>={windows:{platform:'windows',variants:['installer','portable']},macos:{platform:'macos',variants:['arm64','x64']}};
/** Over-the-air update for the desktop shell: the newest public build of the same variant, if newer than the running one. */
export async function desktopUpdate(platform:string,variant:string,current:string){
 const target=UPDATE_TARGETS[platform];
 if(!target||!target.variants.includes(variant)||!/^\d+\.\d+\.\d+/.test(current))return null;
 const rows=await prisma.appRelease.findMany({where:{active:true,platform:target.platform,variant,betaOnly:false,storage:'public',availability:'available'},orderBy:[{releaseDate:'desc'},{buildNumber:'desc'}]});
 const latest=rows.sort((a,b)=>compareVersions(b.version,a.version))[0];
 if(!latest||compareVersions(latest.version,current)<=0||!SAFE_FILE.test(latest.fileName)||!/^[a-f0-9]{64}$/.test(latest.checksum))return null;
 return {version:latest.version,url:`/downloads/${latest.fileName}`,sha256:latest.checksum,size:latest.fileSize,changelog:latest.changelog,releaseDate:latest.releaseDate.toISOString()};
}
