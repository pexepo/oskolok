import {env} from '../config/env.js';
import {prisma} from '../database/client.js';
import {logger} from '../utils/logger.js';
import {api,answerCallback,BotApiError,editText,isNotModified,Msg,sendBanner,sendText,type Markup} from './telegramBotApi.js';
import {
 applicationEvents,applicationsForTelegramUser,BETA_PLATFORMS,betaStats,decideApplication,displayNumber,exportApplicationsCsv,
 isBetaOpen,listApplications,parsePlatforms,PLATFORM_LABELS,purgeOldApplications,setApplicationNote,setBetaOpen,STATUS_LABELS,
 verifyApplication,type BetaPlatform,type BetaStatus,type ListFilter,
} from './betaApplications.js';

type Row=Awaited<ReturnType<typeof prisma.betaApplication.findUniqueOrThrow>>;
type From={id:number;username?:string};
type Message={message_id:number;chat:{id:number;type:string};from?:From;text?:string};
type Callback={id:string;from:From;message?:Message;data?:string};
type AdminMessage={chat:string;id:number;unknown?:boolean};

export const betaAdminIds=()=>String(env.BETA_ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(id=>/^\d{1,15}$/.test(id));
/** Admin rights come only from numeric IDs in the server environment, never from a username. */
export const isBetaAdmin=(id:number|string)=>betaAdminIds().includes(String(id));
const site=()=>(env.PUBLIC_SITE_URL||'https://oskolok.lol').replace(/\/$/,'');
const LINE='━━━━━━━━━━━━━━━━';
const fmtDate=(d:Date,withTime=false)=>new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit'}:{}),timeZone:'Europe/Moscow'}).format(d);
const platformsText=(row:Row)=>parsePlatforms(row.platforms).map(p=>PLATFORM_LABELS[p]).join(', ')||'не указаны';
const parseMessages=(value:string):AdminMessage[]=>{try{const list=JSON.parse(value);return Array.isArray(list)?list.filter(m=>m&&typeof m.chat==='string'&&Number.isInteger(m.id)):[];}catch{return [];}};
const reason=(error:unknown)=>error instanceof Error?error.message:String(error);
/** 4xx except 429: Telegram refused, nothing was delivered. 429: not delivered, try later. Anything else may have arrived. */
const outcome=(error:unknown):'refused'|'retry'|'unknown'=>error instanceof BotApiError?(error.code===429?'retry':error.code>=400&&error.code<500?'refused':'unknown'):'unknown';

function userLine(row:Row){
 const m=new Msg().t('👤 Telegram: ').b(`@${row.telegramUsername}`);
 if(row.telegramUserId){
  if(row.verifiedUsername&&row.verifiedUsername!==row.telegramUsername)m.t(' · в Telegram: ').b(`@${row.verifiedUsername}`);
  else if(!row.verifiedUsername)m.t(' · у аккаунта нет username');
 }
 return m;
}
function profileUrl(row:Row){
 // Only a username confirmed by Telegram itself makes a correct profile link.
 return row.telegramUserId&&row.verifiedUsername&&/^[a-z][a-z0-9_]{3,31}$/.test(row.verifiedUsername)?`https://t.me/${row.verifiedUsername}`:undefined;
}

/** The admin card. Pending cards carry decision buttons; decided ones only notes and details. */
export function applicationCard(row:Row):{msg:Msg;markup:Markup}{
 const status=row.status as BetaStatus,m=new Msg();
 const append=(other:Msg)=>{const offset=m.text.length;m.text+=other.text;for(const e of other.entities)m.entities.push({...e,offset:e.offset+offset});};
 if(status==='pending'){
  m.t(`${LINE}\n`).b('💎 OSKOLOK — НОВАЯ ЗАЯВКА').t(`\n${LINE}\n\n`);
  append(userLine(row));m.n();
  m.t(row.telegramUserId?`🆔 Telegram ID: ${row.telegramUserId.slice(9)} · подтверждён ✅`:'⚠️ Telegram ещё не подтверждён').n(2);
  m.b('🎯 Цель:').n().t(row.purpose).n(2);
  m.b('💬 О себе:').n().t(row.about).n(2);
  m.b('📱 Платформы:').n().t(platformsText(row)).n(2);
  m.t(`🆔 Заявка: ${displayNumber(row.id)}`).n(2).t(`📅 Дата:\n${fmtDate(row.createdAt)}`).n(2).t(`📌 Статус: ${STATUS_LABELS.pending}`);
  if(row.adminComment)m.n(2).t('🗒 Комментарий: ').i(row.adminComment);
  m.t(`\n\n${LINE}`);
 }else{
  m.b(status==='approved'?'✅ ЗАЯВКА ОДОБРЕНА':status==='rejected'?'❌ ЗАЯВКА ОТКЛОНЕНА':'🔁 ПОВТОРНАЯ ЗАЯВКА').n(2);
  m.t('Пользователь: ').b(`@${row.verifiedUsername||row.telegramUsername}`).n();
  m.t(`Заявка: ${displayNumber(row.id)}`).n();
  m.t(`Решение: ${status==='approved'?'Принято':status==='rejected'?'Отклонено':'Объединена с активной заявкой'}`);
  if(row.reviewedAt)m.n().t(`Когда: ${fmtDate(row.reviewedAt,true)}${row.reviewedBy?` · ID ${row.reviewedBy.replace(/^telegram:/,'')}`:''}`);
  if(row.rejectionReason)m.n().t('📝 Причина (видна заявителю): ').i(row.rejectionReason);
  if(row.adminComment)m.n().t('🗒 Комментарий (внутренний): ').i(row.adminComment);
  if(status!=='duplicate'&&row.userNotifyState!=='none')m.n().t(`✉️ Уведомление: ${{pending:'в очереди',sending:'отправляется',sent:'доставлено',failed:'бот заблокирован пользователем',unknown:'результат неизвестен'}[row.userNotifyState]||row.userNotifyState}`);
 }
 const profile=profileUrl(row);
 const second=[...(profile?[{text:'👤 Профиль',url:profile}]:[]),{text:'📋 Подробнее',callback_data:`ba:info:${row.id}`}];
 const rows:Array<Array<Record<string,unknown>>>=[];
 if(status==='pending'&&row.telegramUserId)rows.push([{text:'✅ Принять',callback_data:`ba:ok:${row.id}`},{text:'❌ Отклонить',callback_data:`ba:no:${row.id}`}]);
 else if(status==='pending')rows.push([{text:'❌ Отклонить',callback_data:`ba:no:${row.id}`}]);
 rows.push(second);
 rows.push([{text:'💬 Комментарий',callback_data:`ba:cm:${row.id}`},...(status==='rejected'?[{text:'📝 Причина отказа',callback_data:`ba:rs:${row.id}`}]:[])]);
 return {msg:m,markup:{inline_keyboard:rows}};
}

/* ── Delivery (outbox) ────────────────────────────────────────────────────── */

let adminBusy=false,userBusy=false;
/** Sends new confirmed applications to every admin. Delivered and unknown results are never resent. */
export async function deliverAdminNotifications(){
 if(adminBusy||!env.TELEGRAM_BOT_TOKEN||!betaAdminIds().length)return;
 adminBusy=true;
 try{
  const due=await prisma.betaApplication.findMany({where:{adminNotifyState:'pending'},orderBy:{id:'asc'},take:10});
  for(const row of due){
   const claimed=await prisma.betaApplication.updateMany({where:{id:row.id,adminNotifyState:'pending'},data:{adminNotifyState:'sending'}});
   if(!claimed.count)continue;
   const messages=parseMessages(row.adminMessages);let retry=false;
   const card=applicationCard(row);
   for(const chat of betaAdminIds()){
    if(messages.some(m=>m.chat===chat))continue;
    try{const sent=await sendText(chat,card.msg,card.markup);messages.push({chat,id:sent.message_id});}
    catch(error){
     const kind=outcome(error);
     if(kind==='retry')retry=true;else if(kind==='unknown')messages.push({chat,id:0,unknown:true});
     logger.warn({event:'beta.admin_notify_failed',id:row.id,kind,reason:reason(error)},'Beta admin notification failed');
    }
   }
   await prisma.betaApplication.updateMany({where:{id:row.id,adminNotifyState:'sending'},data:{adminNotifyState:retry?'pending':'sent',adminMessages:JSON.stringify(messages)}});
  }
 }catch(error){logger.warn({event:'beta.admin_outbox_failed',reason:reason(error)},'Beta admin outbox failed');}
 finally{adminBusy=false;}
}

function decisionMessage(row:Row):{msg:Msg;markup:Markup}{
 if(row.status==='approved')return {
  msg:new Msg().b('🎉 Поздравляем!').n(2).t('Твоя заявка на бета-тестирование Осколка одобрена.').n(2).t('Теперь тебе доступно участие в закрытом тестировании.').n(2).i('Войди на сайте или в приложении через этот Telegram-аккаунт — доступ уже привязан к нему.'),
  markup:{inline_keyboard:[[{text:'Перейти к Осколку',url:`${site()}/app`}],[{text:'Скачать приложение',url:`${site()}/download`}]]},
 };
 return {
  msg:new Msg().t('Спасибо за интерес к Осколку!').n(2).t('К сожалению, сейчас мы не можем предоставить тебе доступ к закрытому бета-тестированию.').n(2).t('Следи за новостями в канале — наборы ещё будут.'),
  markup:{inline_keyboard:[[{text:'Канал Осколка',url:'https://t.me/oskolokch'}],[{text:'Статус заявки',url:`${site()}/beta/status`}]]},
 };
}

/** Tells applicants about decisions. Each decision is delivered at most once: unknown results are not repeated. */
export async function deliverUserNotifications(onlyId?:number){
 if(userBusy||!env.TELEGRAM_BOT_TOKEN)return;
 userBusy=true;
 try{
  const due=await prisma.betaApplication.findMany({where:{userNotifyState:'pending',status:{in:['approved','rejected']},telegramUserId:{not:null},...(onlyId?{id:onlyId}:{})},orderBy:{id:'asc'},take:20});
  for(const row of due){
   const claimed=await prisma.betaApplication.updateMany({where:{id:row.id,userNotifyState:'pending',status:row.status},data:{userNotifyState:'sending',userNotifyAttempts:{increment:1}}});
   if(!claimed.count)continue;
   let state='sent';
   try{
    const {msg,markup}=decisionMessage(row),chat=row.telegramUserId!.slice(9);
    if(row.status==='approved')await sendBanner(chat,'beta-approved',msg,markup);else await sendText(chat,msg,markup);
   }catch(error){
    const kind=outcome(error);
    state=kind==='refused'?'failed':kind==='retry'&&row.userNotifyAttempts<8?'pending':'unknown';
    logger.warn({event:'beta.user_notify_failed',id:row.id,kind,reason:reason(error)},'Beta decision notification failed');
   }
   const saved=await prisma.betaApplication.updateMany({where:{id:row.id,userNotifyState:'sending'},data:{userNotifyState:state}});
   if(saved.count)void syncAdminMessages(row.id);
  }
 }catch(error){logger.warn({event:'beta.user_outbox_failed',reason:reason(error)},'Beta user outbox failed');}
 finally{userBusy=false;}
}

/** Brings every admin copy of the card to the database state. A failed edit leaves the decision intact. */
export async function syncAdminMessages(id:number,extra?:{chat:string;id:number}){
 const row=await prisma.betaApplication.findUnique({where:{id}});
 if(!row)return;
 const card=applicationCard(row);
 const targets=parseMessages(row.adminMessages).filter(m=>m.id>0);
 if(extra&&!targets.some(t=>t.chat===extra.chat&&t.id===extra.id))targets.push(extra);
 await Promise.all(targets.map(t=>editText(t.chat,t.id,card.msg,card.markup).catch(error=>{
  if(!isNotModified(error))logger.warn({event:'beta.admin_edit_failed',id,reason:reason(error)},'Beta admin card edit failed');
 })));
}

let outboxTimer:ReturnType<typeof setInterval>|undefined;
export async function startBetaOutbox(){
 if(outboxTimer)return;
 // A crash between "sending" and the result: delivery may have happened, so it is never repeated.
 await prisma.betaApplication.updateMany({where:{adminNotifyState:'sending'},data:{adminNotifyState:'sent'}}).catch(()=>{});
 await prisma.betaApplication.updateMany({where:{userNotifyState:'sending'},data:{userNotifyState:'unknown'}}).catch(()=>{});
 let lastPurge=0;
 const tick=()=>{
  void deliverAdminNotifications();void deliverUserNotifications();
  if(Date.now()-lastPurge>6*3600000){lastPurge=Date.now();void purgeOldApplications().then(n=>{if(n)logger.info({event:'beta.purge',removed:n},'Old beta applications removed');}).catch(()=>{});}
 };
 outboxTimer=setInterval(tick,20000);outboxTimer.unref();
 tick();
}

/* ── Admin screens ────────────────────────────────────────────────────────── */

async function adminMenu():Promise<{msg:Msg;markup:Markup}>{
 const [s,open]=await Promise.all([betaStats(),isBetaOpen()]);
 const msg=new Msg().b('💎 OSKOLOK — ADMIN').n(2)
  .t(`📊 Заявок всего: ${s.total}`).n().t(`⏳ Ожидают: ${s.pending}`).n().t(`✅ Принято: ${s.approved}`).n().t(`❌ Отклонено: ${s.rejected}`).n()
  .t(`✉️ Не подтвердили Telegram: ${s.unverified}`).n(2).t('🚪 Набор: ').b(open?'ОТКРЫТ':'ЗАКРЫТ');
 return {msg,markup:{inline_keyboard:[
  [{text:'📥 Заявки',callback_data:'ba:l:pending:0'},{text:'📊 Статистика',callback_data:'ba:st'}],
  [open?{text:'🔒 Закрыть набор',callback_data:'ba:close'}:{text:'🔓 Открыть набор',callback_data:'ba:open'},{text:'⚙️ Настройки',callback_data:'ba:set'}],
 ]}};
}
async function statsScreen():Promise<{msg:Msg;markup:Markup}>{
 const s=await betaStats();
 const msg=new Msg().b('📊 Статистика бета-набора').n(2)
  .t(`Подтверждённых заявок: ${s.total}`).n().t(`За последние сутки (все): ${s.today}`).n()
  .t(`Ожидают решения: ${s.pending}`).n().t(`Принято: ${s.approved} · Отклонено: ${s.rejected}`).n()
  .t(`Одобрение: ${s.approvalRate===null?'ещё нет решений':`${s.approvalRate}%`}`).n()
  .t(`Не подтвердили Telegram: ${s.unverified} · Повторные: ${s.duplicates}`).n(2).b('Платформы').n();
 for(const p of BETA_PLATFORMS)msg.t(`${PLATFORM_LABELS[p]}: ${s.platforms[p]}`).n();
 return {msg,markup:{inline_keyboard:[[{text:'◀️ Меню',callback_data:'ba:adm'},{text:'⬇️ Экспорт CSV',callback_data:'ba:exp'}]]}};
}
async function settingsScreen():Promise<{msg:Msg;markup:Markup}>{
 const open=await isBetaOpen();
 const msg=new Msg().b('⚙️ Настройки').n(2).t('Набор: ').b(open?'открыт':'закрыт').n()
  .t(`Администраторов: ${betaAdminIds().length} (задаются числовыми ID в BETA_ADMIN_IDS на сервере)`).n(2)
  .t('Команды: /admin, /stats, /applications [pending|approved|rejected|unverified] [ios|android|…], /app 125, /find username, /open_beta, /close_beta, /beta_status, /export').n(2)
  .i('Неподтверждённые заявки удаляются через 30 дней, отклонённые — через 180.');
 return {msg,markup:{inline_keyboard:[[open?{text:'🔒 Закрыть набор',callback_data:'ba:close'}:{text:'🔓 Открыть набор',callback_data:'ba:open'}],[{text:'⬇️ Экспорт CSV',callback_data:'ba:exp'},{text:'◀️ Меню',callback_data:'ba:adm'}]]}};
}
const FILTERS:Array<[ListFilter['status'],string]>=[['pending','⏳'],['approved','✅'],['rejected','❌'],['unverified','✉️']];
const FILTER_TITLES:Record<string,string>={pending:'Ожидают решения',approved:'Одобренные',rejected:'Отклонённые',unverified:'Без подтверждения Telegram',duplicate:'Повторные'};
async function listScreen(filter:ListFilter,page:number):Promise<{msg:Msg;markup:Markup}>{
 const result=await listApplications(filter,page);
 const key=filter.status||'pending',pf=filter.platform||'';
 const msg=new Msg().b(`📥 ${FILTER_TITLES[key]||'Заявки'}${filter.platform?` · ${PLATFORM_LABELS[filter.platform]}`:''}${filter.username?` · «${filter.username}»`:''}`).n()
  .t(result.total?`Всего: ${result.total} · страница ${result.page+1}/${result.pages}`:'Здесь пока пусто.');
 const rows:Array<Array<Record<string,unknown>>>=result.items.map(r=>[{text:`${displayNumber(r.id)} · @${r.verifiedUsername||r.telegramUsername} · ${parsePlatforms(r.platforms).map(p=>PLATFORM_LABELS[p]).join(', ')||'—'}`.slice(0,60),callback_data:`ba:v:${r.id}`}]);
 if(!filter.username){
  const pager=[];
  if(page>0)pager.push({text:'◀️',callback_data:`ba:l:${key}:${page-1}:${pf}`});
  if(page+1<result.pages)pager.push({text:'▶️',callback_data:`ba:l:${key}:${page+1}:${pf}`});
  if(pager.length)rows.push(pager);
  rows.push(FILTERS.map(([s,icon])=>({text:s===key?`·${icon}·`:icon,callback_data:`ba:l:${s}:0:${pf}`})));
 }
 rows.push([{text:'◀️ Меню',callback_data:'ba:adm'}]);
 return {msg,markup:{inline_keyboard:rows}};
}
async function detailsScreen(id:number):Promise<{msg:Msg;markup:Markup}|null>{
 const row=await prisma.betaApplication.findUnique({where:{id}});
 if(!row)return null;
 const events=await applicationEvents(id);
 const titles:Record<string,string>={created:'Отправлена на сайте',verified:'Telegram подтверждён',approved:'Одобрена',rejected:'Отклонена',duplicate:'Повторная заявка',comment:'Комментарий изменён',reason:'Причина отказа изменена'};
 const m=new Msg().b(`📋 Заявка ${displayNumber(row.id)}`).n(2);
 m.t(`Статус: ${STATUS_LABELS[row.status as BetaStatus]||row.status}`).n();
 m.t(`Указанный username: @${row.telegramUsername}`).n();
 m.t(row.telegramUserId?`Telegram: ID ${row.telegramUserId.slice(9)}${row.verifiedUsername?` · @${row.verifiedUsername}`:''}`:'Telegram: не подтверждён').n();
 m.t(`Платформы: ${platformsText(row)}`).n().t(`Отправлена: ${fmtDate(row.createdAt,true)}`).n(2);
 m.b('🎯 Цель').n().t(row.purpose).n(2).b('💬 О себе').n().t(row.about).n(2);
 if(row.rejectionReason)m.b('📝 Причина отказа').n().t(row.rejectionReason).n(2);
 if(row.adminComment)m.b('🗒 Комментарий').n().t(row.adminComment).n(2);
 m.b('История').n();
 for(const e of events)m.t(`• ${fmtDate(e.createdAt,true)} — ${titles[e.type]||e.type}${e.actor.startsWith('telegram:')&&['approved','rejected','comment','reason'].includes(e.type)?` (ID ${e.actor.slice(9)})`:''}`).n();
 const card=applicationCard(row);
 return {msg:m,markup:card.markup};
}

async function show(chat:string,screen:{msg:Msg;markup:Markup},editId?:number){
 if(editId){try{await editText(chat,editId,screen.msg,screen.markup);return;}catch(error){if(isNotModified(error))return;}}
 await sendText(chat,screen.msg,screen.markup);
}
async function sendExport(chat:string){
 const csv=await exportApplicationsCsv();
 const form=new FormData();
 form.set('chat_id',chat);
 form.set('caption','Заявки на бету Осколка (CSV, UTF-8). Не пересылай файл: в нём личные данные заявителей.');
 form.set('document',new Blob([csv],{type:'text/csv'}),`oskolok-beta-${new Date().toISOString().slice(0,10)}.csv`);
 await api('sendDocument',form,30000);
 logger.info({event:'beta.export',actor:chat},'Beta applications exported');
}

/** Admin text input after «Комментарий» or «Причина отказа». Expires after ten minutes. */
const awaitingNote=new Map<string,{id:number;field:'adminComment'|'rejectionReason';until:number}>();

function parseFilterArgs(args:string):ListFilter{
 const filter:ListFilter={};
 for(const word of args.toLowerCase().split(/\s+/).filter(Boolean)){
  if(['pending','approved','rejected','unverified','duplicate'].includes(word))filter.status=word as ListFilter['status'];
  else if((BETA_PLATFORMS as readonly string[]).includes(word))filter.platform=word as BetaPlatform;
 }
 return filter;
}

/* ── Entry points from telegramBot.ts ─────────────────────────────────────── */

/** Handles beta messages; returns false when the message belongs to the regular bot. */
export async function handleBetaMessage(message:Message):Promise<boolean>{
 if(message.chat.type!=='private'||!message.from)return false;
 const from=message.from,chat=String(from.id),text=(message.text||'').trim();
 const start=text.match(/^\/start(?:@\w+)?\s+beta_([A-Za-z0-9_-]{20,64})\s*$/i);
 if(start){await confirmTelegram(chat,from,start[1]);return true;}
 const command=text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
 const name=command?.[1]?.toLowerCase(),args=(command?.[2]||'').trim();
 if(!isBetaAdmin(from.id)){
  if(name==='beta_status'){await applicantStatus(chat,`telegram:${from.id}`);return true;}
  return false;
 }
 const note=awaitingNote.get(chat);
 if(note&&!command){
  awaitingNote.delete(chat);
  if(note.until<Date.now()){await sendText(chat,new Msg().t('Время ввода истекло. Нажми кнопку под заявкой ещё раз.'));return true;}
  const row=await setApplicationNote(note.id,note.field,text==='-'?'':text,`telegram:${from.id}`);
  if(!row){await sendText(chat,new Msg().t('Заявка не найдена.'));return true;}
  await sendText(chat,new Msg().t(note.field==='adminComment'?'🗒 Комментарий сохранён. Пользователю он не отправляется.':'📝 Причина сохранена. Заявитель увидит её на странице статуса; в Telegram она автоматически не отправляется.'));
  void syncAdminMessages(row.id);
  return true;
 }
 switch(name){
  case 'admin':await show(chat,await adminMenu());return true;
  case 'stats':await show(chat,await statsScreen());return true;
  case 'applications':{const f=parseFilterArgs(args);await show(chat,await listScreen({status:f.status||'pending',platform:f.platform},0));return true;}
  case 'find':{
   const q=args.replace(/^@/,'').toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,32);
   if(q.length<2){await sendText(chat,new Msg().t('Напиши часть username: ').code('/find durov'));return true;}
   await show(chat,await listScreen({username:q},0));return true;
  }
  case 'app':{
   const id=Number(args.replace(/^#?0*/,''));
   const row=Number.isSafeInteger(id)&&id>0?await prisma.betaApplication.findUnique({where:{id}}):null;
   if(!row){await sendText(chat,new Msg().t('Заявка не найдена. Пример: ').code('/app 125'));return true;}
   const card=applicationCard(row);await sendText(chat,card.msg,card.markup);return true;
  }
  case 'open_beta':case 'close_beta':{
   const open=name==='open_beta',changed=await setBetaOpen(open,`telegram:${from.id}`);
   await sendText(chat,new Msg().t(open?'🔓 ':'🔒 ').b(open?'Набор открыт.':'Набор закрыт.').n().t(changed?(open?'Форма на сайте снова принимает заявки.':'Сайт показывает, что приём временно закрыт; сервер отклоняет новые заявки. Отправленные заявки сохранены.'):'Состояние уже было таким.'));
   return true;
  }
  case 'beta_status':{const [open,s]=await Promise.all([isBetaOpen(),betaStats()]);await sendText(chat,new Msg().t('🚪 Набор: ').b(open?'ОТКРЫТ':'ЗАКРЫТ').n().t(`⏳ Ожидают решения: ${s.pending}`));return true;}
  case 'export':await sendExport(chat);return true;
  case 'cancel':if(awaitingNote.delete(chat)){await sendText(chat,new Msg().t('Ввод отменён.'));return true;}return false;
 }
 return false;
}

async function confirmTelegram(chat:string,from:From,verifyToken:string){
 const result=await verifyApplication(verifyToken,{id:from.id,username:from.username});
 const statusButton={inline_keyboard:[[{text:'Статус заявки',url:`${site()}/beta/status`}]]};
 if(result.kind==='verified'){
  await sendText(chat,new Msg().t('✅ ').b('Telegram подтверждён').n(2).t(`Заявка ${displayNumber(result.application.id)} отправлена на рассмотрение. О решении мы напишем сюда, в этот чат.`).n(2).i('Не удаляй чат с ботом и не блокируй его — иначе уведомление не дойдёт.'),statusButton);
  void deliverAdminNotifications();
 }else if(result.kind==='duplicate'){
  await sendText(chat,new Msg().t('ℹ️ ').b('У тебя уже есть заявка').n(2).t(`${displayNumber(result.existing.id)} — ${STATUS_LABELS[result.existing.status as BetaStatus]||result.existing.status}. Новая не нужна: мы рассматриваем одну заявку на аккаунт.`),statusButton);
 }else if(result.kind==='expired'){
  await sendText(chat,new Msg().t('⌛️ ').b('Ссылка устарела').n(2).t('Открой страницу статуса заявки на сайте и нажми «Получить новую ссылку».'),statusButton);
 }else{
  await sendText(chat,new Msg().t('Эта ссылка недействительна или уже использована. Если заявка уже подтверждена, её статус есть на сайте.'),statusButton);
 }
}

async function applicantStatus(chat:string,telegramUserId:string){
 const apps=await applicationsForTelegramUser(telegramUserId);
 const active=apps.find(a=>a.status!=='duplicate');
 if(!active){await sendText(chat,new Msg().t('Заявок, подтверждённых этим аккаунтом, пока нет.').n().t('Подать заявку: ').link('oskolok.lol/beta',`${site()}/beta`));return;}
 const m=new Msg().t(`Заявка ${displayNumber(active.id)}: `).b(STATUS_LABELS[active.status as BetaStatus]||active.status);
 if(active.status==='rejected'&&active.rejectionReason)m.n().t('Причина: ').i(active.rejectionReason);
 await sendText(chat,m,{inline_keyboard:[[{text:'Открыть на сайте',url:`${site()}/beta/status`}]]});
}

/** Handles `ba:*` buttons. Only admins; a stale button never re-applies a decision. */
export async function handleBetaCallback(q:Callback):Promise<void>{
 const chat=String(q.from.id),data=q.data||'';
 if(!isBetaAdmin(q.from.id)){
  logger.warn({event:'beta.admin_denied',from:q.from.id},'Beta admin button pressed by a non-admin');
  await answerCallback(q.id,'Это действие доступно только администраторам.',true);return;
 }
 const editId=q.message&&String(q.message.chat.id)===chat?q.message.message_id:undefined;
 const [,action='',arg='',arg2='',arg3='']=data.split(':');
 const id=Number(arg);
 try{
  if(action==='ok'||action==='no'){
   const r=await decideApplication(id,action==='ok'?'approved':'rejected',`telegram:${q.from.id}`);
   if(r.changed){
    await answerCallback(q.id,action==='ok'?'✅ Заявка одобрена':'❌ Заявка отклонена');
    void syncAdminMessages(id,editId?{chat,id:editId}:undefined);
    void deliverUserNotifications(id);
   }else{
    const text=r.reason==='not_found'?'Заявка не найдена.':r.reason==='not_verified'?'Пользователь ещё не подтвердил Telegram — принять нельзя.':`Уже решено: ${STATUS_LABELS[r.application!.status as BetaStatus]||r.application!.status}.`;
    await answerCallback(q.id,text,true);
    if(r.application)void syncAdminMessages(id,editId?{chat,id:editId}:undefined);
   }
   return;
  }
  if(action==='cm'||action==='rs'){
   if(!await prisma.betaApplication.findUnique({where:{id},select:{id:true}})){await answerCallback(q.id,'Заявка не найдена.',true);return;}
   awaitingNote.set(chat,{id,field:action==='cm'?'adminComment':'rejectionReason',until:Date.now()+600000});
   await answerCallback(q.id);
   await sendText(chat,new Msg().t(action==='cm'?`🗒 Напиши внутренний комментарий к ${displayNumber(id)} одним сообщением. Пользователь его не увидит.`:`📝 Напиши причину отказа для ${displayNumber(id)}. Заявитель увидит её на странице статуса.`).n().t('Сообщение «-» очищает поле. /cancel — отмена.'));
   return;
  }
  await answerCallback(q.id);
  if(action==='info'){const screen=await detailsScreen(id);if(screen)await sendText(chat,screen.msg,screen.markup);return;}
  if(action==='v'){const row=await prisma.betaApplication.findUnique({where:{id}});if(row){const c=applicationCard(row);await sendText(chat,c.msg,c.markup);}return;}
  if(action==='adm'){await show(chat,await adminMenu(),editId);return;}
  if(action==='st'){await show(chat,await statsScreen(),editId);return;}
  if(action==='set'){await show(chat,await settingsScreen(),editId);return;}
  if(action==='exp'){await sendExport(chat);return;}
  if(action==='open'||action==='close'){await setBetaOpen(action==='open',`telegram:${q.from.id}`);await show(chat,await adminMenu(),editId);await sendText(chat,new Msg().t(action==='open'?'🔓 Набор открыт: форма на сайте принимает заявки.':'🔒 Набор закрыт: сайт показывает это, сервер не принимает новые заявки.'));return;}
  if(action==='l'){
   const status=(['pending','approved','rejected','unverified','duplicate'].includes(arg)?arg:'pending') as ListFilter['status'];
   const platform=(BETA_PLATFORMS as readonly string[]).includes(arg3)?arg3 as BetaPlatform:undefined;
   await show(chat,await listScreen({status,platform},Math.max(0,Number(arg2)||0)),editId);return;
  }
 }catch(error){
  logger.warn({event:'beta.callback_failed',action,reason:reason(error)},'Beta admin action failed');
  await answerCallback(q.id,'Не получилось. Попробуй ещё раз.',true);
 }
}

/** Separate command menu for admins; regular listeners keep the public list. */
export async function registerAdminCommands(publicCommands:Array<{command:string;description:string}>){
 const commands=[...publicCommands,
  {command:'admin',description:'Админ-меню бета-набора'},{command:'applications',description:'Заявки'},{command:'stats',description:'Статистика'},
  {command:'open_beta',description:'Открыть набор'},{command:'close_beta',description:'Закрыть набор'},{command:'beta_status',description:'Состояние набора'},
  {command:'find',description:'Найти заявку по username'},{command:'export',description:'Экспорт заявок CSV'},
 ];
 for(const chat of betaAdminIds())await api('setMyCommands',{commands,scope:{type:'chat',chat_id:Number(chat)}}).catch(error=>logger.warn({reason:reason(error)},'Admin commands setup failed'));
}
