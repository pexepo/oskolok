import {describe,it,expect,vi} from 'vitest';
vi.mock('../server/src/config/env.js',()=>({env:{TELEGRAM_BOT_TOKEN:'test'}}));
vi.mock('../server/src/database/client.js',()=>({prisma:{}}));
vi.mock('../server/src/services/telegramBeta.js',()=>({checkBetaAccess:vi.fn(),BETA_DENIED_MESSAGE:'Denied'}));
import {userIdentity} from '../server/src/middleware/userIdentity.js';
describe('anonymous public profile access',()=>{
 it.each(['/users/telegram:7','/users/telegram:7/summary','/users/telegram:7/lyrics'])('allows public GET %s',async path=>{
   const next=vi.fn(),status=vi.fn().mockReturnThis();
   await userIdentity({path,method:'GET',headers:{},get:()=>undefined} as any,{locals:{},status,json:vi.fn()} as any,next);
   expect(next).toHaveBeenCalledOnce();expect(status).not.toHaveBeenCalled();
 });
 it.each([['GET','/profile'],['POST','/users/telegram:7'],['GET','/users/telegram:7/private']])('retains authentication for %s %s',async(method,path)=>{
   const next=vi.fn(),status=vi.fn().mockReturnThis();
   await userIdentity({path,method,headers:{},get:()=>undefined} as any,{locals:{},status,json:vi.fn()} as any,next);
   expect(status).toHaveBeenCalledWith(401);expect(next).not.toHaveBeenCalled();
 });
});
