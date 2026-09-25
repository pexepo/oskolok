import { describe,it,expect } from 'vitest';
import express from 'express';
import { musicAccountCallback } from '../server/src/controllers/musicAccounts.js';
describe('music OAuth callback',()=>{
 it('rejects an unsolicited callback before exchanging a code',async()=>{
  const app=express();app.use('/auth',musicAccountCallback);const server=app.listen(0,'127.0.0.1');
  try{await new Promise<void>(r=>server.once('listening',r));const address=server.address() as any;const res=await fetch(`http://127.0.0.1:${address.port}/auth/spotify/callback?code=fake&state=unknown`);expect(res.status).toBe(400);expect((await res.json()).error.message).toContain('устарела');}
  finally{await new Promise<void>(r=>server.close(()=>r()));}
 });
});
