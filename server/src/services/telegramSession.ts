import { TelegramClient, Api } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import {CustomFile} from 'teleproto/client/uploads.js';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import bigInt from 'big-integer';
import { prisma } from '../database/client.js';

const apiId=Number(process.env.TELEGRAM_API_ID||0),apiHash=process.env.TELEGRAM_API_HASH||'';
export const sessionConfigured=!!apiId&&!!apiHash;
const clients=new Map<string,TelegramClient>();
type Login={client?:TelegramClient;method:'qr'|'phone'|'bot';expected?:string;state:string;url?:string;error?:string;userId?:string;passwordHint?:string;password?:(s:string)=>void;rejectPassword?:(e:Error)=>void;code?:(s:string)=>void;rejectCode?:(e:Error)=>void;codeViaApp?:boolean;attempts:number;expires:number;botChatId?:string;appUrl?:string};
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
function client(session=''){return new TelegramClient(new StringSession(session),apiId,apiHash,{connectionRetries:2,deviceModel:'Осколок',appVersion:'1.0',autoReconnect:true});}
function loginError(error:unknown){
  const message=error instanceof Error?error.message:String(error);
  if(/PHONE_NUMBER_INVALID/i.test(message))return 'Проверьте номер в международном формате.';
  if(/PHONE_NUMBER_FLOOD|PHONE_PASSWORD_FLOOD|FLOOD_WAIT/i.test(message))return 'Telegram ограничил попытки входа. Попробуйте позже.';
  if(/PHONE_CODE_EXPIRED/i.test(message))return 'Срок действия кода истёк. Начните вход заново.';
  if(/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/i.test(message))return 'Неверный код. Проверьте сообщение Telegram и попробуйте снова.';
  if(/PASSWORD_HASH_INVALID/i.test(message))return 'Неверный облачный пароль. Попробуйте снова.';
  if(/Email verification|required.*email/i.test(message))return 'Telegram запросил подтверждение почты. Пока воспользуйтесь QR-входом с другого устройства.';
  if(/UPDATE_APP_TO_LOGIN|SEND_CODE_UNAVAILABLE/i.test(message))return 'Telegram не разрешил этот способ входа. Попробуйте QR-вход с другого устройства.';
  return 'Telegram не подтвердил вход. Попробуйте снова.';
}
function expireLogin(id:string,l:Login){
  const timer=setTimeout(()=>{if(logins.get(id)===l){logins.delete(id);if(l.state!=='connected'){l.rejectCode?.(new Error('AUTH_USER_CANCEL'));l.rejectPassword?.(new Error('AUTH_USER_CANCEL'));void l.client?.disconnect();}}},300000);
  timer.unref();
}
async function finishLogin(id:string,l:Login,u:Api.TypeUser){
  if(!l.client)throw new Error('Сессия входа не создана.');
  const userId=`telegram:${u.id.toString()}`;
  if(logins.get(id)!==l||Date.now()>l.expires||l.expected&&userId!==l.expected){await l.client.invoke(new Api.auth.LogOut());throw new Error('Подтвердите вход тем же аккаунтом, из которого открыт Осколок.');}
  const name=u instanceof Api.User?[u.firstName,u.lastName].filter(Boolean).join(' ')||'Слушатель':'Слушатель';
  const username=u instanceof Api.User?(u.username||u.usernames?.find(x=>x.active)?.username||null):null;
  const avatarUrl=await downloadAvatar(l.client).catch(()=>null);
  await prisma.user.upsert({where:{id:userId},create:{id:userId,name,username,avatarUrl},update:{name,...(avatarUrl?{avatarUrl}:{})}});
  await prisma.creatorProfile.upsert({where:{userId},create:{userId,displayName:name},update:{}});
  await prisma.telegramConnection.upsert({where:{userId},create:{userId,encryptedSession:encryptSession(String(l.client.session.save()))},update:{encryptedSession:encryptSession(String(l.client.session.save()))}});
  const old=clients.get(userId);if(old&&old!==l.client)await old.disconnect();clients.set(userId,l.client);l.userId=userId;setLoginState(l,'connected');
}
export async function beginLogin(expected?:string){
  if(!sessionConfigured)throw new Error('Добавьте TELEGRAM_API_ID и TELEGRAM_API_HASH в .env и перезапустите сервер.');
  if(logins.size>=20)throw new Error('Слишком много попыток входа. Попробуйте позже.');
  const id=randomBytes(32).toString('hex'),c=client(),l:Login={client:c,method:'qr',expected,state:'connecting',attempts:0,expires:Date.now()+300000};logins.set(id,l);
  expireLogin(id,l);
  void (async()=>{
    try{
      await c.connect();
      const u=await c.signInUserWithQrCode({apiId,apiHash},{qrCode:async q=>{l.url=`tg://login?token=${q.token.toString('base64url')}`;l.state='qr';},password:async(hint)=>{l.passwordHint=hint||undefined;l.state='password';return new Promise<string>((resolve,reject)=>{l.password=resolve;l.rejectPassword=reject;});},onError:async()=>true});
      await finishLogin(id,l,u);
    }catch(e){l.state='error';l.error=e instanceof Error&&e.message.startsWith('Подтвердите')?e.message:'Telegram не подтвердил вход. Начните заново.';await c.disconnect();}
  })();return id;
}
export function cancelLogin(id:string|undefined){
  if(!id)return;
  const l=logins.get(id);if(!l)return;
  logins.delete(id);
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
function runPhoneLogin(id:string,l:Login,phone:string){
  const c=client();l.client=c;setLoginState(l,'connecting');
  void (async()=>{
    try{
      await c.connect();
      const u=await c.signInUser({apiId,apiHash},{
        phoneNumber:phone,
        phoneCode:async(isCodeViaApp)=>{l.codeViaApp=!!isCodeViaApp;setLoginState(l,'code');return new Promise<string>((resolve,reject)=>{l.code=resolve;l.rejectCode=reject;});},
        password:async(hint)=>{l.passwordHint=hint||undefined;setLoginState(l,'password');return new Promise<string>((resolve,reject)=>{l.password=resolve;l.rejectPassword=reject;});},
        onError:async(error)=>{
          if(logins.get(id)!==l||Date.now()>l.expires)return true;
          l.attempts++;
          l.error=loginError(error);
          return l.attempts>=5||/PHONE_CODE_EXPIRED/i.test(error.message);
        },
      });
      await finishLogin(id,l,u);
    }catch(e){if(logins.get(id)===l)setLoginState(l,'error',e instanceof Error&&e.message.startsWith('Подтвердите')?e.message:l.error||loginError(e));await c.disconnect();}
  })();
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
  l.botChatId=senderId;setLoginState(l,'bot_phone');return true;
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
  l.state='verifying';l.error=undefined;
  const resolve=l.code;l.code=undefined;l.rejectCode=undefined;resolve(code);
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
  const c=await connectedClient(userId);
  const me=await c.getMe();
  if(!(me instanceof Api.User))return;
  const name=[me.firstName,me.lastName].filter(Boolean).join(' ')||'Слушатель';
  const username=me.username||me.usernames?.find(x=>x.active)?.username||null;
  const avatarUrl=await downloadAvatar(c).catch(()=>null);
  await prisma.user.update({where:{id:userId},data:{name,...(avatarUrl?{avatarUrl}:{})}});
}
export async function connectedClient(userId:string){
  const existing=clients.get(userId);if(existing)return existing;
  const row=await prisma.telegramConnection.findUnique({where:{userId}});if(!row||!sessionConfigured)throw new Error('Подключите сессию Telegram в профиле.');
  const c=client(decryptSession(row.encryptedSession));await c.connect();clients.set(userId,c);return c;
}
export async function disconnectSession(userId:string){
  const row=await prisma.telegramConnection.findUnique({where:{userId}});if(row){const c=await connectedClient(userId);await c.invoke(new Api.auth.LogOut());await c.disconnect();}
  clients.delete(userId);await prisma.telegramConnection.deleteMany({where:{userId}});await prisma.webSession.deleteMany({where:{userId}});
}
export const hashToken=(v:string)=>createHash('sha256').update(v).digest('hex');
export type MusicDocument={id:string;accessHash:string;fileReference:string};
function inputMusicDocument(document:MusicDocument){return new Api.InputDocument({id:bigInt(document.id),accessHash:bigInt(document.accessHash),fileReference:Buffer.from(document.fileReference,'base64')});}
export async function removeProfileMusic(userId:string,document:MusicDocument){
  const c=await connectedClient(userId);
  try{await c.invoke(new Api.account.SaveMusic({id:inputMusicDocument(document),unsave:true}));}
  catch(error){
    if(!/FILE_REFERENCE_EXPIRED|FILE_REFERENCE_INVALID/i.test(error instanceof Error?error.message:String(error)))throw error;
    const saved=await c.invoke(new Api.users.GetSavedMusic({id:'me',offset:0,limit:100,hash:bigInt(0)}));
    if(!(saved instanceof Api.users.SavedMusic))return;
    const fresh=saved.documents.find(d=>d instanceof Api.Document&&d.id.toString()===document.id);
    if(!(fresh instanceof Api.Document))return;
    await c.invoke(new Api.account.SaveMusic({id:new Api.InputDocument({id:fresh.id,accessHash:fresh.accessHash,fileReference:fresh.fileReference}),unsave:true}));
  }
}
export async function uploadProfileMusic(userId:string,file:string,title:string,artist:string,duration:number,thumbnail?:string):Promise<MusicDocument>{
  return uploadAudioDocument(await connectedClient(userId),file,title,artist,duration,thumbnail);
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
export async function saveProfileMusic(userId:string,document:MusicDocument){await (await connectedClient(userId)).invoke(new Api.account.SaveMusic({id:inputMusicDocument(document)}));}
export async function addProfileMusic(userId:string,file:string,title:string,artist:string,duration:number,thumbnail?:string):Promise<MusicDocument>{
  const document=await uploadProfileMusic(userId,file,title,artist,duration,thumbnail);
  await saveProfileMusic(userId,document);
  return document;
}
