import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
  attach:vi.fn(),active:vi.fn(),startPhone:vi.fn(),submitCode:vi.fn(),submitPassword:vi.fn(),cancel:vi.fn(),
}));
vi.mock('../server/src/config/env.js',()=>({env:{TELEGRAM_BOT_TOKEN:'test-token'}}));
vi.mock('../server/src/database/client.js',()=>({prisma:{telegramConnection:{findUnique:vi.fn()}}}));
vi.mock('../server/src/services/telegramSession.js',()=>({
  attachBotLogin:mocks.attach,botLoginForUser:mocks.active,startBotPhoneLogin:mocks.startPhone,
  submitPhoneCode:mocks.submitCode,submitLoginPassword:mocks.submitPassword,cancelLogin:mocks.cancel,
  loginStatus:vi.fn(),setBotLoginNotifier:vi.fn(),
}));

const calls:Array<{method:string;body:any}>=[];
beforeEach(()=>{
  calls.length=0;
  for(const mock of Object.values(mocks))mock.mockReset();
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:{body:string})=>{
    const method=url.split('/').at(-1)||'';
    const body=JSON.parse(options.body);
    calls.push({method,body});
    return {ok:true,json:async()=>({ok:true,result:method==='getChatMenuButton'?{type:'web_app',web_app:{url:'https://oskolok.example'}}:true})};
  }));
});

describe('bot-assisted Telegram login',()=>{
  it('welcomes users with a Mini App button',async()=>{
    const {handleBotMessage}=await import('../server/src/services/telegramBot.js');
    await handleBotMessage({message_id:1,chat:{id:99,type:'private'},from:{id:99},text:'/start'});
    expect(calls.find(x=>x.method==='sendMessage')?.body.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://oskolok.example');
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
    expect(mocks.submitCode).toHaveBeenCalledWith('attempt','12345');
    expect(calls.find(x=>x.method==='deleteMessage')?.body.message_id).toBe(4);
  });
});
