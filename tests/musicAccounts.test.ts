import { describe,it,expect } from 'vitest';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { musicAccountCallback, musicAccountError, saveOAuthAttempt, takeOAuthAttempt } from '../server/src/controllers/musicAccounts.js';
import { prisma } from '../server/src/database/client.js';
describe('music OAuth callback',()=>{
 it('rejects an unsolicited callback before exchanging a code',async()=>{
  const app=express();app.use('/auth',musicAccountCallback);const server=app.listen(0,'127.0.0.1');
  try{await new Promise<void>(r=>server.once('listening',r));const address=server.address() as any;const res=await fetch(`http://127.0.0.1:${address.port}/auth/spotify/callback?code=fake&state=unknown`);expect(res.status).toBe(400);expect(res.headers.get('content-type')).toContain('text/html');expect(await res.text()).toContain('устарела');}
  finally{await new Promise<void>(r=>server.close(()=>r()));}
 });
 it('keeps a pending login in the database and consumes it only once',async()=>{
  const state=randomBytes(32).toString('base64url');
  const user=`oauth-test:${randomBytes(8).toString('hex')}`;
  const attempt={user,provider:'spotify' as const,verifier:'test-verifier',redirect:'https://example.test/api/music-accounts/spotify/callback',expires:Date.now()+60000};
  try{
   await saveOAuthAttempt(state,attempt);
   expect(await takeOAuthAttempt(state,'spotify')).toEqual(attempt);
   expect(await takeOAuthAttempt(state,'spotify')).toBeNull();
  }finally{
   await prisma.musicAccountToken.deleteMany({where:{userId:user}});
  }
 });
});
describe('Spotify access errors',()=>{
 it('distinguishes a blocked test account from an inaccessible followed playlist',()=>{
  expect(musicAccountError('spotify',403,'/v1/me/playlists')).toContain('Users Management');
  expect(musicAccountError('spotify',403,'/v1/playlists/abc/items')).toContain('соавтор');
  expect(musicAccountError('spotify',429,'/v1/me/playlists')).toContain('ограничил запросы');
 });
});
