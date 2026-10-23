import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
try{
 const sqlite=(process.env.DATABASE_URL||'file:./dev.db').startsWith('file:');
 const columns=sqlite?await db.$queryRawUnsafe('PRAGMA table_info("Playlist")'):await db.$queryRawUnsafe(`SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'Playlist'`);
 if(!columns.some(c=>c.name==='isPublic')){
  await db.$executeRawUnsafe('ALTER TABLE "Playlist" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false');
  // Preserve playlists the owner already explicitly published to their profile.
  await db.$executeRawUnsafe('UPDATE "Playlist" SET "isPublic" = true WHERE "id" IN (SELECT "playlistId" FROM "ProfilePlaylist")');
 }
 console.log('Playlist visibility schema ready');
}finally{await db.$disconnect();}
