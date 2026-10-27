import { TelegramClient, Api } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import {CustomFile} from 'teleproto/client/uploads.js';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import bigInt from 'big-integer';
import { prisma } from '../database/client.js';
import { logger } from '../utils/logger.js';
import {signInWithQr} from './telegramQr.js';
import {classifyTelegramError,clearHealth,floodWaitSeconds,getHealth,retry,setHealth,type SessionHealth} from './telegramReliability.js';

const apiId=Number(process.env.TELEGRAM_API_ID||0),apiHash=process.env.TELEGRAM_API_HASH||'';
export const sessionConfigured=!!apiId&&!!apiHash;
const clients=new Map<string,TelegramClient>();
type Login={client?:TelegramClient;method:'qr'|'phone'|'bot';expected?:string;state:string;url?:string;error?:string;userId?:string;passwordHint?:string;password?:(s:string)=>void;rejectPassword?:(e:Error)=>void;code?:(s:string)=>void;rejectCode?:(e:Error)=>void;codeViaApp?:boolean;codeChannel?:CodeChannel;codeLength?:number;codeText?:boolean;emailPattern?:string;nextChannel?:CodeChannel;resendAt?:number;phone?:string;phoneCodeHash?:string;attempts:number;expires:number;botChatId?:string;appUrl?:string;phase?:string;abort?:AbortController;qrExpires?:number};
export type CodeChannel='app'|'sms'|'call'|'email'|'fragment';
const logins=new Map<string,Login>();
const phoneRequests=new Map<string,number[]>();
let botLoginNotifier:((login:Login)=>void)|undefined;
export function setBotLoginNotifier(callback:(login:Login)=>void){botLoginNotifier=callback;}
function setLoginState(l:Login,state:string,error?:string){l.state=state;l.error=error; if(l.method==='bot'&&l.botChatId)botLoginNotifier?.(l);}
function key(){
  const dir=path.resolve(process.env.OSKOLOK_PRIVATE_DIR||'server/data/private');mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,'session.key');
  if(!existsSync(file)){try{writeFileSync(file,randomBytes(32),{mode:0o600,flag:'wx'});}catch(e){if(!existsSync(file))throw e;}}
  const value=readFileSync(file);if(value.length!==32)throw new Error('Некорректный ключ хранилища сессий');return value;
}
export function encryptSession(value:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);return Buffer.concat([iv,c.update(value,'utf8'),c.final(),c.getAuthTag()]).toString('base64');}
function decryptSession(value:string){const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8');}
export const decryptStoredSession=decryptSession;
function client(session=''){return new TelegramClient(new StringSession(session),apiId,apiHash,{connectionRetries:3,retryDelay:1500,deviceModel:'Осколок',appVersion:'1.0',autoReconnect:true});}
export function loginDiagnostic(error:unknown){
  const value=error as {name?:string;message?:string;errorMessage?:string;code?:unknown};
  const redact=(raw:string)=>raw.replace(/(?:tg:\/\/|https?:\/\/)\S+/g,'[url]').replace(/(?:[A-Za-z0-9+/_=-]{24,})/g,'[redacted]').replace(/\+?\d{7,}/g,'[number]');
  return {name:String(value?.name||'Error').slice(0,60),rpc:typeof value?.errorMessage==='string'&&/^[A-Z0-9_]+$/.test(value.errorMessage)?value.errorMessage:undefined,detail:redact(String(value?.message||error).split('\n').find(line=>line.trim())||'Unknown error').slice(0,240)};
}
function loginError(error:unknown){
  const message=`${(error as {errorMessage?:string})?.errorMessage||''} ${error instanceof Error?error.message:String(error)}`;
  if(/API_ID_INVALID|API_ID_PUBLISHED_FLOOD/i.test(message))return 'Telegram отклонил настройки приложения. Проверьте TELEGRAM_API_ID и TELEGRAM_API_HASH на сервере.';
  if(/AUTH_TOKEN_EXPIRED|AUTH_TOKEN_INVALID/i.test(message))return 'QR-код истёк. Покажите новый и отсканируйте его ещё раз.';
  if(/TIMEOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|Connection closed|Connection dropped/i.test(message))return 'Не удалось подключиться к Telegram. Проверьте интернет и попробуйте снова.';
  if(/PHONE_NUMBER_INVALID/i.test(message))return 'Проверьте номер в международном формате.';
  if(/PHONE_NUMBER_FLOOD|PHONE_PASSWORD_FLOOD|FLOOD_WAIT/i.test(message))return 'Telegram ограничил попытки входа. Попробуйте позже.';
  if(/PHONE_CODE_EXPIRED/i.test(message))return 'Срок действия кода истёк. Начните вход заново.';
  if(/PHONE_CODE_INVALID|PHONE_CODE_EMPTY|Code is empty/i.test(message))return 'Неверный код. Проверьте сообщение Telegram и попробуйте снова.';
  if(/PASSWORD_HASH_INVALID/i.test(message))return 'Неверный облачный пароль. Попробуйте снова.';
  if(/PASSWORD_ALGO_UNSUPPORTED|Unsupported password algorithm|bad \/g in password|bad b in check|Undefined srp_b/i.test(message))return 'Telegram не смог проверить облачный пароль. Начните вход заново.';
  if(/EMAIL_UNCONFIRMED|Email verification|login.*email|required.*email/i.test(message))return 'Telegram просит подтвердить почту двухэтапной проверки. Завершите подтверждение в официальном приложении Telegram и попробуйте снова.';
  if(/UPDATE_APP_TO_LOGIN|SEND_CODE_UNAVAILABLE/i.test(message))return 'Telegram не разрешил этот способ входа. Попробуйте QR-вход с другого устройства.';
  const code=loginDiagnostic(error).rpc||message.match(/\b(?:[A-Z][A-Z_]{3,})\b/)?.[0];
  return code?`Telegram не подтвердил вход (${code}). Попробуйте снова.`:'Telegram не подтвердил вход. Попробуйте снова.';
}
/** Лог неудач входа в файл — точный код ошибки воспроизводится только у пользователя. */
export function logLoginFailure(method:string,phase:string|undefined,error:unknown){
  try{appendFileSync('/tmp/oskolok-login-diag.log',JSON.stringify({ts:new Date().toISOString(),method,phase,...loginDiagnostic(error)})+'\n');}catch{}
}
function expireLogin(id:string,l:Login){
  const timer=setTimeout(()=>{if(logins.get(id)===l){logins.delete(id);if(l.state!=='connected'){l.abort?.abort();l.rejectCode?.(new Error('AUTH_USER_CANCEL'));l.rejectPassword?.(new Error('AUTH_USER_CANCEL'));void l.client?.disconnect();}}},300000);
  timer.unref();
}
async function finishLogin(id:string,l:Login,u:Api.TypeUser){
  if(!l.client)throw new Error('Сессия входа не создана.');
  const userId=`telegram:${u.id.toString()}`;
  if(logins.get(id)!==l||Date.now()>l.expires||l.expected&&userId!==l.expected){await l.client.invoke(new Api.auth.LogOut());throw new Error('Подтвердите вход тем же аккаунтом, из которого открыт Осколок.');}
  const name=u instanceof Api.User?[u.firstName,u.lastName].filter(Boolean).join(' ')||'Слушатель':'Слушатель';
  const username=u instanceof Api.User?(u.username||u.usernames?.find(x=>x.active)?.username||null):null;
  const avatarUrl=await downloadAvatar(l.client).catch(()=>null);
  await prisma.user.upsert({where:{id:userId},create:{id:userId,name,username,avatarUrl},update:{name,username,...(avatarUrl?{avatarUrl}:{})}});
  await prisma.creatorProfile.upsert({where:{userId},create:{userId,displayName:name},update:{}});
  await prisma.telegramConnection.upsert({where:{userId},create:{userId,encryptedSession:encryptSession(String(l.client.session.save()))},update:{encryptedSession:encryptSession(String(l.client.session.save()))}});
  const old=clients.get(userId);if(old&&old!==l.client)await old.disconnect().catch(()=>{});clients.set(userId,l.client);setHealth(userId,'connected');l.userId=userId;setLoginState(l,'connected');
}
export async function beginLogin(expected?:string){
  if(!sessionConfigured)throw new Error('Добавьте TELEGRAM_API_ID и TELEGRAM_API_HASH в .env и перезапустите сервер.');
  if(logins.size>=20)throw new Error('Слишком много попыток входа. Попробуйте позже.');
  const id=randomBytes(32).toString('hex'),c=client(),l:Login={client:c,method:'qr',expected,state:'connecting',attempts:0,expires:Date.now()+300000,abort:new AbortController()};logins.set(id,l);
  expireLogin(id,l);
  void (async()=>{
    try{
      l.phase='connect';await c.connect();
      l.phase='qr_handshake';
      const u=await signInWithQr(c,{apiId,apiHash},{signal:l.abort!.signal,qrCode:async q=>{l.url=`tg://login?token=${q.token.toString('base64url')}`;l.qrExpires=q.expires*1000;l.state='qr';},password:async(hint)=>{l.passwordHint=hint||undefined;l.state='password';return new Promise<string>((resolve,reject)=>{l.password=resolve;l.rejectPassword=reject;});},onError:async(error)=>{
        if(logins.get(id)!==l||Date.now()>l.expires)return true;
        l.attempts++;l.error=loginError(error);
        return l.attempts>=5||!/PASSWORD_HASH_INVALID|Password is empty/i.test(`${(error as {errorMessage?:string}).errorMessage||''} ${error.message}`);
      }});
      l.phase='save_session';await finishLogin(id,l,u);
    }catch(e){
      if(logins.get(id)===l){
        const message=e instanceof Error?e.message:String(e);
        const code=message.match(/\b(?:[A-Z][A-Z_]{3,}|P\d{4})\b/)?.[0]||'QR_LOGIN_FAILED';
        logger.warn({method:'qr',code,phase:l.phase,...loginDiagnostic(e)},'Telegram login failed');
        logLoginFailure('qr',l.phase,e);
        setLoginState(l,'error',message.startsWith('Подтвердите')?message:l.error||loginError(e));
      }
      await c.disconnect();
    }
  })();return id;
}
export function cancelLogin(id:string|undefined){
  if(!id)return;
  const l=logins.get(id);if(!l)return;
  logins.delete(id);
  l.abort?.abort();
  l.rejectCode?.(new Error('AUTH_USER_CANCEL'));
  l.rejectPassword?.(new Error('AUTH_USER_CANCEL'));
  if(l.state!=='connected')void l.client?.disconnect();
}
function validatePhone(rawPhone:string){
  if(!sessionConfigured)throw new Error('Добавьте TELEGRAM_API_ID и TELEGRAM_API_HASH в .env и перезапустите сервер.');
  const phone=rawPhone.replace(/[\s()-]/g,'');
  if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error('Введите номер в международном формате: +375…');
  const phoneKey=createHash('sha256').update(phone).digest('hex'),now=Date.now();
  for(const [key,times] of phoneRequests)if(times.every(time=>now-time>=900000))phoneRequests.delete(key);
  const recent=(phoneRequests.get(phoneKey)||[]).filter(time=>now-time<900000);
  if(recent.length>=3)throw new Error('Слишком много кодов для этого номера. Попробуйте через 15 минут.');
  phoneRequests.set(phoneKey,[...recent,now]);
  return phone;
}
/** Канал доставки кода. Telegram часто шлёт его не в приложение, а по SMS, звонком или на почту входа. */
function channelOf(type:Api.auth.TypeSentCodeType|Api.auth.TypeCodeType|undefined):CodeChannel|undefined{
  if(!type)return undefined;
  if(type instanceof Api.auth.SentCodeTypeApp)return 'app';
  if(type instanceof Api.auth.SentCodeTypeEmailCode)return 'email';
  if(type instanceof Api.auth.SentCodeTypeFragmentSms||type instanceof Api.auth.CodeTypeFragmentSms)return 'fragment';
  if(type instanceof Api.auth.SentCodeTypeCall||type instanceof Api.auth.SentCodeTypeFlashCall||type instanceof Api.auth.SentCodeTypeMissedCall||type instanceof Api.auth.CodeTypeCall||type instanceof Api.auth.CodeTypeFlashCall||type instanceof Api.auth.CodeTypeMissedCall)return 'call';
  return 'sms';
}
function applySentCode(l:Login,sent:Api.auth.TypeSentCode){
  if(sent instanceof Api.auth.SentCodePaymentRequired)throw new Error('Telegram требует оплатить SMS с кодом для этого номера. Войдите по QR-коду: откройте Telegram на телефоне → Настройки → Устройства.');
  if(!(sent instanceof Api.auth.SentCode))throw new Error('Telegram не прислал код. Попробуйте QR-вход.');
  if(sent.type instanceof Api.auth.SentCodeTypeSetUpEmailRequired)throw new Error('Telegram требует почту для входа на новых устройствах. Привяжите её в приложении Telegram (Настройки → Конфиденциальность → Почта для входа) или войдите по QR-коду.');
  const type=sent.type;
  l.phoneCodeHash=sent.phoneCodeHash;
  l.codeChannel=channelOf(type);l.codeViaApp=l.codeChannel==='app';
  l.codeLength='length' in type&&typeof type.length==='number'?type.length:undefined;
  l.codeText=type instanceof Api.auth.SentCodeTypeSmsWord||type instanceof Api.auth.SentCodeTypeSmsPhrase;
  l.emailPattern=type instanceof Api.auth.SentCodeTypeEmailCode?type.emailPattern:undefined;
  l.nextChannel=channelOf(sent.nextType);
  l.resendAt=l.nextChannel?Date.now()+(sent.timeout??30)*1000:undefined;
  try{appendFileSync('/tmp/oskolok-login-diag.log',JSON.stringify({ts:new Date().toISOString(),method:l.method,phase:'code_sent',type:type.className,next:sent.nextType?.className})+'\n');}catch{}
}
const waitCode=(l:Login)=>new Promise<string>((resolve,reject)=>{l.code=resolve;l.rejectCode=reject;setLoginState(l,'code',l.error);});
function runPhoneLogin(id:string,l:Login,phone:string){
  const c=client();l.client=c;l.phone=phone;setLoginState(l,'connecting');
  void (async()=>{
    try{
      await c.connect();
      const sent=await c.invoke(new Api.auth.SendCode({phoneNumber:phone,apiId,apiHash,settings:new Api.CodeSettings({})}));
      let user:Api.TypeUser|undefined;
      if(sent instanceof Api.auth.SentCodeSuccess&&sent.authorization instanceof Api.auth.Authorization)user=sent.authorization.user;
      else applySentCode(l,sent);
      while(!user){
        const code=await waitCode(l);
        try{
          const result=await c.invoke(new Api.auth.SignIn({phoneNumber:phone,phoneCodeHash:l.phoneCodeHash,...(l.codeChannel==='email'?{emailVerification:new Api.EmailVerificationCode({code})}:{phoneCode:code})}));
          if(!(result instanceof Api.auth.Authorization))throw new Error('Этот номер не зарегистрирован в Telegram. Сначала создайте аккаунт в приложении Telegram.');
          user=result.user;
        }catch(error){
          const rpc=(error as {errorMessage?:string}).errorMessage||'';
          if(rpc==='SESSION_PASSWORD_NEEDED'){
            user=await c.signInWithPassword({apiId,apiHash},{
              password:async(hint)=>{l.passwordHint=hint||undefined;setLoginState(l,'password',l.error);return new Promise<string>((resolve,reject)=>{l.password=resolve;l.rejectPassword=reject;});},
              onError:async(e)=>{if(logins.get(id)!==l||Date.now()>l.expires)return true;l.attempts++;l.error=loginError(e);return l.attempts>=5||!/PASSWORD_HASH_INVALID|Password is empty/i.test(`${(e as {errorMessage?:string}).errorMessage||''} ${e.message}`);},
            });
            break;
          }
          if(logins.get(id)!==l||!/PHONE_CODE_INVALID|PHONE_CODE_EMPTY|EMAIL_CODE_INVALID|CODE_INVALID/.test(rpc)||++l.attempts>=5)throw error;
          l.error=loginError(error);
        }
      }
      await finishLogin(id,l,user);
    }catch(e){if(logins.get(id)===l){logLoginFailure('phone',l.codeChannel,e);setLoginState(l,'error',e instanceof Error&&/^(Подтвердите|Telegram требует|Telegram не прислал|Этот номер)/.test(e.message)?e.message:l.error||loginError(e));}await c.disconnect();}
  })();
}
/** Повторная отправка следующим каналом (SMS, звонок), когда Telegram это разрешает. */
export async function resendPhoneCode(id:string|undefined){
  const l=id?logins.get(id):undefined;
  if(!l||l.state!=='code'||!l.client||!l.phone||!l.phoneCodeHash||Date.now()>l.expires)throw new Error('Запросите код заново.');
  if(!l.nextChannel)throw new Error('Telegram не предлагает другой способ. Войдите по QR-коду.');
  if(Date.now()<(l.resendAt||0))throw new Error(`Повторить можно через ${Math.ceil(((l.resendAt||0)-Date.now())/1000)} с.`);
  try{applySentCode(l,await l.client.invoke(new Api.auth.ResendCode({phoneNumber:l.phone,phoneCodeHash:l.phoneCodeHash})));l.error=undefined;setLoginState(l,'code');}
  catch(e){logLoginFailure('phone','resend',e);throw new Error(e instanceof Error&&/^Telegram (требует|не прислал)/.test(e.message)?e.message:loginError(e));}
}
export async function beginPhoneLogin(expected:string|undefined,rawPhone:string){
  if(logins.size>=20)throw new Error('Слишком много попыток входа. Попробуйте позже.');
  const phone=validatePhone(rawPhone),now=Date.now();
  const id=randomBytes(32).toString('hex'),l:Login={method:'phone',expected,state:'connecting',attempts:0,expires:now+300000};
  logins.set(id,l);expireLogin(id,l);
  runPhoneLogin(id,l,phone);
  return id;
}
export function beginBotLogin(expected:string|undefined,appUrl:string){
  if(!sessionConfigured)throw new Error('Вход Telegram не настроен на сервере.');
  if(logins.size>=20)throw new Error('Слишком много попыток входа. Попробуйте позже.');
  const id=randomBytes(24).toString('base64url');
  const l:Login={method:'bot',expected,state:'bot_pending',attempts:0,expires:Date.now()+300000,appUrl};
  logins.set(id,l);expireLogin(id,l);return id;
}
export function attachBotLogin(id:string,senderId:string){
  const l=logins.get(id);
  if(!l||l.method!=='bot'||l.state!=='bot_pending'||Date.now()>l.expires||l.expected&&l.expected!==`telegram:${senderId}`)return false;
  l.botChatId=senderId;l.expected=`telegram:${senderId}`;setLoginState(l,'bot_phone');return true;
}
export function botLoginForUser(senderId:string){
  for(const [id,l] of logins)if(l.method==='bot'&&l.botChatId===senderId&&Date.now()<l.expires&&l.state!=='connected'&&l.state!=='error')return {id,login:l};
  return undefined;
}
export function startBotPhoneLogin(id:string,rawPhone:string){
  const l=logins.get(id);
  if(!l||l.method!=='bot'||l.state!=='bot_phone'||!l.botChatId||Date.now()>l.expires)throw new Error('Начните подключение заново в мини-приложении.');
  const phone=validatePhone(rawPhone);runPhoneLogin(id,l,phone);
}
export function submitPhoneCode(id:string|undefined,code:string){
  const l=id?logins.get(id):undefined;
  if(!l||!['phone','bot'].includes(l.method)||l.state!=='code'||!l.code||Date.now()>l.expires)throw new Error('Запросите код заново.');
  const normalized=l.codeText?code.trim().replace(/\s+/g,' '):code.replace(/[\s-]/g,'');
  if(!l.codeText&&!/^\d{4,8}$/.test(normalized))throw new Error('Введите цифры кода целиком.');
  l.state='verifying';l.error=undefined;
  const resolve=l.code;l.code=undefined;l.rejectCode=undefined;resolve(normalized);
}
export function submitLoginPassword(id:string|undefined,password:string){
  const l=id?logins.get(id):undefined;
  if(!l||l.state!=='password'||!l.password||Date.now()>l.expires)throw new Error('Начните вход заново.');
  l.state='verifying';l.error=undefined;
  const resolve=l.password;l.password=undefined;l.rejectPassword=undefined;resolve(password);
}
export function loginStatus(id:string){return logins.get(id);}
export function consumeLogin(id:string){logins.delete(id);}
/** Фото профиля Telegram сохраняется как data URL — его можно показывать без обращения к Telegram. */
async function downloadAvatar(c:TelegramClient):Promise<string|null>{
  const buffer=await c.downloadProfilePhoto('me',{isBig:false});
  if(!buffer||!(buffer instanceof Buffer)||!buffer.length||buffer.length>900000)return null;
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}
/** Обновить имя/username/фото уже подключённого пользователя (например, при открытии профиля). */
export async function refreshTelegramIdentity(userId:string){
  const me=await withSession(userId,c=>c.getMe());
  const c=await connectedClient(userId);
  if(!(me instanceof Api.User))return;
  const name=[me.firstName,me.lastName].filter(Boolean).join(' ')||'Слушатель';
  const username=me.username||me.usernames?.find(x=>x.active)?.username||null;
  const avatarUrl=await downloadAvatar(c).catch(()=>null);
  await prisma.user.update({where:{id:userId},data:{name,...(avatarUrl?{avatarUrl}:{})}});
}
export class SessionRevokedError extends Error{constructor(public reason:string){super(`SESSION_REVOKED: ${reason}`);this.name='SessionRevokedError';}}
const connecting=new Map<string,Promise<TelegramClient>>();
const withTimeout=async<T,>(p:Promise<T>,ms:number,label:string):Promise<T>=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([p,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} TIMEOUT`)),ms);timer.unref?.();})]);}
  finally{clearTimeout(timer);}
};
async function musicDeadline<T>(userId:string,operation:Promise<T>,ms:number,label:string):Promise<T>{
  try{return await withTimeout(operation,ms,label);}
  catch(error){if(error instanceof Error&&error.message.endsWith(' TIMEOUT'))dropClient(userId);throw error;}
}
/** Сбрасывает живой клиент (после обрыва): следующий вызов переподключится с нуля. */
function dropClient(userId:string,c?:TelegramClient){
  const current=clients.get(userId);if(c&&current!==c)return;
  clients.delete(userId);if(current)void current.disconnect().catch(()=>{});
}
/** Сессия отозвана в Telegram (вышли из «Устройств», удалили аккаунт…): удаляем мёртвую запись и просим войти заново. */
async function markSessionRevoked(userId:string,error:unknown){
  const reason=loginDiagnostic(error).rpc||'SESSION_REVOKED';
  dropClient(userId);
  if(setHealth(userId,'needs_relogin',reason))logger.warn({userId,reason,event:'telegram.session.revoked'},'Telegram session revoked; re-login required');
  await prisma.telegramConnection.deleteMany({where:{userId}}).catch(()=>{});
  await prisma.creatorProfile.updateMany({where:{userId},data:{telegramSyncError:'Telegram завершил сессию Осколка. Подключите Telegram заново.'}}).catch(()=>{});
  return new SessionRevokedError(reason);
}
export async function connectedClient(userId:string){
  const existing=clients.get(userId);
  if(existing&&existing.connected!==false)return existing;
  if(existing)dropClient(userId,existing);
  const pending=connecting.get(userId);if(pending)return pending;
  // Одно подключение на пользователя: параллельные вызовы ждут тот же промис, а не плодят клиентов с одной auth_key.
  const attempt=(async()=>{
    const row=await prisma.telegramConnection.findUnique({where:{userId}});
    if(!row||!sessionConfigured){setHealth(userId,'disconnected');throw new Error('Подключите сессию Telegram в профиле.');}
    if(getHealth(userId)?.state!=='connected')setHealth(userId,'reconnecting');
    return retry(async()=>{
      const c=client(decryptSession(row.encryptedSession));
      try{
        await withTimeout(c.connect(),15000,'CONNECT');
        // Проверка ключа настоящим вызовом: AUTH_KEY_UNREGISTERED/SESSION_REVOKED классифицируются как отзыв, сетевые сбои — как повод переподключиться.
        await withTimeout(c.invoke(new Api.updates.GetState()),15000,'AUTH_CHECK');
      }catch(error){void c.disconnect().catch(()=>{});throw error;}
      clients.set(userId,c);
      if(setHealth(userId,'connected'))logger.info({userId,event:'telegram.session.connected'},'Telegram session connected');
      return c;
    },{attempts:3,base:1000,max:8000,onRetry:({attempt,delay,kind})=>{setHealth(userId,'reconnecting',kind,Date.now()+delay);logger.warn({userId,attempt,delay,kind,event:'telegram.session.reconnect'},'Telegram session reconnect scheduled');}});
  })().catch(async error=>{
    if(classifyTelegramError(error)==='revoked')throw await markSessionRevoked(userId,error);
    if(!(error instanceof Error&&error.message.startsWith('Подключите')))setHealth(userId,'reconnecting',loginDiagnostic(error).rpc||'NETWORK');
    throw error;
  }).finally(()=>connecting.delete(userId));
  connecting.set(userId,attempt);
  return attempt;
}
/** Выполнить вызов MTProto с самовосстановлением: обрыв → переподключение с бэкоффом, отзыв сессии → needs_relogin, FLOOD_WAIT → rate_limited с точным временем. */
export async function withSession<T>(userId:string,fn:(c:TelegramClient)=>Promise<T>):Promise<T>{
  try{
    return await retry(async()=>{
      const c=await connectedClient(userId);
      try{const result=await fn(c);if(getHealth(userId)?.state!=='connected')setHealth(userId,'connected');return result;}
      catch(error){if(classifyTelegramError(error)==='network')dropClient(userId,c);throw error;}
    },{attempts:3,base:800,max:6000,maxFloodWait:0,onRetry:({attempt,delay,kind})=>{logger.warn({userId,attempt,delay,kind,event:'telegram.session.retry'},'Telegram call retry');}});
  }catch(error){
    const kind=classifyTelegramError(error);
    if(error instanceof SessionRevokedError)throw error;
    if(kind==='revoked')throw await markSessionRevoked(userId,error);
    if(kind==='flood'){const s=floodWaitSeconds(error)??30;setHealth(userId,'rate_limited',`FLOOD_WAIT_${s}`,Date.now()+s*1000);}
    throw error;
  }
}
/** Здоровье сессии для клиента: connected / reconnecting / needs_relogin / rate_limited / disconnected. */
export async function sessionHealth(userId:string):Promise<SessionHealth>{
  const h=getHealth(userId);
  const row=await prisma.telegramConnection.findUnique({where:{userId},select:{userId:true}});
  if(!row)return h?.state==='needs_relogin'?h:{state:'disconnected',updatedAt:Date.now()};
  if(h?.state==='needs_relogin'){clearHealth(userId);return {state:'connected',updatedAt:Date.now()};}
  if(h?.state==='rate_limited'&&h.retryAt&&h.retryAt<Date.now())return {state:'connected',updatedAt:Date.now()};
  return h||{state:'connected',updatedAt:Date.now()};
}
export async function disconnectSession(userId:string){
  const row=await prisma.telegramConnection.findUnique({where:{userId}});
  if(row){try{const c=await connectedClient(userId);await c.invoke(new Api.auth.LogOut());await c.disconnect();}catch(error){logger.warn({userId,...loginDiagnostic(error),event:'telegram.session.logout_failed'},'Telegram logout failed; removing local session anyway');}}
  dropClient(userId);clearHealth(userId);await prisma.telegramConnection.deleteMany({where:{userId}});await prisma.webSession.deleteMany({where:{userId}});
}
export const hashToken=(v:string)=>createHash('sha256').update(v).digest('hex');
export type MusicDocument={id:string;accessHash:string;fileReference:string};
function inputMusicDocument(document:MusicDocument){return new Api.InputDocument({id:bigInt(document.id),accessHash:bigInt(document.accessHash),fileReference:Buffer.from(document.fileReference,'base64')});}
export async function removeProfileMusic(userId:string,document:MusicDocument){
  try{await withSession(userId,c=>c.invoke(new Api.account.SaveMusic({id:inputMusicDocument(document),unsave:true})));}
  catch(error){
    if(classifyTelegramError(error)!=='file_reference')throw error;
    const c=await connectedClient(userId);
    const saved=await c.invoke(new Api.users.GetSavedMusic({id:'me',offset:0,limit:100,hash:bigInt(0)}));
    if(!(saved instanceof Api.users.SavedMusic))return;
    const fresh=saved.documents.find(d=>d instanceof Api.Document&&d.id.toString()===document.id);
    if(!(fresh instanceof Api.Document))return;
    await c.invoke(new Api.account.SaveMusic({id:new Api.InputDocument({id:fresh.id,accessHash:fresh.accessHash,fileReference:fresh.fileReference}),unsave:true}));
  }
}
export async function uploadProfileMusic(userId:string,file:string,title:string,artist:string,duration:number,thumbnail?:string):Promise<MusicDocument>{
  return musicDeadline(userId,withSession(userId,c=>uploadAudioDocument(c,file,title,artist,duration,thumbnail)),90000,'MUSIC_UPLOAD');
}
export async function uploadAudioDocument(c:TelegramClient,file:string,title:string,artist:string,duration:number,thumbnail?:string):Promise<MusicDocument>{
  const audio=await c.uploadFile({file:new CustomFile(path.basename(file),statSync(file).size,file)});
  const thumb=thumbnail?await c.uploadFile({file:new CustomFile(path.basename(thumbnail),statSync(thumbnail).size,thumbnail)}):undefined;
  // uploadMedia associates the document with our private chat without creating
  // a Saved Messages entry. Profile music can then reference the document.
  const media=await c.invoke(new Api.messages.UploadMedia({peer:'me',media:new Api.InputMediaUploadedDocument({file:audio,thumb,mimeType:file.toLowerCase().endsWith('.mp3')?'audio/mpeg':'audio/mp4',attributes:[new Api.DocumentAttributeAudio({duration:Math.round(duration),title,performer:artist})]})}));
  if(!(media instanceof Api.MessageMediaDocument)||!(media.document instanceof Api.Document))throw new Error('Telegram не распознал аудиофайл.');
  const d=media.document;
  return {id:d.id.toString(),accessHash:d.accessHash.toString(),fileReference:Buffer.from(d.fileReference).toString('base64')};
}
export async function saveProfileMusic(userId:string,document:MusicDocument){await musicDeadline(userId,withSession(userId,c=>c.invoke(new Api.account.SaveMusic({id:inputMusicDocument(document)}))),20000,'MUSIC_SAVE');}
export async function addProfileMusic(userId:string,file:string,title:string,artist:string,duration:number,thumbnail?:string):Promise<MusicDocument>{
  const document=await uploadProfileMusic(userId,file,title,artist,duration,thumbnail);
  await saveProfileMusic(userId,document);
  return document;
}

/** Telegram ids of the user's own contacts (not bots, not self), read through their connected session. Nothing is stored. */
export async function contactTelegramIds(userId:string):Promise<string[]>{
  const result=await withSession(userId,c=>c.invoke(new Api.contacts.GetContacts({hash:bigInt(0)})));
  if(!(result instanceof Api.contacts.Contacts))return [];
  return result.users.filter((u):u is Api.User=>u instanceof Api.User&&!u.bot&&!u.self&&!u.deleted).map(u=>String(u.id));
}
