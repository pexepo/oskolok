import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {env} from '../config/env.js';
import {prisma} from '../database/client.js';
import {logger} from '../utils/logger.js';
import {attachBotLogin,botLoginForUser,cancelLogin,loginStatus,setBotLoginNotifier,startBotPhoneLogin} from './telegramSession.js';
import {checkBetaAccess,BETA_DENIED_MESSAGE} from './telegramBeta.js';
import {registerBetaBotContact} from './telegramBetaNotifications.js';
import {api,answerCallback,chatAction,editText,Msg,sendBanner,sendText,type Markup} from './telegramBotApi.js';
import {QUICK,quickKeyboard,sendWave,sendSimilar,sendLiked,sendLyrics,pageList,playFromList} from './telegramBotExtras.js';
import {sendCabinet,cabinetKeyboard,cabinetCallback,cabinetLinks} from './telegramCabinet.js';
import {handleBetaCallback,handleBetaMessage,registerAdminCommands,startBetaOutbox} from './betaBot.js';

export type BotMessage={message_id:number;chat:{id:number;type:string};from?:{id:number;username?:string};text?:string;caption?:string;contact?:{phone_number:string;user_id?:number}};
export type CallbackQuery={id:string;from:{id:number;username?:string};message?:BotMessage;data?:string};
export type InlineQuery={id:string;from:{id:number;username?:string};query:string;offset?:string};
type BotUpdate={update_id:number;message?:BotMessage;callback_query?:CallbackQuery;inline_query?:InlineQuery};
const queues=new Map<string,Promise<void>>();
const privateDir=path.resolve(process.env.OSKOLOK_PRIVATE_DIR||'server/data/private');
const offsetFile=path.join(privateDir,'bot-update-offset');
const clearKeyboard={remove_keyboard:true};
const phoneKeyboard={keyboard:[[{text:'Поделиться своим номером',request_contact:true}]],resize_keyboard:true,one_time_keyboard:true};
/** Тяжёлые модули (каталог, аудио) грузим только когда бот реально играет музыку. */
const playback=()=>import('./telegramPlayback.js');

