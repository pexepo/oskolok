import {prisma} from './client.js';
/** Additive DDL for site beta applications, site settings and published builds (SQLite + Postgres).
 * Only new tables and indexes: the previous release ignores them, so a program rollback needs no data rollback. */
export async function ensureBetaSchema(){
 const pg=String(process.env.DATABASE_URL||'').startsWith('postgres'),date=pg?'TIMESTAMP(3)':'DATETIME',serial=pg?'SERIAL NOT NULL PRIMARY KEY':'INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT';
 const tables:Record<string,string>={
  BetaApplication:`"id" ${serial},"telegramUsername" TEXT NOT NULL,"telegramUserId" TEXT,"verifiedUsername" TEXT,"purpose" TEXT NOT NULL,"about" TEXT NOT NULL,"platforms" TEXT NOT NULL DEFAULT '[]',"status" TEXT NOT NULL DEFAULT 'pending',"statusTokenHash" TEXT NOT NULL,"verifyTokenHash" TEXT,"verifyExpiresAt" ${date},"verifiedAt" ${date},"sourceHash" TEXT NOT NULL DEFAULT '',"adminNotifyState" TEXT NOT NULL DEFAULT 'none',"adminMessages" TEXT NOT NULL DEFAULT '[]',"userNotifyState" TEXT NOT NULL DEFAULT 'none',"userNotifyAttempts" INTEGER NOT NULL DEFAULT 0,"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" ${date} NOT NULL,"reviewedAt" ${date},"reviewedBy" TEXT,"rejectionReason" TEXT,"adminComment" TEXT`,
  BetaApplicationEvent:`"id" TEXT NOT NULL PRIMARY KEY,"applicationId" INTEGER NOT NULL,"type" TEXT NOT NULL,"actor" TEXT NOT NULL DEFAULT '',"data" TEXT NOT NULL DEFAULT '{}',"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  SiteSetting:`"key" TEXT NOT NULL PRIMARY KEY,"value" TEXT NOT NULL,"updatedBy" TEXT,"updatedAt" ${date} NOT NULL`,
  AppRelease:`"id" TEXT NOT NULL PRIMARY KEY,"platform" TEXT NOT NULL,"variant" TEXT NOT NULL DEFAULT '',"label" TEXT NOT NULL DEFAULT '',"version" TEXT NOT NULL,"buildNumber" INTEGER NOT NULL DEFAULT 0,"releaseDate" ${date} NOT NULL,"changelog" TEXT NOT NULL DEFAULT '',"fileName" TEXT NOT NULL,"fileSize" INTEGER NOT NULL DEFAULT 0,"checksum" TEXT NOT NULL DEFAULT '',"availability" TEXT NOT NULL DEFAULT 'available',"betaOnly" BOOLEAN NOT NULL DEFAULT false,"storage" TEXT NOT NULL DEFAULT 'public',"requirements" TEXT NOT NULL DEFAULT '',"active" BOOLEAN NOT NULL DEFAULT true,"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" ${date} NOT NULL`,
 };
 for(const [name,columns] of Object.entries(tables))await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${name}" (${columns})`);
 const indexes:Array<[string,string,string[],boolean?]>=[
  ['BetaApplication_statusTokenHash_key','BetaApplication',['statusTokenHash'],true],
  ['BetaApplication_verifyTokenHash_key','BetaApplication',['verifyTokenHash'],true],
  ['BetaApplication_telegramUsername_idx','BetaApplication',['telegramUsername']],
  ['BetaApplication_telegramUserId_idx','BetaApplication',['telegramUserId']],
  ['BetaApplication_status_idx','BetaApplication',['status']],
  ['BetaApplication_createdAt_idx','BetaApplication',['createdAt']],
  ['BetaApplicationEvent_applicationId_idx','BetaApplicationEvent',['applicationId']],
  ['AppRelease_platform_active_idx','AppRelease',['platform','active']],
  ['AppRelease_platform_variant_version_key','AppRelease',['platform','variant','version'],true],
 ];
 for(const [name,table,columns,unique] of indexes)await prisma.$executeRawUnsafe(`CREATE ${unique?'UNIQUE ':''}INDEX IF NOT EXISTS "${name}" ON "${table}"(${columns.map(c=>`"${c}"`).join(',')})`);
 // One active (pending/approved) application per confirmed Telegram account, enforced by the database
 // itself so two simultaneous confirmations cannot both win.
 await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "BetaApplication_active_telegram_key" ON "BetaApplication"("telegramUserId") WHERE "telegramUserId" IS NOT NULL AND "status" IN ('pending','approved')`);
}
