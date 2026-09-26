import React, {useEffect, useState} from 'react';
import {CheckCircle2, MessageCircle, QrCode} from 'lucide-react';
import {apiClient} from '../../api/apiClient.js';
import LumaSpin from '../ui/luma-spin.js';

type Method='bot'|'qr';
type Login={state:string;method?:Method;configured:boolean;botUrl?:string;qr?:string;error?:string;passwordHint?:string};

export function TelegramLoginFlow(){
  const [method,setMethod]=useState<Method>(()=>window.Telegram?.WebApp?.initData||window.matchMedia('(pointer: coarse)').matches?'bot':'qr');
  const [login,setLogin]=useState<Login>();
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    let active=true;
    apiClient.request<Login>('/telegram/login/status').then(status=>{if(active){if(status.method)setMethod(status.method);setLogin(status);}}).catch(e=>{if(active)setError((e as Error).message);});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!login||['idle','error','connected'].includes(login.state))return;
    let active=true;
    const poll=async()=>{
      try{const status=await apiClient.request<Login>('/telegram/login/status');if(active)setLogin(status);}
      catch(e){if(active)setError((e as Error).message);}
    };
    const timer=window.setInterval(()=>void poll(),1500);
    return()=>{active=false;window.clearInterval(timer);};
  },[login?.state]);

  const openBot=(url:string)=>{
    if(window.Telegram?.WebApp?.initData)window.Telegram.WebApp.openTelegramLink(url);
    else window.open(url,'_blank','noopener,noreferrer');
  };
  const start=async(selected:Method)=>{
    setError('');setBusy(true);
    try{
      const result=await apiClient.request<{url?:string}>(selected==='bot'?'/telegram/login/start-bot':'/telegram/login/start',{method:'POST',body:'{}'});
      setMethod(selected);
      setLogin({state:selected==='bot'?'bot_pending':'connecting',method:selected,configured:true,botUrl:result.url});
      if(selected==='bot'&&result.url)openBot(result.url);
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  };
  const current=login?.method===method?login:undefined;
  return <div className="telegram-login-flow">
    <div className="telegram-login-methods" role="tablist" aria-label="Способ подключения Telegram">
      <button type="button" role="tab" aria-selected={method==='bot'} onClick={()=>setMethod('bot')}><MessageCircle size={17}/> Через бота</button>
      <button type="button" role="tab" aria-selected={method==='qr'} onClick={()=>setMethod('qr')}><QrCode size={17}/> По QR</button>
    </div>
    {error&&<p className="lyrics-error" role="alert">{error}</p>}
    {current?.error&&<p className="lyrics-error" role="alert">{current.error}</p>}
    {login?.state==='connected'?<div className="telegram-login-success" role="status"><CheckCircle2 size={40}/><strong>Telegram подключён</strong><p>Готово. Вернитесь к музыке в Осколке.</p><button className="primary-button" onClick={()=>location.reload()}>Открыть Осколок</button></div>:method==='bot'?<div className="telegram-login-bot">
      <p className="telegram-login-hint">Продолжите вход в личном чате с ботом: отправьте номер, затем код Telegram и, если потребуется, облачный пароль. После подтверждения вернитесь сюда.</p>
      {!current||['idle','error'].includes(current.state)?<button className="primary-button" disabled={busy||!login?.configured} onClick={()=>void start('bot')}><MessageCircle size={19}/> Продолжить в боте</button>:<>
        <div className="telegram-login-progress" role="status">
          {current.state==='bot_pending'?<span>Ожидаем открытия бота</span>:current.state==='bot_phone'?<span>Отправьте номер в боте</span>:current.state==='code'?<span>Введите код в боте</span>:current.state==='password'?<span>Введите облачный пароль в боте</span>:<span>Проверяем подключение…</span>}
          <LumaSpin size="sm" label="Проверяем подключение"/>
        </div>
        {current.botUrl&&<button className="secondary-button" onClick={()=>openBot(current.botUrl!)}>Открыть диалог с ботом</button>}
      </>}
    </div>:<div className="telegram-login-qr">
      {current?.state==='qr'&&current.qr?<><img src={current.qr} alt="QR-код для входа в Telegram"/><p>Откройте Telegram на другом устройстве: Настройки → Устройства → Подключить устройство.</p></>:<><p className="telegram-login-hint">QR удобно сканировать с другого устройства. Если вы сейчас на телефоне, выберите вход через бота.</p><button className="primary-button" disabled={busy||!login?.configured} onClick={()=>void start('qr')}><QrCode size={19}/> Показать QR</button></>}
      {current?.state==='password'&&<form onSubmit={e=>{e.preventDefault();setBusy(true);void apiClient.request('/telegram/login/password',{method:'POST',body:JSON.stringify({password})}).then(()=>{setPassword('');setLogin(v=>v?{...v,state:'verifying'}:v);}).catch(e=>setError((e as Error).message)).finally(()=>setBusy(false));}}><label>Облачный пароль<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="primary-button" disabled={busy}>Подтвердить</button></form>}
    </div>}
    {login&&!login.configured&&<p className="login-setup">Вход не настроен: на сервере нужны TELEGRAM_API_ID и TELEGRAM_API_HASH.</p>}
  </div>;
}
