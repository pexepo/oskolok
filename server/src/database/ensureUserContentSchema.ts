import {prisma} from './client.js';
/** Only additive DDL: never recreates or resets an existing user/library table. */
let initialization:Promise<void>|undefined;
export function ensureUserContentSchema():Promise<void> {
 if(initialization)return initialization;
 initialization=migrateUserContent().finally(()=>{initialization=undefined;});
 return initialization;
}
async function migrateUserContent(){
 const pg=String(process.env.DATABASE_URL||'').startsWith('postgres'),date=pg?'TIMESTAMP(3)':'DATETIME',real=pg?'DOUBLE PRECISION':'REAL';
 const tables:Record<string,string>={
 MonthlyActivity:`"userId" TEXT NOT NULL,"month" TEXT NOT NULL,PRIMARY KEY ("userId","month")`,
 BetaAccess:`"id" TEXT PRIMARY KEY,"username" TEXT NOT NULL,"telegramUserId" TEXT,"enabled" BOOLEAN NOT NULL DEFAULT true,"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
 TelegramBotContact:`"userId" TEXT PRIMARY KEY,"username" TEXT,"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
 PersonalTrack:`"hasTimingOffset" BOOLEAN NOT NULL DEFAULT false,"id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"trackId" TEXT NOT NULL,"offset" ${real} NOT NULL DEFAULT 0,"lyricsData" TEXT,"audioFileId" TEXT,"updatedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
 UserFile:`"id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"trackId" TEXT,"kind" TEXT NOT NULL,"fileName" TEXT NOT NULL,"mime" TEXT NOT NULL,"size" INTEGER NOT NULL,"path" TEXT NOT NULL,"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
 UserReport:`"id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"requestId" TEXT NOT NULL,"kind" TEXT NOT NULL,"reason" TEXT NOT NULL,"description" TEXT NOT NULL,"trackId" TEXT,"page" TEXT,"payload" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'pending',"reviewNote" TEXT NOT NULL DEFAULT '',"reviewedAt" ${date},"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
 SharedTrackOverride:`"trackId" TEXT PRIMARY KEY,"offset" ${real} NOT NULL DEFAULT 0,"audioFileId" TEXT,"sourceUrl" TEXT,"platform" TEXT,"updatedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
 ReleaseExport:`"id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"requestId" TEXT NOT NULL,"releaseId" TEXT NOT NULL,"title" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'preparing',"result" TEXT NOT NULL DEFAULT '{}',"filePath" TEXT,"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
 };
 for(const [name,columns] of Object.entries(tables))await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${name}" (${columns})`);
 // A personal audio/lyrics row does not imply that the listener set a timing override.
 const personalColumns=pg?await prisma.$queryRawUnsafe<Array<{name:string}>>(`SELECT column_name AS name FROM information_schema.columns WHERE table_name='PersonalTrack'`):await prisma.$queryRawUnsafe<Array<{name:string}>>('PRAGMA table_info("PersonalTrack")');
 if(!personalColumns.some(c=>c.name==='hasTimingOffset')){
  try {
   await prisma.$executeRawUnsafe('ALTER TABLE "PersonalTrack" ADD COLUMN "hasTimingOffset" BOOLEAN NOT NULL DEFAULT false');
  } catch(error) {
   // Another bootstrap (or an SQLite schema-change retry) may have added it
   // after PRAGMA. Only this exact already-existing column is safe to accept.
   if(!/duplicate column name:\s*hasTimingOffset|column.*hasTimingOffset.*already exists/i.test(String((error as Error).message)))throw error;
  }
  // Legacy nonzero offsets were explicit. A legacy zero is indistinguishable from the old default.
  await prisma.$executeRawUnsafe('UPDATE "PersonalTrack" SET "hasTimingOffset"=true WHERE "offset" <> 0');
 }
 // Per-source timing offsets (JSON {source: seconds}); absent means the track-wide offset applies.
 if(!personalColumns.some(c=>c.name==='sourceOffsets')){
  try{await prisma.$executeRawUnsafe('ALTER TABLE "PersonalTrack" ADD COLUMN "sourceOffsets" TEXT');}
  catch(error){if(!/duplicate column name:\s*sourceOffsets|column.*sourceOffsets.*already exists/i.test(String((error as Error).message)))throw error;}
 }
 // Older builds used username as primary key and userId as the binding.
 const betaColumns=pg?await prisma.$queryRawUnsafe<Array<{name:string}>>(`SELECT column_name AS name FROM information_schema.columns WHERE table_name='BetaAccess'`):await prisma.$queryRawUnsafe<Array<{name:string}>>('PRAGMA table_info("BetaAccess")');
 const betaPresent=new Set(betaColumns.map(c=>c.name));
 for(const [name,definition] of Object.entries({id:'TEXT',telegramUserId:'TEXT',enabled:'BOOLEAN NOT NULL DEFAULT true',updatedAt:date,approvalNotificationId:'TEXT',approvalNotificationState:"TEXT NOT NULL DEFAULT 'none'"}))if(!betaPresent.has(name)){
  // A concurrent bootstrap may add the same column after the column list was read; only that error is safe to accept.
  try{await prisma.$executeRawUnsafe(`ALTER TABLE "BetaAccess" ADD COLUMN "${name}" ${definition}`);}
  catch(error){if(!new RegExp(`duplicate column name:\\s*${name}|column.*${name}.*already exists`,'i').test(String((error as Error).message)))throw error;}
 }
 await prisma.$executeRawUnsafe(`UPDATE "BetaAccess" SET "id"='legacy:' || "username" WHERE "id" IS NULL`);
 if(betaPresent.has('userId'))await prisma.$executeRawUnsafe('UPDATE "BetaAccess" SET "telegramUserId"="userId" WHERE "telegramUserId" IS NULL AND "userId" IS NOT NULL');
 await prisma.$executeRawUnsafe('UPDATE "BetaAccess" SET "updatedAt"="createdAt" WHERE "updatedAt" IS NULL');
 await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "BetaAccess_id_key" ON "BetaAccess"("id")');
 await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "TelegramBotContact_username_key" ON "TelegramBotContact"("username")');
 for(const [table,columns,unique] of [['BetaAccess',['username'],true],['BetaAccess',['telegramUserId'],true],['PersonalTrack',['userId','trackId'],true],['UserFile',['userId','trackId'],false],['UserReport',['userId','requestId'],true],['UserReport',['status','createdAt'],false],['ReleaseExport',['userId','requestId'],true],['ReleaseExport',['userId','releaseId','createdAt'],false]] as [string,string[],boolean][]){
  await prisma.$executeRawUnsafe(`CREATE ${unique?'UNIQUE ':''}INDEX IF NOT EXISTS "${table}_${columns.join('_')}_${unique?'key':'idx'}" ON "${table}"(${columns.map(c=>`"${c}"`).join(',')})`);
 }
 // Rebuild the binding index after upgrading legacy SQLite layouts. Some old
 // databases retain an index entry inconsistent with their newly added column.
 if(!pg&&!betaPresent.has('telegramUserId'))await prisma.$executeRawUnsafe('REINDEX "BetaAccess_telegramUserId_key"');
 if(pg)await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3)');
 else{const columns=await prisma.$queryRawUnsafe<Array<{name:string}>>('PRAGMA table_info("User")');if(!columns.some(c=>c.name==='lastActiveAt'))await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN "lastActiveAt" DATETIME');}
 // An interrupted transfer has an unknown delivery result: never silently retry it.
 await prisma.releaseExport.updateMany({where:{status:'preparing'},data:{status:'interrupted',result:JSON.stringify({unavailable:[],delivery:'unknown',message:'Подготовка прервана перезапуском. Проверьте чат бота перед новой отправкой.'})}});
}