function enqueue(sender:string,task:()=>Promise<void>){
  const previous=queues.get(sender)||Promise.resolve();
  const next=previous.catch(()=>{}).then(task).catch(error=>{
    logger.warn({sender,reason:error instanceof Error?error.message:String(error),event:'telegram.bot.failed'},'Telegram bot operation failed');
    void sorry(sender);
  });
  queues.set(sender,next);
  void next.finally(()=>{if(queues.get(sender)===next)queues.delete(sender);});
  return next;
}
const sorryAt=new Map<string,number>();
/** Баннер ошибки — не чаще раза в минуту на пользователя, чтобы сбой не превращался в спам. */
async function sorry(sender:string){
  if(Date.now()-(sorryAt.get(sender)||0)<60000)return;sorryAt.set(sender,Date.now());
  await sendBanner(sender,'error',new Msg().e('warn').t(' ').b('Что-то пошло не так').n().t('Мы уже знаем об этом. Попробуйте ещё раз через минуту.'),await menuKeyboard()).catch(()=>{});
}
/** Уведомление пользователю (модерация текста, ответ на обращение…). Иконка подбирается по смыслу, кнопка ведёт в Осколок. */
export async function notifyUser(userId:string,text:string){
  if(!env.TELEGRAM_BOT_TOKEN||!/^telegram:\d+$/.test(userId))return;
  const icon=/одобрен|решено|принято|опубликован/i.test(text)?'check':/отклон/i.test(text)?'info':'bell';
  const url=await menuUrl();
  await sendText(userId.slice(9),new Msg().e(icon).t(' ').t(text),url?{inline_keyboard:[[{text:'Открыть Осколок',web_app:{url}}]]}:undefined);
}
async function say(sender:string,text:string,reply_markup?:Markup){
  await sendText(sender,new Msg().t(text),reply_markup);
}
let menu:{url?:string;at:number}={at:0};
async function menuUrl(){
  if(Date.now()-menu.at<600000)return menu.url;
  try{const m=await api<{type:string;web_app?:{url:string}}>('getChatMenuButton');menu={url:m.web_app?.url&&/^https:\/\//.test(m.web_app.url)?m.web_app.url:undefined,at:Date.now()};}
  catch{menu={url:menu.url,at:Date.now()-540000};}
  return menu.url;
}
let inlineMode:boolean|undefined;
async function supportsInline(){
  if(inlineMode===undefined)try{inlineMode=!!(await api<{supports_inline_queries?:boolean}>('getMe')).supports_inline_queries;}catch{return false;}
  return inlineMode;
}
async function menuKeyboard(extra:Array<Array<Record<string,unknown>>>=[]):Promise<Markup>{
  return {inline_keyboard:[...(cabinetKeyboard()!.inline_keyboard as Array<unknown>),...extra]};
}
async function deleteSecret(message:BotMessage){
  await api('deleteMessage',{chat_id:message.chat.id,message_id:message.message_id}).catch(()=>{});
}
function announceLogin(login:NonNullable<ReturnType<typeof loginStatus>>){
  if(!login.botChatId)return;
  const sender=login.botChatId;
  const snapshot={...login};
  enqueue(sender,async()=>{
    const login=snapshot;
    if(login.state==='code')await say(sender,`${login.error?`${login.error}\n\n`:''}${({app:'Код отправлен в служебный чат «Telegram» на ваших устройствах.',sms:'Код придёт по SMS.',call:'Telegram позвонит: код — последние цифры номера или продиктует робот.',email:`Код отправлен на почту входа${login.emailPattern?` ${login.emailPattern}`:''}.`,fragment:'Код придёт в Fragment (анонимный номер).'} as Record<string,string>)[login.codeChannel||'']||'Telegram отправил код подтверждения.'}\nВернитесь в Осколок и введите код в форме входа. Не отправляйте код в чат: Telegram аннулирует его.`,clearKeyboard);
    else if(login.state==='password')await say(sender,`Введите в форме Осколка облачный пароль двухэтапной проверки${login.passwordHint?` (подсказка: ${login.passwordHint})`:''}. Пароль используется только для этого входа.`,clearKeyboard);
    else if(login.state==='connected')await sendText(sender,new Msg().e('check').t(' ').b('Telegram подключён к Осколку').n().t('Вернитесь в Осколок: там появится подтверждение.'),login.appUrl?.startsWith('https://')?{inline_keyboard:[[{text:'Вернуться в Осколок',web_app:{url:login.appUrl}}]]}:undefined);
    else if(login.state==='error')await say(sender,`${login.error||'Не удалось завершить вход.'}\nОткройте Осколок и начните подключение снова.`,clearKeyboard);
  });
}
const handledMessages=new Map<string,number>();
const seen=(key:string)=>{
  if(handledMessages.has(key))return true;
  handledMessages.set(key,Date.now());
  for(const [k,at] of handledMessages)if(Date.now()-at>86400000)handledMessages.delete(k);
  return false;
};
async function welcome(sender:string){await sendCabinet(sender,true);}
const searches=new Map<string,{tracks:import('./telegramPlayback.js').SessionTrack[];at:number}>();
async function search(sender:string,query:string,editId?:number){
  const q=query.trim().slice(0,200);
  if(!q){await sendText(sender,new Msg().e('search').t(' Напишите, что найти: ').code('/search Земфира — Хочешь'));return;}
  await chatAction(sender,'typing');
  const {searchTracks}=await playback();
  const tracks=await searchTracks(q,8);
  if(!tracks.length){await sendText(sender,new Msg().e('search').t(' По запросу «').b(q).t('» ничего не нашлось. Попробуйте иначе.'));return;}
  const token=randomBytes(4).toString('hex');
  for(const [k,v] of searches)if(Date.now()-v.at>1800000)searches.delete(k);
  searches.set(token,{tracks,at:Date.now()});
  const m=new Msg().e('search').t(' ').b(q).n().i('Нажмите на трек — бот пришлёт его в плеер Telegram, остальные встанут в очередь.');
  const markup={inline_keyboard:tracks.map((t,i)=>[{text:`${t.artist.name} — ${t.title}`.slice(0,64),callback_data:`s:${token}:${i}`}])};
  if(editId)await editText(sender,editId,m,markup);else await sendText(sender,m,markup);
}
/** deep link p_<base64url(trackId)> — из инлайн-результатов и шеринга. */
export const trackLink=(trackId:string)=>{const p=`p_${Buffer.from(trackId).toString('base64url')}`;return p.length<=64?`https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${p}`:undefined;};
export async function handleBotMessage(message:BotMessage){
  if(message.chat.type!=='private'||!message.from)return;
  const sender=String(message.from.id),text=(message.text||'').trim(),userId=`telegram:${sender}`;
  if(seen(`${sender}:${message.message_id}`))return;
  await registerBetaBotContact(userId,message.from.username);
  // Beta application confirmation (any visitor) and admin commands come before the beta gate.
  if(await handleBetaMessage(message))return;
  const beta=await checkBetaAccess(userId,message.from.username);
  const publicCommand=text.match(/^\/(start|menu|profile|info|downloads|help)(?:@\w+)?\s*$/i)?.[1]?.toLowerCase();
  if(publicCommand){await sendCabinet(sender,beta,message.from.username,publicCommand==='profile'?'profile':publicCommand==='info'||publicCommand==='help'?'info':publicCommand==='downloads'?'downloads':'home');return;}
  if(!beta){await sendCabinet(sender,false,message.from.username,'beta');return;}
  const start=text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/i);
  if(start){
    const param=start[1]||'';
    if(param.startsWith('connect_')){
      if(!attachBotLogin(param.slice(8),sender)){
        await say(sender,'Эта ссылка устарела или открыта другим аккаунтом. Вернитесь в Осколок и нажмите «Продолжить в боте» ещё раз.');return;
      }
      await say(sender,'Продолжим подключение Telegram к Осколку. Отправьте номер вашего аккаунта в формате +375… или поделитесь своим контактом кнопкой ниже.',phoneKeyboard);return;
    }
    if(param.startsWith('p_')){
      const id=Buffer.from(param.slice(2),'base64url').toString('utf8');
      const {playTracksInTelegram,compactTrack}=await playback();
      const {trackController}=await import('../controllers/trackController.js');
      const track=await trackController.resolveTrack(id).catch(()=>null);
      const compact=track&&track.access==='playable'?compactTrack(track):null;
      if(!compact){await sendText(sender,new Msg().e('warn').t(' Этот трек сейчас недоступен.'));return;}
      await sendText(sender,new Msg().e('headphones').t(' Отправляю ').b(`${compact.artist.name} — ${compact.title}`).t('…'));
      await playTracksInTelegram(userId,[compact],0);return;
    }
    await welcome(sender);return;
  }
  // Quick-menu buttons arrive as plain text.
  if(text===QUICK.now){const {sendNowCard}=await playback();if(!await sendNowCard(sender,userId))await sendText(sender,new Msg().e('music').t(' Сейчас ничего не играет. Включите «Мою волну» или найдите трек.'),{inline_keyboard:[[{text:'🌊 Моя волна',callback_data:'wave:new'}]]});return;}
  if(text===QUICK.wave){await chatAction(sender,'typing');await sendWave(sender,userId);return;}
  if(text===QUICK.liked){await sendLiked(sender,userId);return;}
  if(text===QUICK.search){await sendText(sender,new Msg().e('search').t(' Напишите название трека или исполнителя — просто сообщением.'));return;}
  const command=text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/)?.slice(1)||[];
  const [name,arg='']=command;
  if(name==='wave'){await chatAction(sender,'typing');await sendWave(sender,userId);return;}
  if(name==='similar'){await chatAction(sender,'typing');await sendSimilar(sender,userId);return;}
  if(name==='liked'){await sendLiked(sender,userId);return;}
  if(name==='lyrics'){await chatAction(sender,'typing');await sendLyrics(sender,userId);return;}
  if(name==='menu'){await sendText(sender,new Msg().e('music').t(' Быстрое меню снова под полем ввода.'),quickKeyboard as unknown as Markup);return;}
  if(name==='help'){
    await sendText(sender,new Msg().e('info').t(' ').b('Что умеет Осколок').n(2)
      .t('• Слушать музыку, сохранять треки и плейлисты, искать тексты — в мини-приложении.').n()
      .t('• Источник «Telegram»: треки приходят сюда и играют в фоне нативным плеером. ⏮ ⏯ ⏭ под треком листают очередь.').n()
      .t('• Трек в профиле Telegram: Профиль → Telegram → «Продолжить в боте».').n(2)
      .t('/wave — моя волна, /similar — похожие на текущий, /lyrics — текст песни, /liked — любимое.').n().t('/search — найти трек, /now — что играет, /queue — очередь, /like — в любимые, /status — подключение, /menu — быстрое меню.').n(2)
      .i('Код и облачный пароль вводите только в форме Осколка: отправка кода в чат аннулирует его.'),await menuKeyboard());return;
  }
  if(name==='status'){
    const {sessionHealth}=await import('./telegramSession.js');
    const h=await sessionHealth(userId);
    const m=h.state==='connected'?new Msg().e('check').t(' ').b('Telegram подключён к Осколку').n().t('Трек в профиле обновляется автоматически.')
      :h.state==='needs_relogin'?new Msg().e('warn').t(' ').b('Нужно войти заново').n().t('Telegram завершил сессию Осколка. Профиль → Telegram → «Продолжить в боте».')
      :h.state==='rate_limited'?new Msg().e('refresh').t(' ').b('Telegram просит подождать').n().t(`Обновим трек через ${Math.max(1,Math.ceil(((h.retryAt||Date.now())-Date.now())/60000))} мин.`)
      :h.state==='reconnecting'?new Msg().e('refresh').t(' ').b('Переподключаемся к Telegram…').n().t('Это займёт несколько секунд.')
      :new Msg().e('profile').t(' Пользовательская сессия ещё не подключена. Начните в мини-приложении: Профиль → Telegram → «Продолжить в боте».');
    await sendText(sender,m,await menuKeyboard());return;
  }
  if(name==='requests'){
    const reports=await prisma.userReport.findMany({where:{userId},orderBy:{createdAt:'desc'},take:5});
    const m=new Msg().e('chat').t(' ').b('Мои обращения').n(2);
    if(reports.length)reports.forEach(r=>m.t(`№ ${r.id.slice(0,8)} · ${r.status} · ${r.reason}${r.reviewNote?' — '+r.reviewNote:''}`).n());else m.t('У вас пока нет обращений.');
    await sendText(sender,m,await menuKeyboard());return;
  }
  if(name==='search'){await search(sender,arg);return;}
  if(name==='now'){
    const {sendNowCard}=await playback();
    if(!await sendNowCard(sender,userId))await sendBanner(sender,'now',new Msg().e('music').t(' ').b('Сейчас ничего не играет').n().t('Включите трек в Осколке или найдите его: ').code('/search название'),await menuKeyboard());
    return;
  }
  if(name==='queue'){
    const {queueView}=await playback();
    const view=await queueView(userId);
    if(view)await sendText(sender,view.msg,view.markup);else await sendText(sender,new Msg().e('list').t(' Очередь пуста. Включите плейлист в Осколке или найдите трек через /search.'),await menuKeyboard());
    return;
  }
  if(name==='like'){
    const {likeCurrent}=await playback();
    const track=await likeCurrent(userId);
    await sendText(sender,track?new Msg().e('heart').t(' ').b(`${track.artist.name} — ${track.title}`).t(' в любимых.'):new Msg().e('info').t(' Сейчас ничего не играет — нечего добавить в любимые.'));return;
  }
  const active=botLoginForUser(sender);
  if(name==='cancel'){
    if(active)cancelLogin(active.id);
    await say(sender,'Подключение отменено. Начать снова можно из мини-приложения.',clearKeyboard);return;
  }
  if(!active){
    // Обычный текст без команды — это поиск: так боту проще пользоваться.
    if(text&&!text.startsWith('/')&&!message.contact){await search(sender,text);return;}
    await say(sender,'Откройте мини-приложение через кнопку меню или найдите трек: /search название.');return;
  }
  const {id,login}=active;
  if(login.state==='bot_phone'){
    if(message.contact?.user_id&&String(message.contact.user_id)!==sender){await say(sender,'Пришлите номер именно вашего Telegram-аккаунта.');return;}
    try{startBotPhoneLogin(id,message.contact?.phone_number?`+${message.contact.phone_number.replace(/^\+/,'')}`:text);await say(sender,'Запрашиваю код у Telegram…',clearKeyboard);}
    catch(error){await say(sender,error instanceof Error?error.message:'Проверьте номер и попробуйте ещё раз.');}
  }else if(login.state==='code'||login.state==='password'){
    await deleteSecret(message);
    await say(sender,'Введите код или облачный пароль в форме Осколка. Telegram аннулирует коды, отправленные в чат. Если код уже отправлен, отмените вход и запросите новый.',login.appUrl&&login.appUrl.startsWith('https://')?{inline_keyboard:[[{text:'Продолжить вход',web_app:{url:login.appUrl}}]]}:await menuKeyboard());
  }else await say(sender,'Подождите, Telegram ещё проверяет вход.');
}
/** Нажатия инлайн-кнопок: короткий тост в ответ, длинные ответы — правкой того же сообщения. */
export async function handleCallback(q:CallbackQuery){
  const sender=String(q.from.id),userId=`telegram:${sender}`,data=q.data||'';
  if(seen(`cb:${q.id}`))return;
  if(q.message?.chat.type==='private')await registerBetaBotContact(userId,q.from.username);
  if(data.startsWith('ba:')){await handleBetaCallback(q);return;}
  if(data.startsWith('cabinet:')){
    const message=q.message?.chat.type==='private'&&String(q.message.chat.id)===sender?{messageId:q.message.message_id,hasPhoto:q.message.caption!==undefined}:undefined;
    await cabinetCallback(q.id,sender,data,await checkBetaAccess(userId,q.from.username),q.from.username,message);return;
  }
  if(!await checkBetaAccess(userId,q.from.username)){await answerCallback(q.id,BETA_DENIED_MESSAGE,true);return;}
  const p=await playback();
  const title=(s:{queue:Array<{title:string}>;index:number}|null|undefined)=>s?.queue[s.index]?.title||'';
  if(data==='pb:next'||data==='pb:prev'){
    const r=await p.stepPlayback(userId,data==='pb:next'?1:-1);
    await answerCallback(q.id,!r?'Очередь пуста — включите музыку в Осколке.':r.moved?`${data==='pb:next'?'⏭':'⏮'} ${title(r.state)}`:data==='pb:next'?'Это последний трек в очереди.':'Это первый трек.');return;
  }
  if(data==='pb:retry'){const r=await p.stepPlayback(userId,0);await answerCallback(q.id,r?`↻ ${title(r.state)}`:'Очередь пуста.');return;}
  if(data.startsWith('pb:jump:')){const r=await p.jumpPlayback(userId,Number(data.slice(8))||0);await answerCallback(q.id,r?`▶︎ ${title(r.state)}`:'Очередь пуста.');return;}
  if(data==='pb:toggle'){
    const s=await p.togglePlayback(userId);
    await answerCallback(q.id,!s?'Очередь пуста.':s.isPlaying?'▶︎ Продолжаем. Нажмите на трек выше — его сыграет плеер Telegram.':'⏸ Пауза: следующие треки не будут приходить, пока не продолжите.');return;
  }
  if(data==='pb:like'){const t=await p.likeCurrent(userId);await answerCallback(q.id,t?`❤️ «${t.title}» в любимых`:'Сейчас ничего не играет.');return;}
  if(data==='pb:here'){
    const now=await p.currentTrack(userId);
    if(!now){await answerCallback(q.id,'Сейчас ничего не играет.');return;}
    await answerCallback(q.id,`🎧 Отправляю «${now.track.title}»`);
    if(now.state?.queue[now.state.index]?.id===now.track.id)await p.startTelegramPlayback(userId,{queueHash:now.state.queueHash,index:now.state.index});
    else await p.playTracksInTelegram(userId,[now.track],0);
    return;
  }
  if(data==='now'){await answerCallback(q.id);if(!await p.sendNowCard(sender,userId))await sendText(sender,new Msg().e('music').t(' Сейчас ничего не играет. Найдите трек: ').code('/search название'));return;}
  if(data==='wave:new'){await answerCallback(q.id,'🌊 Собираю волну…');await sendWave(sender,userId,q.message?.text!==undefined?q.message.message_id:undefined);return;}
  if(data==='sim'){await answerCallback(q.id,'Подбираю похожие…');await sendSimilar(sender,userId);return;}
  if(data==='ly'){await answerCallback(q.id);await sendLyrics(sender,userId);return;}
  const l=data.match(/^l:([0-9a-f]{8}):(\d+)$/);
  if(l){const t=await playFromList(userId,l[1],Number(l[2]));await answerCallback(q.id,t?`🎧 Отправляю «${t.title}»`:'Список устарел — откройте его снова.',!t);return;}
  const lp=data.match(/^lp:([0-9a-f]{8}):(\d+)$/);
  if(lp){const ok=await pageList(sender,q.message?.message_id,lp[1],Number(lp[2]));await answerCallback(q.id,ok?undefined:'Список устарел — откройте его снова.',!ok);return;}
  if(data==='help:search'){await answerCallback(q.id);await sendText(sender,new Msg().e('search').t(' Напишите название трека или исполнителя — просто сообщением или так: ').code('/search Кино — Группа крови'));return;}
  if(/^q:\d+$/.test(data)){
    const view=await p.queueView(userId,Number(data.slice(2)));
    await answerCallback(q.id,view?undefined:'Очередь пуста.');
    if(view)await p.editOrSend(sender,q.message?.text!==undefined?q.message.message_id:undefined,view.msg,view.markup);
    return;
  }
  const s=data.match(/^s:([0-9a-f]{8}):(\d+)$/);
  if(s){
    const found=searches.get(s[1]);
    if(!found){await answerCallback(q.id,'Результаты устарели — повторите поиск.',true);return;}
    const i=Math.min(Number(s[2]),found.tracks.length-1);
    await answerCallback(q.id,`🎧 Отправляю «${found.tracks[i].title}»`);
    await p.playTracksInTelegram(userId,found.tracks,i);return;
  }
  await answerCallback(q.id);
}
/** Инлайн-режим (@бот запрос): уже отправленные треки — сразу аудио по file_id, остальные — карточка со ссылкой «Слушать». */
export async function handleInline(q:InlineQuery){
  const userId=`telegram:${q.from.id}`,text=q.query.trim();
  if(text.length<2){await api('answerInlineQuery',{inline_query_id:q.id,results:[],cache_time:5,button:{text:'Введите название трека',start_parameter:'inline'}}).catch(()=>{});return;}
  if(!await checkBetaAccess(userId,q.from.username)){await api('answerInlineQuery',{inline_query_id:q.id,results:[],cache_time:60,is_personal:true}).catch(()=>{});return;}
  const {searchTracks}=await playback();
  const tracks=await searchTracks(text,10);
  const cache=await prisma.telegramAudioCache.findMany({where:{trackId:{in:tracks.map(t=>t.id)}}});
  const results=tracks.map((t,i)=>{
    const cached=cache.find(c=>c.trackId===t.id),link=trackLink(t.id),id=`${i}-${Buffer.from(t.id).toString('base64url').slice(0,48)}`;
    if(cached)return {type:'audio',id,audio_file_id:cached.fileId,caption:'Осколок',...(link?{reply_markup:{inline_keyboard:[[{text:'▶️ Слушать в Осколке',url:link}]]}}:{})};
    return {type:'article',id,title:t.title,description:t.artist.name,...(t.artworkUrl?.startsWith('https://')?{thumbnail_url:t.artworkUrl}:{}),input_message_content:{message_text:`🎵 ${t.artist.name} — ${t.title}`},...(link?{reply_markup:{inline_keyboard:[[{text:'▶️ Слушать в Осколке',url:link}]]}}:{})};
  });
  await api('answerInlineQuery',{inline_query_id:q.id,results,cache_time:60});
}

