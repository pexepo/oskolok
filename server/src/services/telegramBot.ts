import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {env} from '../config/env.js';
import {prisma} from '../database/client.js';
import {logger} from '../utils/logger.js';
import {attachBotLogin,botLoginForUser,cancelLogin,loginStatus,setBotLoginNotifier,startBotPhoneLogin,submitLoginPassword,submitPhoneCode} from './telegramSession.js';

type BotMessage={message_id:number;chat:{id:number;type:string};from?:{id:number};text?:string;contact?:{phone_number:string;user_id?:number}};
type BotUpdate={update_id:number;message?:BotMessage};
type ReplyMarkup=Record<string,unknown>;
const queues=new Map<string,Promise<void>>();
const privateDir=path.resolve(process.env.OSKOLOK_PRIVATE_DIR||'server/data/private');
const offsetFile=path.join(privateDir,'bot-update-offset');
const clearKeyboard={remove_keyboard:true};
const phoneKeyboard={keyboard:[[{text:'Поделиться своим номером',request_contact:true}]],resize_keyboard:true,one_time_keyboard:true};

async function api<T>(method:string,body:Record<string,unknown>={},timeout=10000):Promise<T>{
  const response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout),
  });
  const result=await response.json() as {ok:boolean;result:T;description?:string};
  if(!response.ok||!result.ok)throw new Error(result.description||`Telegram ${method} failed`);
  return result.result;
}
function enqueue(sender:string,task:()=>Promise<void>){
  const previous=queues.get(sender)||Promise.resolve();
  const next=previous.catch(()=>{}).then(task).catch(error=>logger.warn({reason:error instanceof Error?error.message:String(error)},'Telegram bot operation failed'));
  queues.set(sender,next);
  void next.finally(()=>{if(queues.get(sender)===next)queues.delete(sender);});
  return next;
}
async function say(sender:string,text:string,reply_markup?:ReplyMarkup){
  await api('sendMessage',{chat_id:sender,text,reply_markup,link_preview_options:{is_disabled:true}});
}
async function menuKeyboard(){
  try{
    const menu=await api<{type:string;web_app?:{url:string}}>('getChatMenuButton');
    return menu.web_app?.url&&/^https:\/\//.test(menu.web_app.url)?{inline_keyboard:[[{text:'Открыть Осколок',web_app:{url:menu.web_app.url}}]]}:undefined;
  }catch{return undefined;}
}
async function deleteSecret(message:BotMessage){
  await api('deleteMessage',{chat_id:message.chat.id,message_id:message.message_id}).catch(()=>{});
}
function announceLogin(login:NonNullable<ReturnType<typeof loginStatus>>){
  if(!login.botChatId)return;
  const sender=login.botChatId;
  enqueue(sender,async()=>{
    if(login.state==='code')await say(sender,`${login.error?`${login.error}\n\n`:''}${login.codeViaApp?'Код отправлен в служебный чат Telegram.':'Telegram отправил код подтверждения.'}\nОтправьте код ответом сюда. Никому больше его не сообщайте.`,clearKeyboard);
    else if(login.state==='password')await say(sender,`Введите облачный пароль двухэтапной проверки${login.passwordHint?` (подсказка: ${login.passwordHint})`:''}. Пароль используется только для этого входа.`,clearKeyboard);
    else if(login.state==='connected')await say(sender,'✓ Telegram подключён к Осколку. Вернитесь в мини-приложение: там появится подтверждение.',login.appUrl?{inline_keyboard:[[{text:'Вернуться в Осколок',web_app:{url:login.appUrl}}]]}:undefined);
    else if(login.state==='error')await say(sender,`${login.error||'Не удалось завершить вход.'}\nОткройте мини-приложение и начните подключение снова.`,clearKeyboard);
  });
}
export async function handleBotMessage(message:BotMessage){
  if(message.chat.type!=='private'||!message.from)return;
  const sender=String(message.from.id),text=(message.text||'').trim();
  const start=text.match(/^\/start(?:@\w+)?(?:\s+connect_([A-Za-z0-9_-]+))?\s*$/i);
  if(start){
    if(start[1]){
      if(!attachBotLogin(start[1],sender)){
        await say(sender,'Эта ссылка устарела или открыта другим аккаунтом. Вернитесь в Осколок и нажмите «Продолжить в боте» ещё раз.');return;
      }
      await say(sender,'Продолжим подключение Telegram к Осколку. Отправьте номер вашего аккаунта в формате +375… или поделитесь своим контактом кнопкой ниже.',phoneKeyboard);return;
    }
    await say(sender,'Привет! Это бот Осколка 🎵\n\nЗдесь можно подключить музыку к Telegram-профилю. Откройте мини-приложение и слушайте треки; когда понадобится подтверждение, я проведу вас через вход.\n\nКоманды: /help — возможности, /status — подключение, /cancel — отменить вход.',await menuKeyboard());return;
  }
  if(text==='/help'){
    await say(sender,'В Осколке можно слушать музыку, сохранять треки и плейлисты, искать тексты и показывать текущий трек в Telegram-профиле.\n\nДля подключения: мини-приложение → Профиль → Telegram → «Продолжить в боте». Номер, код и облачный пароль отправляйте только в этом диалоге во время подключения.',await menuKeyboard());return;
  }
  if(text==='/status'){
    const connected=await prisma.telegramConnection.findUnique({where:{userId:`telegram:${sender}`},select:{userId:true}});
    await say(sender,connected?'✓ Telegram подключён к Осколку. Откройте мини-приложение, чтобы управлять музыкой и интеграцией.':'Пользовательская сессия ещё не подключена. Начните в мини-приложении: Профиль → Telegram → «Продолжить в боте».',await menuKeyboard());return;
  }
  const active=botLoginForUser(sender);
  if(text==='/cancel'){
    if(active)cancelLogin(active.id);
    await say(sender,'Подключение отменено. Начать снова можно из мини-приложения.',clearKeyboard);return;
  }
  if(!active){await say(sender,'Откройте мини-приложение через кнопку меню. Если хотите подключить музыку к профилю, начните вход в разделе «Профиль → Telegram».');return;}
  const {id,login}=active;
  if(login.state==='bot_phone'){
    if(message.contact?.user_id&&String(message.contact.user_id)!==sender){await say(sender,'Пришлите номер именно вашего Telegram-аккаунта.');return;}
    try{startBotPhoneLogin(id,message.contact?.phone_number||text);await say(sender,'Запрашиваю код у Telegram…',clearKeyboard);}
    catch(error){await say(sender,error instanceof Error?error.message:'Проверьте номер и попробуйте ещё раз.');}
  }else if(login.state==='code'){
    try{submitPhoneCode(id,text);await deleteSecret(message);await say(sender,'Проверяю код…');}
    catch(error){await say(sender,error instanceof Error?error.message:'Не удалось проверить код.');}
  }else if(login.state==='password'){
    try{submitLoginPassword(id,text);await deleteSecret(message);await say(sender,'Проверяю пароль…');}
    catch(error){await say(sender,error instanceof Error?error.message:'Не удалось проверить пароль.');}
  }else await say(sender,'Подождите, Telegram ещё проверяет вход.');
}

