import {prisma} from '../database/client.js';
export const BETA_DENIED_MESSAGE='Проект находится в стадии бета-тестирования. У вас нету к нему доступа';
/** Only call with a username verified by Telegram, never a form field. A binding survives renames/revocation. */
export async function checkBetaAccess(userId:string,verifiedUsername?:string|null):Promise<boolean>{
  const bound=await prisma.betaAccess.findUnique({where:{telegramUserId:userId}});
  if(bound)return bound.enabled;
  const username=verifiedUsername?.replace(/^@/,'').toLowerCase();
  if(!username)return false;
  const access=await prisma.betaAccess.findUnique({where:{username}});
  if(!access?.enabled||access.telegramUserId&&access.telegramUserId!==userId)return false;
  // Compare-and-set prevents simultaneous logins claiming the same invitation.
  const result=await prisma.betaAccess.updateMany({where:{id:access.id,enabled:true,telegramUserId:null},data:{telegramUserId:userId}});
  if(result.count)return true;
  return !!await prisma.betaAccess.findFirst({where:{id:access.id,enabled:true,telegramUserId:userId}});
}

export async function seedBetaAccess(){
  const usernames=String(process.env.TELEGRAM_BETA_USERNAMES||'').split(',').map(v=>v.trim().replace(/^@/,'').toLowerCase()).filter(v=>/^[a-z0-9_]{5,32}$/.test(v));
  for(const username of usernames)await prisma.betaAccess.upsert({where:{username},create:{username,enabled:true},update:{}});
}
