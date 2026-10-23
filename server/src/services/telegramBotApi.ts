import {existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {openAsBlob} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {env} from '../config/env.js';
import {logger} from '../utils/logger.js';
import {retry} from './telegramReliability.js';

/** Ошибка Bot API с кодом и retry_after (429) — retry() из telegramReliability понимает retryAfter. */
export class BotApiError extends Error{
  constructor(public method:string,public code:number,public description:string,public retryAfter?:number){super(`${method}: ${description}`);this.name='BotApiError';}
}
type Result<T>={ok:boolean;result:T;description?:string;error_code?:number;parameters?:{retry_after?:number}};
async function raw<T>(method:string,body:Record<string,unknown>|FormData,timeout:number):Promise<T>{
  const form=body instanceof FormData;
  const response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',...(form?{}:{headers:{'Content-Type':'application/json'}}),body:form?body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  const result=await response.json() as Result<T>;
  if(!response.ok||!result.ok)throw new BotApiError(method,result.error_code||response.status,result.description||`Telegram ${method} failed`,result.parameters?.retry_after);
  return result.result;
}
/** Вызов Bot API: 429 → ждём ровно retry_after (до 30 с) и повторяем; сетевые сбои повторяются только для идемпотентных методов. */
export async function api<T>(method:string,body:Record<string,unknown>|FormData={},timeout=10000):Promise<T>{
  const idempotent=/^(get|answer|edit|delete|set|sendChatAction)/.test(method);
  return retry(()=>raw<T>(method,body,timeout),{attempts:idempotent?3:2,maxFloodWait:30,shouldRetry:(e,kind)=>kind==='flood'?((e as BotApiError).retryAfter||0)<=30:idempotent&&kind==='network',onRetry:({attempt,delay,kind})=>logger.warn({method,attempt,delay,kind,event:'telegram.bot.retry'},'Telegram Bot API retry')});
}
export const isNotModified=(e:unknown)=>e instanceof BotApiError&&/message is not modified/i.test(e.description);

/** Премиум-эмодзи (custom_emoji_id из каталога Zulut30/premium-telegram-emoji, набор «Minimalist B&W Icons»).
 * Кастомные доступны в личных сообщениях бота с Premium у владельца либо username на Fragment. Есть обычный фолбэк. */
export const EMOJI={
  music:['5891249688933305846','🎵'],headphones:['6007938409857815902','🎧'],wave:['5870734657384877785','👋'],heart:['5994453058656931434','❤️'],
  search:['5874960879434338403','🔍'],list:['5877597667231534929','📋'],check:['5825794181183836432','✅'],bell:['5909201569898827582','🔔'],
  warn:['5879813604068298387','❗'],info:['5879785854284599288','ℹ️'],refresh:['5877410604225924969','🔄'],profile:['5879770735999717115','👤'],
  plane:['5875465628285931233','✈️'],star:['5958376256788502078','⭐'],speaker:['5890997763331591703','🔊'],chat:['5884510167986343350','💬'],
} as const satisfies Record<string,readonly [string,string]>;
export type EmojiKey=keyof typeof EMOJI;
type Entity={type:string;offset:number;length:number;custom_emoji_id?:string;url?:string};
/** Сборщик текста с entities (offset/length в UTF-16) — без parse_mode и экранирования. */
export class Msg{
  text='';entities:Entity[]=[];
  private add(type:string,s:string,extra:Partial<Entity>={}){const offset=this.text.length;this.text+=s;if(s.length)this.entities.push({type,offset,length:s.length,...extra});return this;}
  t(s:string){this.text+=s;return this;}
  e(key:EmojiKey){const [id,fallback]=EMOJI[key];return this.add('custom_emoji',fallback,{custom_emoji_id:id});}
  b(s:string){return this.add('bold',s);}
  i(s:string){return this.add('italic',s);}
  code(s:string){return this.add('code',s);}
  link(s:string,url:string){return this.add('text_link',s,{url});}
  quote(s:string){return this.add('expandable_blockquote',s);}
  n(count=1){this.text+='\n'.repeat(count);return this;}
}
const customEmojiOff=()=>process.env.TELEGRAM_BOT_CUSTOM_EMOJI==='0';
let customEmojiRejected=false;
const strip=(entities:Entity[])=>entities.filter(e=>e.type!=='custom_emoji');
const usable=(m:Msg)=>customEmojiOff()||customEmojiRejected?strip(m.entities):m.entities;
function usableMarkup(markup:Markup):Markup {
  if(!markup||!Array.isArray(markup.inline_keyboard)||!customEmojiOff()&&!customEmojiRejected)return markup;
  return {...markup,inline_keyboard:markup.inline_keyboard.map((row:any[])=>row.map(({icon_custom_emoji_id,...button})=>button))};
}
/** Если Telegram отверг кастомные эмодзи (нет прав у бота) — отправляем тот же текст с обычными фолбэками и больше их не пробуем. */
async function withEmojiFallback<T>(m:Msg,send:(entities:Entity[])=>Promise<T>,markup?:Markup):Promise<T>{
  const entities=usable(m);
  try{return await send(entities);}
  catch(error){
    const buttonEmoji=Array.isArray(markup?.inline_keyboard)&&markup.inline_keyboard.some((row:any[])=>row.some(button=>button.icon_custom_emoji_id));
    if(!(error instanceof BotApiError)||error.code!==400||!entities.some(e=>e.type==='custom_emoji')&&!buttonEmoji||isNotModified(error)||!/emoji|entit|premium|icon/i.test(error.description))throw error;
    customEmojiRejected=true;logger.warn({reason:error.description,event:'telegram.bot.custom_emoji_disabled'},'Custom emoji rejected; using fallback emoji');
    return send(strip(m.entities));
  }
}
export type Markup=Record<string,unknown>|undefined;
export const sendText=(chat:string|number,m:Msg,reply_markup?:Markup)=>withEmojiFallback(m,entities=>api<{message_id:number}>('sendMessage',{chat_id:chat,text:m.text,entities,reply_markup:usableMarkup(reply_markup),link_preview_options:{is_disabled:true}}),reply_markup);
export async function editText(chat:string|number,messageId:number,m:Msg,reply_markup?:Markup){
  try{return await withEmojiFallback(m,entities=>api('editMessageText',{chat_id:chat,message_id:messageId,text:m.text,entities,reply_markup:usableMarkup(reply_markup),link_preview_options:{is_disabled:true}}),reply_markup);}
  catch(error){if(isNotModified(error))return;throw error;}
}
export async function editCaption(chat:string|number,messageId:number,m:Msg,reply_markup?:Markup){
  try{return await withEmojiFallback(m,caption_entities=>api('editMessageCaption',{chat_id:chat,message_id:messageId,caption:m.text,caption_entities,reply_markup:usableMarkup(reply_markup)}),reply_markup);}
  catch(error){if(isNotModified(error))return;throw error;}
}
/** Фото по URL (обложка трека); если Telegram не смог его скачать — баннер «now». */
export async function sendPhotoUrl(chat:string|number,url:string|undefined,m:Msg,reply_markup?:Markup){
  if(url?.startsWith('https://'))try{return await withEmojiFallback(m,caption_entities=>api<{message_id:number}>('sendPhoto',{chat_id:chat,photo:url,caption:m.text,caption_entities,reply_markup}));}catch(error){if(!(error instanceof BotApiError)||error.code!==400)throw error;}
  return sendBanner(chat,'now',m,reply_markup);
}
export const chatAction=(chat:string|number,action:'typing'|'upload_audio'|'upload_photo')=>api('sendChatAction',{chat_id:chat,action}).catch(()=>{});
export const answerCallback=(id:string,text?:string,alert=false)=>api('answerCallbackQuery',{callback_query_id:id,text:text?.slice(0,190),show_alert:alert}).catch(()=>{});

/** Баннеры бота: PNG из server/assets/bot, после первой загрузки — file_id из кэша (повторно не грузим). */
export type BannerKind='welcome'|'profile'|'downloads'|'info'|'beta-pending'|'beta-approved'|'now'|'error';
const privateDir=path.resolve(process.env.OSKOLOK_PRIVATE_DIR||'server/data/private');
const bannerCacheFile=path.join(privateDir,'bot-banners.json');
const here=path.dirname(fileURLToPath(import.meta.url));
export function bannerPath(kind:BannerKind){
  const dirs=[process.env.OSKOLOK_BOT_ASSETS,path.resolve(here,'../../assets/bot'),path.resolve(here,'../server/assets/bot'),path.resolve('server/assets/bot')].filter(Boolean) as string[];
  return dirs.map(d=>path.join(d,`${kind}.png`)).find(existsSync);
}
function bannerCache():Record<string,string>{try{return JSON.parse(readFileSync(bannerCacheFile,'utf8'));}catch{return {};}}
function saveBanner(kind:string,fileId?:string){try{const c=bannerCache();if(!fileId&&!(kind in c))return;mkdirSync(privateDir,{recursive:true,mode:0o700});if(fileId)c[kind]=fileId;else delete c[kind];writeFileSync(bannerCacheFile,JSON.stringify(c),{mode:0o600});}catch{}}
type PhotoResult={message_id:number;photo?:Array<{file_id:string}>};
export const sendBanner=(chat:string|number,kind:BannerKind,m:Msg,reply_markup?:Markup)=>deliverBanner(chat,kind,m,reply_markup);
export const editBanner=(chat:string|number,messageId:number,kind:BannerKind,m:Msg,reply_markup?:Markup)=>deliverBanner(chat,kind,m,reply_markup,messageId);
async function deliverBanner(chat:string|number,kind:BannerKind,m:Msg,reply_markup?:Markup,messageId?:number):Promise<{message_id:number}>{
  const file=bannerPath(kind);
  const editing=messageId!==undefined;
  const textFallback=async()=>{
    if(!editing)return sendText(chat,m,reply_markup);
    await editCaption(chat,messageId,m,reply_markup);return {message_id:messageId};
  };
  if(!file)return textFallback();
  // The cached file_id is tied to the picture's size and date: a redrawn banner is uploaded again.
  const {size,mtimeMs}=statSync(file);const cacheKey=`${kind}:${size}:${Math.round(mtimeMs)}`;
  const cached=bannerCache()[cacheKey];
  const method=editing?'editMessageMedia':'sendPhoto';
  const media=(caption_entities:Entity[],photo:string)=>({type:'photo',media:photo,caption:m.text,caption_entities});
  const byId=(caption_entities:Entity[])=>api<PhotoResult>(method,editing?
    {chat_id:chat,message_id:messageId,media:media(caption_entities,cached),reply_markup:usableMarkup(reply_markup)}:
    {chat_id:chat,photo:cached,caption:m.text,caption_entities,reply_markup:usableMarkup(reply_markup)});
  const upload=async(caption_entities:Entity[])=>{
    const form=new FormData();
    form.set('chat_id',String(chat));
    if(editing){form.set('message_id',String(messageId));form.set('media',JSON.stringify(media(caption_entities,'attach://photo')));}
    else {form.set('caption',m.text);form.set('caption_entities',JSON.stringify(caption_entities));}
    if(reply_markup)form.set('reply_markup',JSON.stringify(usableMarkup(reply_markup)));
    form.set('photo',await openAsBlob(file,{type:'image/png'}),`${kind}.png`);
    const sent=await api<PhotoResult>(method,form,30000);
    saveBanner(cacheKey,sent.photo?.at(-1)?.file_id);return sent;
  };
  try{
    if(cached){try{return await withEmojiFallback(m,byId,reply_markup);}catch(error){if(!(error instanceof BotApiError)||error.code!==400||isNotModified(error)||!/file|photo|media|image/i.test(error.description)||/entit|emoji/i.test(error.description))throw error;saveBanner(cacheKey);}}
    return await withEmojiFallback(m,upload,reply_markup);
  }catch(error){
    if(editing&&isNotModified(error))return {message_id:messageId};
    // A timeout or 5xx may follow successful delivery. Sending another message would duplicate it.
    if(!(error instanceof BotApiError)||error.code!==400)throw error;
    logger.warn({kind,reason:error instanceof Error?error.message:String(error),event:'telegram.bot.banner_failed'},'Banner send failed; falling back to text');
    return textFallback();
  }
}
