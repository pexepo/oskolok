import {beforeEach,describe,expect,it,vi} from 'vitest';

const calls=vi.hoisted(()=>({send:vi.fn(),edit:vi.fn(),text:vi.fn(),answer:vi.fn()}));
vi.mock('../server/src/services/telegramBotApi.js',async importOriginal=>({
  ...await importOriginal<typeof import('../server/src/services/telegramBotApi.js')>(),
  sendBanner:calls.send,editBanner:calls.edit,editText:calls.text,answerCallback:calls.answer,
}));
import {cabinetCallback,sendCabinet} from '../server/src/services/telegramCabinet.js';

beforeEach(()=>vi.clearAllMocks());
describe('cabinet cards',()=>{
  it.each([['home','welcome'],['profile','profile'],['downloads','downloads'],['info','info'],['beta','beta-pending']])('uses a dedicated banner for %s',async(section,kind)=>{
    await sendCabinet('99',false,'tester',section);
    expect(calls.send).toHaveBeenCalledWith('99',kind,expect.anything(),expect.anything());
  });
  it('updates the photo and caption in the existing card on navigation',async()=>{
    await cabinetCallback('cb','99','cabinet:downloads',false,'tester',{messageId:7,hasPhoto:true});
    expect(calls.answer).toHaveBeenCalledWith('cb');
    expect(calls.edit).toHaveBeenCalledWith('99',7,'downloads',expect.objectContaining({text:expect.stringContaining('Выберите свою платформу')}),expect.anything());
    expect(calls.send).not.toHaveBeenCalled();
  });
  it('keeps text fallback cards in the same message',async()=>{
    await cabinetCallback('cb','99','cabinet:profile',true,'tester',{messageId:8,hasPhoto:false});
    expect(calls.text).toHaveBeenCalledWith('99',8,expect.objectContaining({text:expect.stringContaining('@tester')}),expect.anything());
    expect(calls.send).not.toHaveBeenCalled();
  });
  it('includes a way back from every secondary card',async()=>{
    for(const section of ['profile','downloads','info']){
      await sendCabinet('99',true,'tester',section);
      const markup=calls.send.mock.calls.at(-1)![3];
      expect(markup.inline_keyboard.flat().some((b:any)=>b.callback_data==='cabinet:home')).toBe(true);
    }
  });
  it('ignores unknown callback sections',async()=>{
    await cabinetCallback('cb','99','cabinet:unknown',false);
    expect(calls.answer).toHaveBeenCalledWith('cb');
    expect(calls.send).not.toHaveBeenCalled();
  });
});