async function poll(){
  mkdirSync(privateDir,{recursive:true,mode:0o700});
  let offset=existsSync(offsetFile)?Number(readFileSync(offsetFile,'utf8')):0;
  if(!Number.isSafeInteger(offset)||offset<0)offset=0;
  if(!offset){
    try{const last=await api<BotUpdate[]>('getUpdates',{offset:-1,limit:1,timeout:0,allowed_updates:['message']});offset=(last.at(-1)?.update_id||0)+1;writeFileSync(offsetFile,String(offset),{mode:0o600});}
    catch(error){logger.warn({reason:error instanceof Error?error.message:String(error)},'Telegram bot initial poll failed');}
  }
  logger.info('Telegram bot is ready for private messages');
  let lastError='';
  let lastErrorLogged=0;
  while(true){
    try{
      const updates=await api<BotUpdate[]>('getUpdates',{offset,timeout:10,limit:50,allowed_updates:['message']},25000);
      lastError='';
      for(const update of updates){
        if(update.message?.from)await enqueue(String(update.message.from.id),()=>handleBotMessage(update.message!));
        offset=update.update_id+1;
        writeFileSync(offsetFile,String(offset),{mode:0o600});
      }
    }catch(error){
      const reason=error instanceof Error?error.message:String(error);
      if(reason!==lastError||Date.now()-lastErrorLogged>600000){logger.warn({reason},'Telegram bot polling failed');lastError=reason;lastErrorLogged=Date.now();}
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
  }
}

export function startTelegramBot(){
  if(!env.TELEGRAM_BOT_TOKEN)return;
  setBotLoginNotifier(announceLogin);
  void api('setMyCommands',{commands:[
    {command:'start',description:'Открыть Осколок'},
    {command:'help',description:'Что умеет бот'},
    {command:'status',description:'Проверить подключение'},
    {command:'cancel',description:'Отменить вход'},
  ]}).catch(error=>logger.warn({reason:error instanceof Error?error.message:String(error)},'Telegram bot commands setup failed'));
  void poll();
}