async function poll(){
  mkdirSync(privateDir,{recursive:true,mode:0o700});
  let offset=existsSync(offsetFile)?Number(readFileSync(offsetFile,'utf8')):0;
  if(!Number.isSafeInteger(offset)||offset<0)offset=0;
  const allowed_updates=['message','callback_query','inline_query'];
  if(!offset){
    try{const last=await api<BotUpdate[]>('getUpdates',{offset:-1,limit:1,timeout:0,allowed_updates});offset=(last.at(-1)?.update_id||0)+1;writeFileSync(offsetFile,String(offset),{mode:0o600});}
    catch(error){logger.warn({reason:error instanceof Error?error.message:String(error)},'Telegram bot initial poll failed');}
  }
  logger.info('Telegram bot is ready for private messages');
  let lastError='',lastErrorLogged=0,failures=0;
  while(true){
    try{
      const updates=await api<BotUpdate[]>('getUpdates',{offset,timeout:10,limit:50,allowed_updates},25000);
      if(failures)logger.info({failures,event:'telegram.bot.poll_recovered'},'Telegram bot polling recovered');
      lastError='';failures=0;
      for(const update of updates){
        // Persist before delivery: a restart must not repeat a sent message with an unknown result.
        offset=update.update_id+1;
        writeFileSync(offsetFile,String(offset),{mode:0o600});
        if(update.message?.from)await enqueue(String(update.message.from.id),()=>handleBotMessage(update.message!));
        else if(update.callback_query)void enqueue(String(update.callback_query.from.id),()=>handleCallback(update.callback_query!));
        else if(update.inline_query)void handleInline(update.inline_query).catch(error=>logger.warn({reason:error instanceof Error?error.message:String(error),event:'telegram.bot.inline_failed'},'Inline query failed'));
      }
    }catch(error){
      const reason=error instanceof Error?error.message:String(error);
      failures++;
      if(reason!==lastError||Date.now()-lastErrorLogged>600000){logger.warn({reason,failures,event:'telegram.bot.poll_failed'},'Telegram bot polling failed');lastError=reason;lastErrorLogged=Date.now();}
      // 409 — второй экземпляр забрал getUpdates; ждём дольше, остальное — экспонента до 30 с.
      await new Promise(resolve=>setTimeout(resolve,/Conflict|409/.test(reason)?15000:Math.min(30000,1000*2**Math.min(failures,5))));
    }
  }
}

