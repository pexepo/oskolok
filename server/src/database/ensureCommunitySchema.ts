import {prisma} from './client.js';
/** Additive DDL for unreleased uploads, artist follows, friends and notifications (SQLite + Postgres). */
export async function ensureCommunitySchema(){
 const pg=String(process.env.DATABASE_URL||'').startsWith('postgres'),date=pg?'TIMESTAMP(3)':'DATETIME';
 const tables:Record<string,string>={
  UnreleasedTrack:`"id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"title" TEXT NOT NULL,"artistName" TEXT NOT NULL,"artistKey" TEXT NOT NULL,"artistId" TEXT,"audioFileId" TEXT NOT NULL,"coverFileId" TEXT,"kind" TEXT NOT NULL DEFAULT 'leak',"source" TEXT NOT NULL DEFAULT '',"description" TEXT NOT NULL DEFAULT '',"duration" INTEGER NOT NULL DEFAULT 0,"status" TEXT NOT NULL DEFAULT 'pending',"reviewNote" TEXT NOT NULL DEFAULT '',"reviewedAt" ${date},"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  Friendship:`"id" TEXT NOT NULL PRIMARY KEY,"requesterId" TEXT NOT NULL,"addresseeId" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'pending',"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  ArtistFollow:`"id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"artistKey" TEXT NOT NULL,"artistId" TEXT,"name" TEXT NOT NULL,"avatar" TEXT,"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  ArtistReleaseWatch:`"artistKey" TEXT NOT NULL PRIMARY KEY,"artistId" TEXT,"name" TEXT NOT NULL,"knownIds" TEXT NOT NULL DEFAULT '[]',"checkedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  UserNotification:`"id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"kind" TEXT NOT NULL,"title" TEXT NOT NULL,"body" TEXT NOT NULL DEFAULT '',"url" TEXT,"artworkUrl" TEXT,"dedupeKey" TEXT NOT NULL,"readAt" ${date},"deliveredAt" ${date},"createdAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP`,
 };
 for(const [name,columns] of Object.entries(tables))await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${name}" (${columns})`);
 for(const [table,columns,unique] of [['UnreleasedTrack',['status','artistKey'],false],['UnreleasedTrack',['userId','createdAt'],false],['ArtistFollow',['userId','artistKey'],true],['Friendship',['requesterId','addresseeId'],true],['Friendship',['addresseeId','status'],false],['ArtistFollow',['artistKey'],false],['UserNotification',['userId','dedupeKey'],true],['UserNotification',['userId','createdAt'],false]] as [string,string[],boolean][])
  await prisma.$executeRawUnsafe(`CREATE ${unique?'UNIQUE ':''}INDEX IF NOT EXISTS "${table}_${columns.join('_')}_${unique?'key':'idx'}" ON "${table}"(${columns.map(c=>`"${c}"`).join(',')})`);
}
