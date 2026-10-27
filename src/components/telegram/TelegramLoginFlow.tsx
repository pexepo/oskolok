import React,{useEffect,useRef,useState} from 'react';
import {CheckCircle2,MessageCircle,QrCode,Phone,ArrowRight,RotateCcw,X,ShieldCheck} from 'lucide-react';
import {apiClient} from '../../api/apiClient.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import LumaSpin from '../ui/luma-spin.js';
import './telegram-login.css';

type Method='bot'|'qr'|'phone';
type Channel='app'|'sms'|'call'|'email'|'fragment';
type Login={state:string;method?:Method;configured:boolean;botUrl?:string;qr?:string;error?:string;passwordHint?:string;codeViaApp?:boolean;codeChannel?:Channel;codeLength?:number;codeText?:boolean;emailPattern?:string;nextChannel?:Channel;resendAt?:number;expires?:number;qrExpires?:number};
const terminal=['idle','error','expired','connected'];
export function TelegramLoginFlow(){
  const t=useTranslation();
  const [method,setMethod]=useState<Method>(()=>window.Telegram?.WebApp?.initData||window.matchMedia('(pointer: coarse)').matches?'phone':'qr');
  const [login,setLogin]=useState<Login>();
  const [phone,setPhone]=useState('');
  const [code,setCode]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [now,setNow]=useState(Date.now());
  const generation=useRef(0);
  useEffect(()=>{
    let active=true;
    apiClient.request<Login>('/telegram/login/status').then(status=>{if(active){if(status.method)setMethod(status.method);setLogin(status);}}).catch(e=>{if(active)setError((e as Error).message);});
    const clock=window.setInterval(()=>setNow(Date.now()),1000);
    return()=>{active=false;window.clearInterval(clock);};
  },[]);
  useEffect(()=>{
    if(!login||terminal.includes(login.state))return;
    let active=true,timer:number|undefined;
    const version=generation.current;
    const poll=async()=>{
      try{const status=await apiClient.request<Login>('/telegram/login/status');if(active&&version===generation.current){setLogin(status);setError('');}}
      catch(e){if(active)setError((e as Error).message);}
      if(active)timer=window.setTimeout(()=>void poll(),1500);
    };
    timer=window.setTimeout(()=>void poll(),500);
    return()=>{active=false;window.clearTimeout(timer);};
  },[login?.state]);
  const openBot=(url:string)=>{if(window.Telegram?.WebApp?.initData)window.Telegram.WebApp.openTelegramLink(url);else window.open(url,'_blank','noopener,noreferrer');};
  const start=async(selected:Method)=>{
    generation.current++;setError('');setBusy(true);setCode('');setPassword('');
    try{
      const result=await apiClient.request<{url?:string}>(selected==='bot'?'/telegram/login/start-bot':selected==='phone'?'/telegram/login/start-phone':'/telegram/login/start',{method:'POST',body:JSON.stringify(selected==='phone'?{phone}:{})});
      setMethod(selected);setLogin({state:selected==='bot'?'bot_pending':'connecting',method:selected,configured:true,botUrl:result.url});
      if(selected==='bot'&&result.url)openBot(result.url);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const cancel=async()=>{
    generation.current++;setBusy(true);
    try{await apiClient.request('/telegram/login/cancel',{method:'POST',body:'{}'});setLogin(v=>({state:'idle',configured:!!v?.configured}));setError('');setCode('');setPassword('');}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const submit=async(kind:'code'|'password')=>{
    setBusy(true);setError('');
    try{await apiClient.request(`/telegram/login/${kind}`,{method:'POST',body:JSON.stringify(kind==='code'?{code}:{password})});setCode('');setPassword('');setLogin(v=>v?{...v,state:'verifying',error:undefined}:v);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const resend=async()=>{
    setBusy(true);setError('');
    try{await apiClient.request('/telegram/login/resend',{method:'POST',body:'{}'});setLogin(await apiClient.request<Login>('/telegram/login/status'));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const channelText=(c?:Channel)=>c==='app'?t('в чат «Telegram» на вашем телефоне или компьютере','to the “Telegram” chat on your phone or computer'):c==='sms'?t('по SMS','by SMS'):c==='call'?t('звонком','by phone call'):c==='email'?t(`на почту ${login?.emailPattern||'входа'}`,`to ${login?.emailPattern||'your login email'}`):c==='fragment'?t('в Fragment','to Fragment'):t('от Telegram','from Telegram');
  const nextText=(c?:Channel)=>c==='sms'?t('Прислать по SMS','Send by SMS'):c==='call'?t('Позвонить мне','Call me'):c==='email'?t('Прислать на почту','Send to email'):t('Прислать иначе','Send another way');
  const active=!!login&&!terminal.includes(login.state);
  const state=login?.state||'idle';
  const remaining=Math.max(0,Math.ceil((((state==='qr'?login?.qrExpires:login?.expires)||now)-now)/1000));
  const step=state==='connected'?3:['code','password','verifying'].includes(state)?2:active?1:0;
  return <div className="telegram-login-flow">
    <div className="telegram-login-steps" aria-label={t('Этапы входа','Login steps')}>{[t('Способ','Method'),t('Подтверждение','Confirmation'),t('Готово','Ready')].map((label,i)=><span key={i} data-done={step>i}><b>{step>i?<CheckCircle2 size={14}/>:i+1}</b>{label}</span>)}</div>
    {state!=='connected'&&<div className="telegram-login-methods" role="tablist" aria-label={t('Способ входа','Login method')}>
      <button type="button" role="tab" disabled={busy||active} aria-selected={method==='phone'} onClick={()=>setMethod('phone')}><Phone size={17}/>{t('Телефон','Phone')}</button>
      <button type="button" role="tab" disabled={busy||active} aria-selected={method==='qr'} onClick={()=>setMethod('qr')}><QrCode size={17}/>{t('QR-код','QR code')}</button>
      <button type="button" role="tab" disabled={busy||active} aria-selected={method==='bot'} onClick={()=>setMethod('bot')}><MessageCircle size={17}/>{t('Бот','Bot')}</button>
    </div>}
    {(error||login?.error)&&<p className="telegram-login-error" role="alert">{error||login?.error}</p>}
    {state==='expired'&&<p role="status">{t('Время входа истекло. Начните снова.','Login expired. Please start again.')}</p>}
    {state==='connected'?<div className="telegram-login-success" role="status"><CheckCircle2 size={40}/><strong>{t('Telegram подключён','Telegram connected')}</strong><p>{t('Всё готово. Ваша музыка ждёт.','All set. Your music is waiting.')}</p><button className="primary-button" onClick={()=>location.reload()}>{t('Открыть Осколок','Open OSKOLOK')}<ArrowRight size={18}/></button></div>:<>
      {!active&&(method==='phone'?<form onSubmit={e=>{e.preventDefault();void start('phone');}}><label>{t('Ваш номер телефона','Your phone number')}<input type="tel" autoComplete="tel" placeholder="+375 29 123 45 67" value={phone} onChange={e=>setPhone(e.target.value)} required disabled={busy}/></label><p className="telegram-login-hint">{t('Telegram пришлёт код в приложение, по SMS, звонком или на почту входа — мы покажем, куда именно.','Telegram sends the code in-app, by SMS, call or login email — we will show where.')}</p><button className="primary-button" disabled={busy||!login?.configured}>{busy?<LumaSpin size="sm"/>:<ArrowRight size={18}/>} {t('Получить код','Send code')}</button></form>:<><p className="telegram-login-hint">{method==='qr'?t('Откройте Telegram на другом устройстве: Настройки → Устройства → Подключить устройство.','On another device, open Telegram → Settings → Devices → Link Desktop Device.'):t('Бот поможет передать номер. Код и пароль вводятся здесь, а не в чате.','The bot helps share your number. Enter the code and password here, not in the chat.')}</p><button className="primary-button" disabled={busy||!login?.configured} onClick={()=>void start(method)}>{method==='qr'?<QrCode size={19}/>:<MessageCircle size={19}/>} {method==='qr'?t('Показать QR','Show QR'):t('Продолжить в боте','Continue in bot')}</button></>)}
      {state==='qr'&&login?.qr&&<div className="telegram-login-qr"><div className="telegram-qr-frame"><img src={login.qr} alt={t('QR-код входа Telegram','Telegram login QR code')}/></div><p>{t('Сканируйте в Telegram → Настройки → Устройства','Scan in Telegram → Settings → Devices')}</p><small role="timer">{t('Обновится через','Refreshes in')} {remaining} {t('с','s')}</small></div>}
      {['connecting','verifying','bot_pending','bot_phone'].includes(state)&&<div className="telegram-login-progress" role="status"><LumaSpin size="sm"/><span>{state==='bot_pending'?t('Откройте бота для продолжения','Open the bot to continue'):state==='bot_phone'?t('Поделитесь номером в боте','Share your phone number in the bot'):state==='connecting'?t('Подключаемся к Telegram…','Connecting to Telegram…'):t('Проверяем подтверждение…','Verifying…')}</span></div>}
      {(state==='code'||state==='password')&&<form onSubmit={e=>{e.preventDefault();void submit(state);}}><label>{state==='code'?t('Код подтверждения','Confirmation code'):t('Облачный пароль','Two-step verification password')}<input key={state} autoFocus type={state==='code'?'text':'password'} inputMode={state==='code'&&!login?.codeText?'numeric':undefined} autoComplete={state==='code'?'one-time-code':'current-password'} maxLength={state==='code'?(login?.codeText?64:12):256} value={state==='code'?code:password} onChange={e=>state==='code'?setCode(login?.codeText?e.target.value:e.target.value.replace(/[^\d -]/g,'')):setPassword(e.target.value)} required/></label>{state==='password'&&login?.passwordHint&&<small>{t('Подсказка','Hint')}: {login.passwordHint}</small>}<p className="telegram-login-hint">{state==='code'?<>{t('Код отправлен','Code sent')} {channelText(login?.codeChannel)}{login?.codeLength?t(` · ${login.codeLength} цифр`,` · ${login.codeLength} digits`):''}. {t('Не пересылайте его никому — Telegram отменит вход.','Do not forward it — Telegram will invalidate it.')}</>:t('Это пароль двухэтапной проверки вашего аккаунта Telegram.','This is the two-step verification password for your Telegram account.')}</p><button className="primary-button" disabled={busy}>{t('Подтвердить','Confirm')}<ArrowRight size={18}/></button>{state==='code'&&<div className="telegram-login-resend">{login?.nextChannel?<button type="button" className="secondary-button" disabled={busy||now<(login.resendAt||0)} onClick={()=>void resend()}>{nextText(login.nextChannel)}{now<(login.resendAt||0)?` · ${Math.ceil(((login.resendAt||0)-now)/1000)} ${t('с','s')}`:''}</button>:null}<button type="button" className="telegram-login-cancel" disabled={busy} onClick={()=>void cancel().then(()=>setMethod('qr'))}><QrCode size={16}/>{t('Код не приходит — войти по QR','No code? Use QR')}</button></div>}</form>}
      {active&&login?.botUrl&&['bot_pending','bot_phone'].includes(state)&&<button className="secondary-button" onClick={()=>openBot(login.botUrl!)}>{t('Открыть бота','Open bot')}</button>}
      {active&&<button className="telegram-login-cancel" disabled={busy} onClick={()=>void cancel()}><X size={16}/>{t('Отменить и сменить способ','Cancel and change method')}</button>}
      {state==='error'&&<button className="telegram-login-cancel" disabled={busy} onClick={()=>void cancel()}><RotateCcw size={16}/>{t('Начать заново','Start again')}</button>}
    </>}
    {login&&!login.configured&&<p className="login-setup">{t('Вход пока недоступен. Владелец приложения должен завершить настройку Telegram.','Login is unavailable. The owner needs to finish Telegram setup.')}</p>}
    <small className="telegram-login-trust"><ShieldCheck size={15}/>{t('Подтверждение через Telegram','Verified by Telegram')}</small>
  </div>;
}