export function startTelegramBot(){
  if(!env.TELEGRAM_BOT_TOKEN)return;
  setBotLoginNotifier(announceLogin);
  const commands=[
    {command:'start',description:'Личный кабинет'},
    {command:'profile',description:'Мой профиль'},
    {command:'downloads',description:'Скачать приложения'},
    {command:'info',description:'Об Осколке'},
    {command:'wave',description:'Моя волна'},
    {command:'now',description:'Что сейчас играет'},
    {command:'lyrics',description:'Текст текущего трека'},
    {command:'similar',description:'Похожие на текущий'},
    {command:'liked',description:'Любимые треки'},
    {command:'menu',description:'Показать быстрое меню'},
    {command:'search',description:'Найти трек'},
    {command:'queue',description:'Очередь'},
    {command:'like',description:'Добавить трек в любимые'},
    {command:'status',description:'Проверить подключение'},
    {command:'requests',description:'Мои обращения'},
    {command:'help',description:'Что умеет бот'},
    {command:'cancel',description:'Отменить вход'},
    {command:'beta_status',description:'Статус заявки на бету'},
  ];
  void api('setMyCommands',{commands}).then(()=>registerAdminCommands(commands)).catch(error=>logger.warn({reason:error instanceof Error?error.message:String(error)},'Telegram bot commands setup failed'));
  void startBetaOutbox().catch(error=>logger.warn({reason:error instanceof Error?error.message:String(error)},'Beta outbox failed to start'));
  void api('setChatMenuButton',{menu_button:{type:'commands'}}).catch(()=>{});
  void poll();
}
