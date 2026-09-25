import {prisma} from './client.js';

/** Additive bootstrap for databases created by earlier desktop releases. */
export async function ensureProfileSchema(){
 const pg=String(process.env.DATABASE_URL||'').startsWith('postgres');
 if(pg){
  for(const sql of [
   'ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "telegramFullIntegration" BOOLEAN NOT NULL DEFAULT true',
   'ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "currentTrackData" TEXT',
   'ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "playbackSeenAt" TIMESTAMP(3)',
   'ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "playbackSessionId" TEXT',
   'ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "telegramSyncError" TEXT',
   'CREATE TABLE IF NOT EXISTS "ProfilePlaylist" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"playlistId" TEXT NOT NULL,"title" TEXT NOT NULL,"artworkUrl" TEXT,"tracksData" TEXT NOT NULL,"addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)',
   'CREATE UNIQUE INDEX IF NOT EXISTS "ProfilePlaylist_userId_playlistId_key" ON "ProfilePlaylist"("userId","playlistId")',
   'CREATE INDEX IF NOT EXISTS "ProfilePlaylist_userId_addedAt_idx" ON "ProfilePlaylist"("userId","addedAt")',
   'CREATE TABLE IF NOT EXISTS "TelegramNowPlaying" ("userId" TEXT PRIMARY KEY,"operationState" TEXT NOT NULL DEFAULT \'idle\',"trackId" TEXT,"documentId" TEXT,"accessHash" TEXT,"fileReference" TEXT,"desiredTrackId" TEXT,"seenAt" TIMESTAMP(3),"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)',
   'ALTER TABLE "TelegramNowPlaying" ADD COLUMN IF NOT EXISTS "operationState" TEXT NOT NULL DEFAULT \'idle\'',
   'CREATE TABLE IF NOT EXISTS "MusicAccountToken" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"provider" TEXT NOT NULL,"encryptedData" TEXT NOT NULL,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)',
   'CREATE UNIQUE INDEX IF NOT EXISTS "MusicAccountToken_userId_provider_key" ON "MusicAccountToken"("userId","provider")',
  ])await prisma.$executeRawUnsafe(sql);
  return;
 }
 const columns=await prisma.$queryRawUnsafe<Array<{name:string}>>('PRAGMA table_info("CreatorProfile")');
 const present=new Set(columns.map(c=>c.name));
 for(const [name,definition] of Object.entries({telegramFullIntegration:'BOOLEAN NOT NULL DEFAULT 1',currentTrackData:'TEXT',playbackSeenAt:'DATETIME',playbackSessionId:'TEXT',telegramSyncError:'TEXT'})){
  if(!present.has(name))await prisma.$executeRawUnsafe(`ALTER TABLE "CreatorProfile" ADD COLUMN "${name}" ${definition}`);
 }
 for(const sql of [
  'CREATE TABLE IF NOT EXISTS "ProfilePlaylist" ("id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"playlistId" TEXT NOT NULL,"title" TEXT NOT NULL,"artworkUrl" TEXT,"tracksData" TEXT NOT NULL,"addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  'CREATE UNIQUE INDEX IF NOT EXISTS "ProfilePlaylist_userId_playlistId_key" ON "ProfilePlaylist"("userId","playlistId")',
  'CREATE INDEX IF NOT EXISTS "ProfilePlaylist_userId_addedAt_idx" ON "ProfilePlaylist"("userId","addedAt")',
  'CREATE TABLE IF NOT EXISTS "TelegramNowPlaying" ("userId" TEXT NOT NULL PRIMARY KEY,"operationState" TEXT NOT NULL DEFAULT \'idle\',"trackId" TEXT,"documentId" TEXT,"accessHash" TEXT,"fileReference" TEXT,"desiredTrackId" TEXT,"seenAt" DATETIME,"updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  'CREATE TABLE IF NOT EXISTS "MusicAccountToken" ("id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"provider" TEXT NOT NULL,"encryptedData" TEXT NOT NULL,"updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  'CREATE UNIQUE INDEX IF NOT EXISTS "MusicAccountToken_userId_provider_key" ON "MusicAccountToken"("userId","provider")',
 ])await prisma.$executeRawUnsafe(sql);
 const nowPlayingColumns=await prisma.$queryRawUnsafe<Array<{name:string}>>('PRAGMA table_info("TelegramNowPlaying")');
 if(!nowPlayingColumns.some(c=>c.name==='operationState'))await prisma.$executeRawUnsafe('ALTER TABLE "TelegramNowPlaying" ADD COLUMN "operationState" TEXT NOT NULL DEFAULT \'idle\'');
}
