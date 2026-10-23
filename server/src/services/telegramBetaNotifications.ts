import {randomUUID} from 'node:crypto';
import {env} from '../config/env.js';
import {prisma} from '../database/client.js';
import {logger} from '../utils/logger.js';
import {checkBetaAccess} from './telegramBeta.js';
import {BotApiError,Msg,sendBanner} from './telegramBotApi.js';
import {cabinetLinks} from './telegramCabinet.js';

const normalizedUsername=(value?:string|null)=>{
 const username=value?.replace(/^@/,'').toLowerCase();
 return username&&/^[a-z0-9_]{5,32}$/.test(username)?username:null;
};
const logFailure=(error:unknown)=>logger.warn({reason:error instanceof Error?error.message:String(error),event:'telegram.beta.notification_failed'},'Beta approval notification failed');

/** A grant has a durable notification generation; adding an already active username is a no-op. */
export async function grantBetaAccess(username:string){
 return prisma.$transaction(async tx=>{
  const notificationId=randomUUID();
  const item=await tx.betaAccess.upsert({where:{username},create:{username,approvalNotificationId:notificationId,approvalNotificationState:'pending'},update:{}});
  if(item.enabled)return item;
  // Compare-and-set keeps simultaneous re-enables in the same notification generation.
  await tx.betaAccess.updateMany({where:{id:item.id,enabled:false},data:{enabled:true,approvalNotificationId:notificationId,approvalNotificationState:'pending'}});
  return tx.betaAccess.findUniqueOrThrow({where:{id:item.id}});
 });
}

/** Only call for a verified sender in the bot's private chat, including before beta access is granted. */
export async function registerBetaBotContact(userId:string,verifiedUsername?:string|null):Promise<void>{
 if(!/^telegram:\d+$/.test(userId))return;
 const username=normalizedUsername(verifiedUsername);
 await prisma.$transaction(async tx=>{
  // Telegram usernames can move to another account. A username is only a current lookup;
  // an already bound BetaAccess.telegramUserId is never reassigned.
  if(username)await tx.telegramBotContact.updateMany({where:{username,userId:{not:userId}},data:{username:null}});
  await tx.telegramBotContact.upsert({where:{userId},create:{userId,username},update:{username}});
 });
 const bound=await prisma.betaAccess.findUnique({where:{telegramUserId:userId}});
 const item=bound||(username?await prisma.betaAccess.findUnique({where:{username}}):null);
 if(item?.enabled&&(!item.telegramUserId||item.telegramUserId===userId)&&item.approvalNotificationState==='pending')void notifyBetaApproval(item.id).catch(logFailure);
}

async function approvalRecipient(username:string){
 const contact=await prisma.telegramBotContact.findUnique({where:{username}});
 if(contact)return contact;
 // Older Mini App visitors already have a Telegram-verified username in User.
 // LOWER is portable across SQLite/Postgres; bind the value as a query parameter.
 const users=await prisma.$queryRaw<Array<{id:string;username:string}>>`SELECT "id","username" FROM "User" WHERE LOWER("username")=${username} AND "id" LIKE 'telegram:%' LIMIT 2`;
 if(users.length!==1||!/^telegram:\d+$/.test(users[0].id))return null;
 const knownContact=await prisma.telegramBotContact.findUnique({where:{userId:users[0].id}});
 // A newer bot observation, including a removed username, overrides cached User data.
 if(knownContact&&knownContact.username!==username)return null;
 return {userId:users[0].id,username:users[0].username};
}

/** Sends only to an immutable numeric ID. Unknown delivery results are never retried automatically. */
export async function notifyBetaApproval(accessId:string):Promise<void>{
 if(!env.TELEGRAM_BOT_TOKEN)return;
 try{
  let item=await prisma.betaAccess.findUnique({where:{id:accessId}});
  if(!item?.enabled||!item.approvalNotificationId||item.approvalNotificationState!=='pending')return;
  if(!item.telegramUserId){
   const contact=await approvalRecipient(item.username);
   if(!contact||!await checkBetaAccess(contact.userId,contact.username))return;
   item=await prisma.betaAccess.findUnique({where:{id:accessId}});
  }
  if(!item?.enabled||!item.telegramUserId||!/^telegram:\d+$/.test(item.telegramUserId)||item.approvalNotificationState!=='pending')return;
  const notificationId=item.approvalNotificationId;
  const where={id:item.id,enabled:true,telegramUserId:item.telegramUserId,approvalNotificationId:notificationId,approvalNotificationState:'pending'};
  const claimed=await prisma.betaAccess.updateMany({where,data:{approvalNotificationState:'sending'}});
  if(!claimed.count)return;
  let state='sent';
  try{
   await sendBanner(item.telegramUserId.slice(9),'beta-approved',new Msg().e('check').t(' ').b('Вы одобрены на бету Осколка!').n(2).t('Доступ открыт. Войдите через свой Telegram-аккаунт и начинайте слушать.'),{inline_keyboard:[[{text:'Открыть Осколок',url:cabinetLinks.site}]]});
  }catch(error){
   // An explicit 4xx means Telegram rejected the request (e.g. the bot is blocked).
   // A timeout/5xx can arrive after delivery: retrying could send the same approval twice.
   state=error instanceof BotApiError&&error.code>=400&&error.code<500?'pending':'unknown';
   logFailure(error);
  }
  await prisma.betaAccess.updateMany({where:{id:item.id,approvalNotificationId:notificationId,approvalNotificationState:'sending'},data:{approvalNotificationState:state}});
 }catch(error){logFailure(error);}
}
