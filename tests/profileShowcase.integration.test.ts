import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const isolated=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/src/database/client.js',()=>({get prisma(){return isolated.db;}}));
vi.mock('../server/src/services/profileArtwork.js',()=>({profileTrackWithArtwork:async(raw:string)=>JSON.parse(raw)}));

let directory:string,db:PrismaClient,showcase:typeof import('../server/src/services/profileShowcase.js');
const owner='telegram:93000001';
const track=(id:string)=>({id,source:'deezer',sourceId:id,title:`Song ${id}`,artist:{name:'Artist'},duration:200,access:'playable'});
const gif=Buffer.concat([Buffer.from('GIF89a'),Buffer.alloc(20)]);

beforeAll(async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'oskolok-showcase-'));
 const databaseUrl=`file:${path.join(directory,'isolated.sqlite')}`;
 vi.stubEnv('DATABASE_URL',databaseUrl);vi.stubEnv('USER_CONTENT_DIR',path.join(directory,'uploads'));
 db=new PrismaClient({datasources:{db:{url:databaseUrl}}});isolated.db=db;
 const ddl=execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8'});
 for(const sql of ddl.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(sql);
 await db.user.create({data:{id:owner,name:'Owner'}});
 showcase=await import('../server/src/services/profileShowcase.js');
},30000);
afterAll(async()=>{if(db)await db.$disconnect();vi.unstubAllEnvs();if(directory)await rm(directory,{recursive:true,force:true});});

describe.sequential('profile showcase',()=>{
 it('imports the old showcase once and never again after the tiles are removed',async()=>{
  await db.profileMusic.create({data:{userId:owner,trackId:'deezer:1',trackData:JSON.stringify(track('deezer:1'))}});
  const first=await showcase.listShowcase(owner);
  expect(first.map(i=>[i.kind,i.track?.id])).toEqual([['track','deezer:1']]);
  await showcase.removeShowcaseItem(owner,first[0].id);
  expect(await showcase.listShowcase(owner)).toEqual([]);
 });
 it('adds tiles of every kind, refuses duplicates and keeps the chosen order',async()=>{
  const resolve=async(id:string)=>track(id) as any;
  const a=await showcase.addShowcaseItem(owner,showcase.showcaseAddSchema.parse({kind:'track',trackId:'deezer:2'}),resolve);
  const b=await showcase.addShowcaseItem(owner,showcase.showcaseAddSchema.parse({kind:'album',size:'l',caption:'Лучший',album:{id:'deezer:album:9',title:'Album',artistName:'Artist',artworkUrl:'https://cdn-images.dzcdn.net/images/cover/x/500x500.jpg'}}),resolve);
  const c=await showcase.addShowcaseItem(owner,showcase.showcaseAddSchema.parse({kind:'note',text:'Привет',size:'wide'}),resolve);
  await expect(showcase.addShowcaseItem(owner,showcase.showcaseAddSchema.parse({kind:'track',trackId:'deezer:2'}),resolve)).rejects.toThrow('уже есть');
  expect(showcase.showcaseAddSchema.safeParse({kind:'album',album:{id:'x',title:'t',artworkUrl:'https://evil.example/pixel.gif'}}).success).toBe(false);
  await showcase.reorderShowcase(owner,[c!.id,a!.id,b!.id,'00000000-0000-4000-8000-000000000000']);
  const list=await showcase.listShowcase(owner);
  expect(list.map(i=>i.kind)).toEqual(['note','track','album']);
  expect(list[2]).toMatchObject({size:'l',caption:'Лучший'});
  await showcase.updateShowcaseItem(owner,c!.id,{text:'Пока',size:'s'});
  expect((await showcase.listShowcase(owner))[0]).toMatchObject({text:'Пока',size:'s'});
 });
 it('accepts real GIF bytes only and removes the file with its tile',async()=>{
  await expect(showcase.uploadShowcaseImage(owner,Buffer.from('not an image'))).rejects.toThrow('PNG, JPEG, WebP и GIF');
  const file=await showcase.uploadShowcaseImage(owner,gif);
  expect(file.mime).toBe('image/gif');
  const tile=await showcase.addShowcaseItem(owner,showcase.showcaseAddSchema.parse({kind:'image',fileId:file.id,caption:'гифка'}),async()=>null);
  const media=await showcase.showcaseMedia(owner,tile!.id);
  expect(media?.mime).toBe('image/gif');
  await showcase.removeShowcaseItem(owner,tile!.id);
  await expect(stat(media!.path)).rejects.toThrow();
  expect(await db.userFile.count({where:{id:file.id}})).toBe(0);
 });
});
