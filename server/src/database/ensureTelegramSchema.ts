import {prisma} from './client.js';

/** Additive bootstrap for Telegram playback tables (PlaybackSession, TelegramAudioCache) — SQLite and Postgres. */
export async function ensureTelegramSchema(){
 const pg=String(process.env.DATABASE_URL||'').startsWith('postgres'),date=pg?'TIMESTAMP(3)':'DATETIME',real=pg?'DOUBLE PRECISION':'REAL';
 for(const sql of [
  `CREATE TABLE IF NOT EXISTS "PlaybackSession" ("userId" TEXT NOT NULL PRIMARY KEY,"queueData" TEXT NOT NULL DEFAULT '[]',"queueHash" TEXT NOT NULL DEFAULT '',"currentIndex" INTEGER NOT NULL DEFAULT 0,"positionSec" ${real} NOT NULL DEFAULT 0,"isPlaying" BOOLEAN NOT NULL DEFAULT ${pg?'false':'0'},"mode" TEXT NOT NULL DEFAULT 'app',"clientSessionId" TEXT,"messageId" INTEGER,"aheadMessageId" INTEGER,"updatedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS "TelegramAudioCache" ("trackId" TEXT NOT NULL PRIMARY KEY,"fileId" TEXT NOT NULL,"fileUniqueId" TEXT,"updatedAt" ${date} NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
 ])await prisma.$executeRawUnsafe(sql);
}
