import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
  attach:vi.fn(),active:vi.fn(),startPhone:vi.fn(),submitCode:vi.fn(),submitPassword:vi.fn(),cancel:vi.fn(),
  step:vi.fn(),toggle:vi.fn(),search:vi.fn(),play:vi.fn(),like:vi.fn(),
}));
const failNext=vi.hoisted(()=>({description:'' as string}));
vi.mock('../server/src/utils/logger.js',()=>({logger:{warn:vi.fn(),info:vi.fn()}}));
vi.mock('../server/src/services/telegramPlayback.js',()=>({
  stepPlayback:mocks.step,togglePlayback:mocks.toggle,searchTracks:mocks.search,playTracksInTelegram:mocks.play,likeCurrent:mocks.like,
  jumpPlayback:vi.fn(),currentTrack:vi.fn(),sendNowCard:vi.fn(),queueView:vi.fn(),editOrSend:vi.fn(),startTelegramPlayback:vi.fn(),compactTrack:(t:unknown)=>t,
}));
vi.mock('../server/src/services/telegramBeta.js',()=>({checkBetaAccess:vi.fn(async()=>true),BETA_DENIED_MESSAGE:'Проект находится в стадии бета-тестирования. У вас нету к нему доступа'}));
vi.mock('../server/src/services/telegramBetaNotifications.js',()=>({registerBetaBotContact:vi.fn(async()=>{})}));
vi.mock('../server/src/config/env.js',()=>({env:{TELEGRAM_BOT_TOKEN:'test-token'}}));
vi.mock('../server/src/database/client.js',()=>({prisma:{telegramConnection:{findUnique:vi.fn()},telegramAudioCache:{findMany:vi.fn(async()=>[])}}}));
vi.mock('../server/src/services/telegramSession.js',()=>({
  attachBotLogin:mocks.attach,botLoginForUser:mocks.active,startBotPhoneLogin:mocks.startPhone,
  submitPhoneCode:mocks.submitCode,submitLoginPassword:mocks.submitPassword,cancelLogin:mocks.cancel,
  loginStatus:vi.fn(),setBotLoginNotifier:vi.fn(),
}));

const calls:Array<{method:string;body:any}>=[];
import {checkBetaAccess} from '../server/src/services/telegramBeta.js';
beforeEach(()=>{
  calls.length=0;
  for(const mock of Object.values(mocks))mock.mockReset();
  failNext.description='';
  vi.mocked(checkBetaAccess).mockResolvedValue(true);
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:{body:string|FormData})=>{
    const method=url.split('/').at(-1)||'';
    const body=options.body instanceof FormData?Object.fromEntries([...options.body.entries()].map(([k,v])=>[k,typeof v==='string'&&/^[[{]/.test(v)?JSON.parse(v):v])):JSON.parse(options.body);
    calls.push({method,body});
    if(failNext.description&&/^send/.test(method)){const description=failNext.description;failNext.description='';return {ok:false,status:400,json:async()=>({ok:false,error_code:400,description})};}
    return {ok:true,json:async()=>({ok:true,result:method==='getChatMenuButton'?{type:'web_app',web_app:{url:'https://oskolok.example'}}:method==='getMe'?{supports_inline_queries:false}:{message_id:7}})};
  }));
});

