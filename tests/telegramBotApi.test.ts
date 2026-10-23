import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

vi.mock('../server/src/config/env.js',()=>({env:{TELEGRAM_BOT_TOKEN:'test-only'}}));
vi.mock('../server/src/utils/logger.js',()=>({logger:{warn:vi.fn()}}));
let directory:string;
const calls:Array<{method:string;body:any}>=[];
const replies:Array<Error|{code:number;description:string}>=[];
const success={message_id:7,photo:[{file_id:'cached-picture'}]};

beforeEach(()=>{
  vi.resetModules();calls.length=0;replies.length=0;
  directory=mkdtempSync(path.join(tmpdir(),'oskolok-banner-api-'));
  vi.stubEnv('OSKOLOK_PRIVATE_DIR',directory);vi.stubEnv('TELEGRAM_BOT_CUSTOM_EMOJI','1');
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:{body:string|FormData})=>{
    const body=options.body instanceof FormData?Object.fromEntries([...options.body.entries()].map(([k,v])=>[k,typeof v==='string'&&/^[[{]/.test(v)?JSON.parse(v):v])):JSON.parse(options.body);
    calls.push({method:url.split('/').at(-1)!,body});
    const reply=replies.shift();
    if(reply instanceof Error)throw reply;
    if(reply)return {ok:false,status:reply.code,json:async()=>({ok:false,error_code:reply.code,description:reply.description})};
    return {ok:true,json:async()=>({ok:true,result:success})};
  }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});

describe('bot banner delivery',()=>{
  it('uploads a new picture into the existing message with caption and buttons',async()=>{
    const {editBanner,Msg}=await import('../server/src/services/telegramBotApi.js');
    const markup={inline_keyboard:[[{text:'Назад',callback_data:'cabinet:home'}]]};
    await editBanner('99',7,'downloads',new Msg().b('Приложения'),markup);
    expect(calls).toHaveLength(1);expect(calls[0].method).toBe('editMessageMedia');
    expect(calls[0].body).toMatchObject({chat_id:'99',message_id:'7',media:{type:'photo',media:'attach://photo',caption:'Приложения'},reply_markup:markup});
    expect(calls[0].body.photo.name).toBe('downloads.png');
  });
  it('reuses the cached file ID for navigation',async()=>{
    const {sendBanner,editBanner,Msg}=await import('../server/src/services/telegramBotApi.js');
    await sendBanner('99','profile',new Msg().t('Профиль'));
    await editBanner('99',7,'profile',new Msg().t('Профиль'));
    expect(calls[1].body.media.media).toBe('cached-picture');
    expect(calls[1].body.photo).toBeUndefined();
  });
  it('treats repeated clicks on the same card as successful',async()=>{
    const {editBanner,Msg}=await import('../server/src/services/telegramBotApi.js');
    replies.push({code:400,description:'Bad Request: message is not modified'});
    await expect(editBanner('99',7,'info',new Msg().t('О проекте'))).resolves.toEqual({message_id:7});
    expect(calls).toHaveLength(1);
  });
  it('uploads again if Telegram rejects an old cached picture',async()=>{
    const {sendBanner,editBanner,Msg}=await import('../server/src/services/telegramBotApi.js');
    await sendBanner('99','profile',new Msg().t('Профиль'));
    replies.push({code:400,description:'Bad Request: wrong file identifier/HTTP URL specified'});
    await editBanner('99',7,'profile',new Msg().t('Профиль'));
    expect(calls.map(c=>c.method)).toEqual(['sendPhoto','editMessageMedia','editMessageMedia']);
    expect(calls[2].body.media.media).toBe('attach://photo');
  });
  it.each([new Error('fetch failed'),{code:500,description:'Internal Server Error'}])('does not create a second message after an ambiguous send failure',async failure=>{
    const {sendBanner,Msg}=await import('../server/src/services/telegramBotApi.js');
    replies.push(failure);
    await expect(sendBanner('99','welcome',new Msg().t('Привет'))).rejects.toThrow();
    expect(calls.map(c=>c.method)).toEqual(['sendPhoto']);
  });
  it('falls back to text when Telegram explicitly rejects the photo',async()=>{
    const {sendBanner,Msg}=await import('../server/src/services/telegramBotApi.js');
    replies.push({code:400,description:'Bad Request: PHOTO_INVALID_DIMENSIONS'});
    await sendBanner('99','welcome',new Msg().t('Привет'));
    expect(calls.map(c=>c.method)).toEqual(['sendPhoto','sendMessage']);
  });
  it('removes unsupported custom emoji from both the edited media and its buttons',async()=>{
    const {editBanner,Msg}=await import('../server/src/services/telegramBotApi.js');
    replies.push({code:400,description:'Bad Request: custom emoji is not allowed'});
    await editBanner('99',7,'info',new Msg().e('info').t(' О проекте'),{inline_keyboard:[[{text:'Назад',callback_data:'cabinet:home',icon_custom_emoji_id:'123'}]]});
    expect(calls.map(c=>c.method)).toEqual(['editMessageMedia','editMessageMedia']);
    expect(calls[1].body.media.caption_entities).toEqual([]);
    expect(calls[1].body.reply_markup.inline_keyboard[0][0].icon_custom_emoji_id).toBeUndefined();
  });
  it('also removes unsupported button emoji when editing a text fallback',async()=>{
    const {editText,Msg}=await import('../server/src/services/telegramBotApi.js');
    replies.push({code:400,description:'Bad Request: icon_custom_emoji_id is not allowed'});
    await editText('99',7,new Msg().t('Профиль'),{inline_keyboard:[[{text:'Назад',callback_data:'cabinet:home',icon_custom_emoji_id:'123'}]]});
    expect(calls.map(c=>c.method)).toEqual(['editMessageText','editMessageText']);
    expect(calls[1].body.reply_markup.inline_keyboard[0][0].icon_custom_emoji_id).toBeUndefined();
  });
});
