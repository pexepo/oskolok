import {Api,TelegramClient} from 'teleproto';
import {computeCheck} from 'teleproto/Password.js';
import {Raw} from 'teleproto/events/Raw.js';

type QrOptions={signal:AbortSignal;qrCode:(value:{token:Buffer;expires:number})=>Promise<void>;password:(hint?:string)=>Promise<string>;onError:(error:Error)=>Promise<boolean>};

/** Register before exporting: accepting a QR may race its refresh or the first response. */
export async function signInWithQr(client:TelegramClient,credentials:{apiId:number;apiHash:string},options:QrOptions):Promise<Api.TypeUser>{
  let wake:(()=>void)|undefined;
  let updated=false;
  const handler=(update:Api.TypeUpdate)=>{if(update instanceof Api.UpdateLoginToken){updated=true;wake?.();}};
  const event=new Raw({});
  client.addEventHandler(handler,event);
  try{
    while(!options.signal.aborted){
      try{
        let result=await client.invoke(new Api.auth.ExportLoginToken({...credentials,exceptIds:[]}));
        if(result instanceof Api.auth.LoginTokenMigrateTo){
          await client._switchDC(result.dcId);
          result=await client.invoke(new Api.auth.ImportLoginToken({token:result.token}));
        }
        if(result instanceof Api.auth.LoginTokenSuccess){if(result.authorization instanceof Api.auth.Authorization)return result.authorization.user;throw new Error('QR_SIGNUP_REQUIRED');}
        if(!(result instanceof Api.auth.LoginToken))throw new Error('QR_LOGIN_UNEXPECTED');
        if(options.signal.aborted)break;
        await options.qrCode(result);
        if(updated){updated=false;continue;}
        await new Promise<void>(resolve=>{
          const done=()=>{clearTimeout(timer);options.signal.removeEventListener('abort',done);wake=undefined;resolve();};
          const timer=setTimeout(done,Math.max(500,result.expires*1000-Date.now()));
          wake=done;
          options.signal.addEventListener('abort',done,{once:true});
          if(options.signal.aborted||updated)done();
        });
        updated=false;
      }catch(error){
        if(options.signal.aborted)break;
        if(/SESSION_PASSWORD_NEEDED/.test(`${(error as {errorMessage?:string})?.errorMessage||''} ${String(error)}`))return confirmWithPassword(client,options);
        throw error;
      }
    }
    throw new Error('AUTH_USER_CANCEL');
  }finally{client.removeEventHandler(handler,event);wake?.();}
}

/** Two-step verification once Telegram accepts the QR. Handshakes explicitly instead of
 *  GramJS signInWithPassword, whose internal loop hid every password-step failure behind
 *  a silent retry or a generic AUTH_USER_CANCEL, so the UI showed the password request
 *  as a login refusal. Wrong passwords re-prompt; every other error propagates with its
 *  real code after onError decides to stop. */
async function confirmWithPassword(client:TelegramClient,options:QrOptions):Promise<Api.TypeUser>{
  while(!options.signal.aborted){
    const pwd=await client.invoke(new Api.account.GetPassword());
    if(!(pwd instanceof Api.account.Password)||!(pwd.currentAlgo instanceof Api.PasswordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow))throw new Error('PASSWORD_ALGO_UNSUPPORTED');
    const password=await options.password(pwd.hint);
    if(!password)throw new Error('AUTH_USER_CANCEL');
    try{
      const srp=await computeCheck(pwd,password);
      const result=await client.invoke(new Api.auth.CheckPassword({password:srp}));
      if(!(result instanceof Api.auth.Authorization))throw new Error('QR_SIGNUP_REQUIRED');
      return result.user;
    }catch(error){
      if(options.signal.aborted)throw new Error('AUTH_USER_CANCEL');
      const err=error instanceof Error?error:new Error(String(error));
      if(await options.onError(err))throw err;
    }
  }
  throw new Error('AUTH_USER_CANCEL');
}