describe('public bot cabinet',()=>{
 it('changes an existing cabinet card without sending another message',async()=>{
  const {handleCallback}=await import('../server/src/services/telegramBot.js');
  const callback={id:'edit-cabinet-card',from:{id:501},data:'cabinet:profile',message:{message_id:20,chat:{id:501,type:'private'},caption:'Осколок'}};
  await handleCallback(callback);await handleCallback(callback);
  expect(calls.some(x=>x.method==='editMessageMedia'&&String(x.body.message_id)==='20')).toBe(true);
  expect(calls.filter(x=>x.method==='editMessageMedia')).toHaveLength(1);
  expect(calls.some(x=>x.method==='sendPhoto'||x.method==='sendMessage')).toBe(false);
 });
 it('explains pending beta access instead of repeating the welcome card for a blocked command',async()=>{
  vi.mocked(checkBetaAccess).mockResolvedValue(false);
  const {handleBotMessage}=await import('../server/src/services/telegramBot.js');
  await handleBotMessage({message_id:902,chat:{id:501,type:'private'},from:{id:501},text:'/search Кино'});
  const sent=calls.find(x=>x.method==='sendPhoto')!;
  expect(sent.body.photo.name).toBe('beta-pending.png');
  expect(sent.body.caption).toContain('после одобрения');
  expect(mocks.search).not.toHaveBeenCalled();
 });
 it('keeps the cabinet, social links and beta application available without an invitation',async()=>{
  vi.mocked(checkBetaAccess).mockResolvedValue(false);
  const {handleBotMessage}=await import('../server/src/services/telegramBot.js');
  await handleBotMessage({message_id:901,chat:{id:501,type:'private'},from:{id:501,username:'qa_public'},text:'/start'});
  const sent=calls.find(x=>x.method==='sendPhoto'||x.method==='sendMessage')!;
  const buttons=sent.body.reply_markup.inline_keyboard.flat();
  expect(buttons.some((b:any)=>b.url==='https://oskolok.lol/beta')).toBe(true);
  expect(buttons.some((b:any)=>b.url==='https://t.me/oskolokch')).toBe(true);
  expect(buttons.some((b:any)=>b.web_app)).toBe(false);expect(mocks.play).not.toHaveBeenCalled();
 });
 it('opens profile/downloads without beta but still blocks playback commands',async()=>{
  vi.mocked(checkBetaAccess).mockResolvedValue(false);
  const {handleCallback}=await import('../server/src/services/telegramBot.js');
  await handleCallback({id:'public-downloads-901',from:{id:501},data:'cabinet:downloads'});
  const sent=calls.find(x=>x.method==='sendPhoto'||x.method==='sendMessage')!;
  expect(sent.body.reply_markup.inline_keyboard.flat().some((b:any)=>b.url==='https://oskolok.lol/downloads/Oskolok.apk')).toBe(true);
  await handleCallback({id:'blocked-playback-901',from:{id:501},data:'pb:next'});
  expect(mocks.step).not.toHaveBeenCalled();
  expect(calls.some(x=>x.method==='answerCallbackQuery'&&x.body.show_alert===true)).toBe(true);
 });
});

describe('bot-assisted Telegram login',()=>{
  it('welcomes users with a public cabinet and a website button',async()=>{
    const {handleBotMessage}=await import('../server/src/services/telegramBot.js');
    await handleBotMessage({message_id:1,chat:{id:99,type:'private'},from:{id:99},text:'/start'});
    const welcome=calls.find(x=>x.method==='sendPhoto'||x.method==='sendMessage')!;
    expect(welcome.method).toBe('sendPhoto');
    expect(welcome.body.reply_markup.inline_keyboard[0][1].url).toBe('https://oskolok.lol/');
    expect(welcome.body.caption).toContain('Осколок');
    // Премиум-эмодзи: offset/length в UTF-16 указывают ровно на символ-фолбэк.
    const emoji=welcome.body.caption_entities.filter((e:any)=>e.type==='custom_emoji');
    expect(emoji.length).toBeGreaterThan(0);
    for(const e of emoji)expect(['👋','🎧','🎵','🔍','✅','ℹ️']).toContain(welcome.body.caption.slice(e.offset,e.offset+e.length));
  });
  it('only accepts a matching deep link and then asks for the account phone',async()=>{
    mocks.attach.mockReturnValue(true);
    const {handleBotMessage}=await import('../server/src/services/telegramBot.js');
    await handleBotMessage({message_id:2,chat:{id:99,type:'private'},from:{id:99},text:'/start connect_testtoken'});
    expect(mocks.attach).toHaveBeenCalledWith('testtoken','99');
    expect(calls.find(x=>x.method==='sendMessage')?.body.reply_markup.keyboard[0][0].request_contact).toBe(true);
  });
  it('rejects another contact and removes a submitted code message',async()=>{
    const {handleBotMessage}=await import('../server/src/services/telegramBot.js');
    mocks.active.mockReturnValue({id:'attempt',login:{state:'bot_phone'}});
    await handleBotMessage({message_id:3,chat:{id:99,type:'private'},from:{id:99},contact:{phone_number:'+375291234567',user_id:42}});
    expect(mocks.startPhone).not.toHaveBeenCalled();
    mocks.active.mockReturnValue({id:'attempt',login:{state:'code'}});
    await handleBotMessage({message_id:4,chat:{id:99,type:'private'},from:{id:99},text:'12345'});
    expect(mocks.submitCode).not.toHaveBeenCalled();
    expect(calls.filter(x=>x.method==='sendMessage').at(-1)?.body.text).toContain('аннулирует');
    expect(calls.find(x=>x.method==='deleteMessage')?.body.message_id).toBe(4);
  });
});

