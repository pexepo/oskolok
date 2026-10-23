// Local QA only: creates a throwaway test user + web session in the dev DB.
// The token is written to .dev-session.local (gitignored), never printed.
import {PrismaClient} from '@prisma/client';
import {randomBytes,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
if(!/^file:/.test(process.env.DATABASE_URL||'file:'))throw new Error('Refusing to run against a non-local database');
const prisma=new PrismaClient(),id='telegram:900000001',token=randomBytes(32).toString('base64url');
await prisma.user.upsert({where:{id},create:{id,name:'QA Tester',username:'qa_tester_local'},update:{}});
await prisma.betaAccess.upsert({where:{username:'qa_tester_local'},create:{username:'qa_tester_local',telegramUserId:id,enabled:true},update:{telegramUserId:id,enabled:true}});
await prisma.webSession.create({data:{tokenHash:createHash('sha256').update(token).digest('hex'),userId:id,expiresAt:new Date(Date.now()+7*864e5)}});
writeFileSync('.dev-session.local',token);
await prisma.$disconnect();
console.log('dev session ready');
