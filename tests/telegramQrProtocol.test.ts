import {describe,it,expect,vi} from 'vitest';
import {Api} from 'teleproto';
import {SessionPasswordNeededError} from 'teleproto/errors/RPCErrorList.js';
vi.mock('teleproto/Password.js',()=>({computeCheck:vi.fn(async()=>new Api.InputCheckPasswordEmpty())}));
import {signInWithQr} from '../server/src/services/telegramQr.js';
const credentials={apiId:123,apiHash:'test'};
const authorized=()=>new Api.auth.LoginTokenSuccess({authorization:new Api.auth.Authorization({user:new Api.User({id:123 as any,firstName:'Tester'})})});
function fake(results:any[]){let handler:(u:any)=>void=()=>{};const c={addEventHandler:vi.fn((fn)=>handler=fn),removeEventHandler:vi.fn(),invoke:vi.fn(async(_request:unknown)=>{const result=results.shift();if(result instanceof Error)throw result;return result;}),_switchDC:vi.fn(async()=>{}),signInWithPassword:vi.fn(async()=>new Api.User({id:123 as any})),update:()=>handler(new Api.UpdateLoginToken())};return c;}
const options=(controller=new AbortController())=>({signal:controller.signal,qrCode:vi.fn(async()=>{}),password:vi.fn(async()=>''),onError:vi.fn(async()=>false)});
describe('QR protocol handshake',()=>{
 it('handles immediate success instead of waiting forever for another update',async()=>{const c=fake([authorized()]);const user=await signInWithQr(c as any,credentials,options());expect(user.id).toBe(123);expect(c.removeEventHandler).toHaveBeenCalled();});
 it('imports the token in the requested data center',async()=>{const token=Buffer.from('test'),c=fake([new Api.auth.LoginTokenMigrateTo({dcId:4,token}),authorized()]);await signInWithQr(c as any,credentials,options());expect(c._switchDC).toHaveBeenCalledWith(4);expect(c.invoke.mock.calls[1][0]).toBeInstanceOf(Api.auth.ImportLoginToken);});
 it('does not lose an update received while displaying the QR',async()=>{const c=fake([new Api.auth.LoginToken({token:Buffer.from('x'),expires:Math.floor(Date.now()/1000)+30}),authorized()]),o=options();o.qrCode.mockImplementation(async()=>c.update());await signInWithQr(c as any,credentials,o);expect(c.invoke).toHaveBeenCalledTimes(2);});
 it('cancels a waiting QR and removes its handler',async()=>{const controller=new AbortController(),c=fake([new Api.auth.LoginToken({token:Buffer.from('x'),expires:Math.floor(Date.now()/1000)+30})]),o=options(controller);o.qrCode.mockImplementation(async()=>controller.abort());await expect(signInWithQr(c as any,credentials,o)).rejects.toThrow('AUTH_USER_CANCEL');expect(c.removeEventHandler).toHaveBeenCalled();});
 it('recognizes the actual Telegram 2FA RPC error and confirms the password',async()=>{
  const rpc=new SessionPasswordNeededError({request:new Api.auth.ExportLoginToken({...credentials,exceptIds:[]})});
  expect(rpc.message).not.toContain('SESSION_PASSWORD_NEEDED');
  const pwd=new Api.account.Password({currentAlgo:new Api.PasswordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow({salt1:Buffer.alloc(1),salt2:Buffer.alloc(1),g:3,p:Buffer.alloc(1)}),hint:'hint'} as any);
  const c=fake([rpc,pwd,new Api.auth.Authorization({user:new Api.User({id:123 as any})})]),o=options();
  o.password.mockResolvedValue('test-password');
  const user=await signInWithQr(c as any,credentials,o);
  expect(user.id).toBe(123);expect(o.password).toHaveBeenCalledWith('hint');
  expect(c.invoke.mock.calls[2][0]).toBeInstanceOf(Api.auth.CheckPassword);
 });
});