describe('interactive bot',()=>{
  it('answers ⏭ with a toast naming the next track instead of a new message',async()=>{
    mocks.step.mockResolvedValue({moved:true,state:{queue:[{title:'Один'},{title:'Два'}],index:1}});
    const {handleCallback}=await import('../server/src/services/telegramBot.js');
    await handleCallback({id:'cb1',from:{id:99},data:'pb:next'});
    expect(mocks.step).toHaveBeenCalledWith('telegram:99',1);
    expect(calls.find(x=>x.method==='answerCallbackQuery')?.body.text).toBe('⏭ Два');
    expect(calls.some(x=>x.method==='sendMessage')).toBe(false);
  });
  it('tells the user at the end of the queue',async()=>{
    mocks.step.mockResolvedValue({moved:false,state:{queue:[{title:'Один'}],index:0}});
    const {handleCallback}=await import('../server/src/services/telegramBot.js');
    await handleCallback({id:'cb2',from:{id:99},data:'pb:next'});
    expect(calls.find(x=>x.method==='answerCallbackQuery')?.body.text).toMatch(/последний/);
  });
  it('searches by plain text and plays the picked result in Telegram',async()=>{
    mocks.active.mockReturnValue(undefined);
    mocks.search.mockResolvedValue([{id:'a',title:'Хочешь',artist:{name:'Земфира'}},{id:'b',title:'Ариведерчи',artist:{name:'Земфира'}}]);
    const {handleBotMessage,handleCallback}=await import('../server/src/services/telegramBot.js');
    await handleBotMessage({message_id:10,chat:{id:99,type:'private'},from:{id:99},text:'земфира'});
    expect(mocks.search).toHaveBeenCalledWith('земфира',8);
    expect(calls.some(x=>x.method==='sendChatAction'&&x.body.action==='typing')).toBe(true);
    const list=calls.filter(x=>x.method==='sendMessage').at(-1)!;
    const button=list.body.reply_markup.inline_keyboard[1][0];
    expect(button.text).toBe('Земфира — Ариведерчи');
    await handleCallback({id:'cb3',from:{id:99},data:button.callback_data});
    expect(mocks.play).toHaveBeenCalledWith('telegram:99',expect.any(Array),1);
  });
  it('falls back to regular emoji when Telegram rejects custom emoji',async()=>{
    mocks.active.mockReturnValue(undefined);
    mocks.like.mockResolvedValue({title:'Хочешь',artist:{name:'Земфира'}});
    failNext.description='Bad Request: ENTITY_TEXT_INVALID custom emoji';
    const {handleBotMessage}=await import('../server/src/services/telegramBot.js');
    await handleBotMessage({message_id:11,chat:{id:99,type:'private'},from:{id:99},text:'/like'});
    const sent=calls.filter(x=>x.method==='sendMessage');
    expect(sent).toHaveLength(2);
    expect(sent[0].body.entities.some((e:any)=>e.type==='custom_emoji')).toBe(true);
    expect(sent[1].body.entities.some((e:any)=>e.type==='custom_emoji')).toBe(false);
    expect(sent[1].body.text).toContain('❤️ Земфира — Хочешь');
  });
});
