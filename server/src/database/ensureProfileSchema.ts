import {ensureUserContentSchema} from './ensureUserContentSchema.js';
import {ensureTelegramSchema} from './ensureTelegramSchema.js';
import {ensureCommunitySchema} from './ensureCommunitySchema.js';
import {ensureTelemetrySchema} from './ensureTelemetrySchema.js';
import {ensureBetaSchema} from './ensureBetaSchema.js';
import {prisma} from './client.js';
import {seedDefaultRoles} from '../services/roles.js';

const CUSTOM_COLUMNS:Record<string,string>={accentColor:'TEXT',profileTheme:"TEXT NOT NULL DEFAULT 'default'",pronouns:"TEXT NOT NULL DEFAULT ''",location:"TEXT NOT NULL DEFAULT ''",statusEmoji:"TEXT NOT NULL DEFAULT ''",statusText:"TEXT NOT NULL DEFAULT ''",socialLinks:"TEXT NOT NULL DEFAULT '[]'",profileVisibility:"TEXT NOT NULL DEFAULT '{}'"};
const roleTables=(date:string)=>[
 `CREATE TABLE IF NOT EXISTS "Role" ("id" TEXT NOT NULL PRIMARY KEY,"key" TEXT,"name" TEXT NOT NULL,"color" TEXT NOT NULL DEFAULT '#9cbeff',"icon" TEXT NOT NULL DEFAULT '',"description" TEXT NOT NULL DEFAULT '',"position" INTEGER NOT NULL DEFAULT 0,"hoist" BOOLEAN NOT NULL DEFAULT true,"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
 'CREATE UNIQUE INDEX IF NOT EXISTS "Role_key_key" ON "Role"("key")',
 'CREATE INDEX IF NOT EXISTS "Role_position_idx" ON "Role"("position")',
 `CREATE TABLE IF NOT EXISTS "UserRole" ("userId" TEXT NOT NULL,"roleId" TEXT NOT NULL,"assignedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY ("userId","roleId"))`,
 'CREATE INDEX IF NOT EXISTS "UserRole_roleId_idx" ON "UserRole"("roleId")',
 `CREATE TABLE IF NOT EXISTS "AdminAuditLog" ("id" TEXT NOT NULL PRIMARY KEY,"action" TEXT NOT NULL,"target" TEXT NOT NULL DEFAULT '',"details" TEXT NOT NULL DEFAULT '',"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
 'CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt")',
 // Rewards: achievement tiers and medals (server/src/services/rewards.ts).
 `CREATE TABLE IF NOT EXISTS "UserAchievement" ("userId" TEXT NOT NULL,"achievementId" TEXT NOT NULL,"tier" INTEGER NOT NULL,"unlockedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP,"seenAt" ${date},PRIMARY KEY ("userId","achievementId","tier"))`,
 'CREATE INDEX IF NOT EXISTS "UserAchievement_userId_unlockedAt_idx" ON "UserAchievement"("userId","unlockedAt")',
 `CREATE TABLE IF NOT EXISTS "UserMedal" ("id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"medalId" TEXT NOT NULL,"note" TEXT NOT NULL DEFAULT '',"awardedBy" TEXT NOT NULL DEFAULT 'admin',"awardedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP,"revokedAt" ${date},"seenAt" ${date})`,
 'CREATE UNIQUE INDEX IF NOT EXISTS "UserMedal_userId_medalId_key" ON "UserMedal"("userId","medalId")',
 'CREATE INDEX IF NOT EXISTS "UserMedal_medalId_idx" ON "UserMedal"("medalId")',
];


async function ensurePlaylistVisibility(pg:boolean){
 const columns=pg?await prisma.$queryRawUnsafe<Array<{name:string}>>(`SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'Playlist'`):await prisma.$queryRawUnsafe<Array<{name:string}>>('PRAGMA table_info("Playlist")');
 if(!columns.some(c=>c.name==='isPublic')){
  await prisma.$executeRawUnsafe('ALTER TABLE "Playlist" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false');
  await prisma.$executeRawUnsafe('UPDATE "Playlist" SET "isPublic" = true WHERE "id" IN (SELECT "playlistId" FROM "ProfilePlaylist")');
 }
}

/** Additive bootstrap for databases created by earlier desktop releases. */
export async function ensureProfileSchema(){
 await ensureUserContentSchema();
 await ensureTelegramSchema();
 await ensureCommunitySchema();
 await ensureTelemetrySchema();
 await ensureBetaSchema();
 const pg=String(process.env.DATABASE_URL||'').startsWith('postgres');
 if(pg){
  for(const sql of [
   'ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "telegramFullIntegration" BOOLEAN NOT NULL DEFAULT true',
   'ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "currentTrackData" TEXT',
   'ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "playbackSeenAt" TIMESTAMP(3)',
   'ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "playbackSessionId" TEXT',
   'ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "telegramSyncError" TEXT',
   'ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "telegramStatusTemplate" TEXT',
   'CREATE TABLE IF NOT EXISTS "ProfilePlaylist" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"playlistId" TEXT NOT NULL,"title" TEXT NOT NULL,"artworkUrl" TEXT,"tracksData" TEXT NOT NULL,"addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)',
   'CREATE UNIQUE INDEX IF NOT EXISTS "ProfilePlaylist_userId_playlistId_key" ON "ProfilePlaylist"("userId","playlistId")',
   'CREATE INDEX IF NOT EXISTS "ProfilePlaylist_userId_addedAt_idx" ON "ProfilePlaylist"("userId","addedAt")',
   'CREATE TABLE IF NOT EXISTS "TelegramNowPlaying" ("userId" TEXT PRIMARY KEY,"operationState" TEXT NOT NULL DEFAULT \'idle\',"trackId" TEXT,"documentId" TEXT,"accessHash" TEXT,"fileReference" TEXT,"desiredTrackId" TEXT,"seenAt" TIMESTAMP(3),"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)',
   'ALTER TABLE "TelegramNowPlaying" ADD COLUMN IF NOT EXISTS "operationState" TEXT NOT NULL DEFAULT \'idle\'',
   'CREATE TABLE IF NOT EXISTS "MusicAccountToken" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"provider" TEXT NOT NULL,"encryptedData" TEXT NOT NULL,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)',
   'CREATE UNIQUE INDEX IF NOT EXISTS "MusicAccountToken_userId_provider_key" ON "MusicAccountToken"("userId","provider")',
   ...Object.entries(CUSTOM_COLUMNS).map(([name,definition])=>`ALTER TABLE "CreatorProfile" ADD COLUMN IF NOT EXISTS "${name}" ${definition}`),
   ...roleTables('TIMESTAMP(3)'),
  ])await prisma.$executeRawUnsafe(sql);
  await ensurePlaylistVisibility(true);
  await seedDefaultRoles();
  return;
 }
 const columns=await prisma.$queryRawUnsafe<Array<{name:string}>>('PRAGMA table_info("CreatorProfile")');
 const present=new Set(columns.map(c=>c.name));
 for(const [name,definition] of Object.entries({telegramFullIntegration:'BOOLEAN NOT NULL DEFAULT 1',currentTrackData:'TEXT',playbackSeenAt:'DATETIME',playbackSessionId:'TEXT',telegramSyncError:'TEXT',telegramStatusTemplate:'TEXT',...CUSTOM_COLUMNS})){
  if(!present.has(name))await prisma.$executeRawUnsafe(`ALTER TABLE "CreatorProfile" ADD COLUMN "${name}" ${definition}`);
 }
 for(const sql of [
  'CREATE TABLE IF NOT EXISTS "ProfilePlaylist" ("id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"playlistId" TEXT NOT NULL,"title" TEXT NOT NULL,"artworkUrl" TEXT,"tracksData" TEXT NOT NULL,"addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  'CREATE UNIQUE INDEX IF NOT EXISTS "ProfilePlaylist_userId_playlistId_key" ON "ProfilePlaylist"("userId","playlistId")',
  'CREATE INDEX IF NOT EXISTS "ProfilePlaylist_userId_addedAt_idx" ON "ProfilePlaylist"("userId","addedAt")',
  'CREATE TABLE IF NOT EXISTS "TelegramNowPlaying" ("userId" TEXT NOT NULL PRIMARY KEY,"operationState" TEXT NOT NULL DEFAULT \'idle\',"trackId" TEXT,"documentId" TEXT,"accessHash" TEXT,"fileReference" TEXT,"desiredTrackId" TEXT,"seenAt" DATETIME,"updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  'CREATE TABLE IF NOT EXISTS "MusicAccountToken" ("id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"provider" TEXT NOT NULL,"encryptedData" TEXT NOT NULL,"updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  'CREATE UNIQUE INDEX IF NOT EXISTS "MusicAccountToken_userId_provider_key" ON "MusicAccountToken"("userId","provider")',
  ...roleTables('DATETIME'),
 ])await prisma.$executeRawUnsafe(sql);
 const nowPlayingColumns=await prisma.$queryRawUnsafe<Array<{name:string}>>('PRAGMA table_info("TelegramNowPlaying")');
 if(!nowPlayingColumns.some(c=>c.name==='operationState'))await prisma.$executeRawUnsafe('ALTER TABLE "TelegramNowPlaying" ADD COLUMN "operationState" TEXT NOT NULL DEFAULT \'idle\'');
 await ensurePlaylistVisibility(false);
 await seedDefaultRoles();
}
