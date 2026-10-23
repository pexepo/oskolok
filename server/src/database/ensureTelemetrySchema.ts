import {prisma} from './client.js';
/** Additive DDL for listening events, consent, ranking versions and import idempotency (SQLite + Postgres).
 * Only new tables: older releases ignore them, so the previous release can still run after a rollback. */
export async function ensureTelemetrySchema(){
 const pg=String(process.env.DATABASE_URL||'').startsWith('postgres'),date=pg?'TIMESTAMP(3)':'DATETIME',bool=pg?'BOOLEAN':'BOOLEAN';
 const tables:Record<string,string>={
  TrackEvent:`"id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"sessionId" TEXT NOT NULL,"type" TEXT NOT NULL,"trackId" TEXT NOT NULL,"artist" TEXT NOT NULL DEFAULT '',"context" TEXT NOT NULL DEFAULT '',"data" TEXT NOT NULL DEFAULT '{}',"schemaVersion" INTEGER NOT NULL DEFAULT 1,"training" ${bool} NOT NULL DEFAULT false,"at" ${date} NOT NULL,"receivedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  UserConsent:`"userId" TEXT NOT NULL PRIMARY KEY,"personalization" ${bool} NOT NULL DEFAULT false,"training" ${bool} NOT NULL DEFAULT false,"version" INTEGER NOT NULL DEFAULT 1,"decidedAt" ${date},"updatedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  RecommendationModel:`"version" TEXT NOT NULL PRIMARY KEY,"params" TEXT NOT NULL,"metrics" TEXT NOT NULL DEFAULT '{}',"active" ${bool} NOT NULL DEFAULT false,"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  PlaylistImportRequest:`"requestId" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"playlistId" TEXT NOT NULL,"chunks" INTEGER NOT NULL DEFAULT 0,"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
 };
 for(const [name,columns] of Object.entries(tables))await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${name}" (${columns})`);
 for(const [table,columns] of [['TrackEvent',['userId','at']],['TrackEvent',['at']],['PlaylistImportRequest',['userId']]] as Array<[string,string[]]>)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${table}_${columns.join('_')}_idx" ON "${table}"(${columns.map(c=>`"${c}"`).join(',')})`);
}
