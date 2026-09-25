import http from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

export function createPanelServer(config=process.env){
  const {PANEL_PASSWORD:password,ADMIN_API_KEY:key,OSKOLOK_API_URL:api,PANEL_ORIGIN:origin}=config;
  if(!password||password.length<16||!key||key.length<32||!api||!origin)throw new Error('Configure PANEL_PASSWORD (16+), ADMIN_API_KEY (32+), OSKOLOK_API_URL and PANEL_ORIGIN.');
  const apiUrl=new URL(api),panelOrigin=new URL(origin).origin;
  if(!['http:','https:'].includes(apiUrl.protocol))throw new Error('OSKOLOK_API_URL must be HTTP(S).');
  const secure=panelOrigin.startsWith('https:');
  const sessions=new Map(),attempts=new Map();
  const digest=s=>createHash('sha256').update(s).digest();
  const cookie=(value,maxAge)=>`panel_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`;
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  const body=async req=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2_000_000)throw Object.assign(new Error('Слишком большой файл.'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks).toString();};
  const dist=path.resolve(fileURLToPath(new URL('./dist/',import.meta.url)));
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      const url=new URL(req.url,'http://panel');
      const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('panel_session='))?.slice(14);
      const now=Date.now();
      for(const [id,expires]of sessions)if(expires<now)sessions.delete(id);
      for(const [id,a]of attempts)if(a.until<now)attempts.delete(id);
      if(!['GET','HEAD'].includes(req.method)){
        if(req.headers.origin!==panelOrigin||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:{message:'Недопустимый источник запроса.'}});
      }
      if(url.pathname==='/session'&&req.method==='POST'){
        const ip=req.socket.remoteAddress||'unknown',a=attempts.get(ip)||{count:0,until:now+900000};
        if(a.count>=10)return send(res,429,{error:{message:'Слишком много попыток. Повторите через 15 минут.'}});
        const input=JSON.parse(await body(req));
        if(typeof input.password!=='string'||!timingSafeEqual(digest(input.password),digest(password))){a.count++;attempts.set(ip,a);return send(res,401,{error:{message:'Неверный пароль.'}});}
        attempts.delete(ip);const next=randomBytes(32).toString('hex');sessions.set(next,now+8*3600000);
        res.setHeader('Set-Cookie',cookie(next,8*3600));return send(res,200,{data:{ok:true}});
      }
      if(url.pathname==='/session'&&req.method==='GET')return send(res,200,{data:{authenticated:!!token&&sessions.has(token)}});
      if(url.pathname==='/session'&&req.method==='DELETE'){sessions.delete(token);res.setHeader('Set-Cookie',cookie('',0));return send(res,200,{data:{ok:true}});}
      if(url.pathname.startsWith('/api/')){
        if(!token||!sessions.has(token))return send(res,401,{error:{message:'Войдите в панель.'}});
        const route=url.pathname.slice(4);
        const allowed=(req.method==='GET'&&['/submissions','/lyrics'].includes(route))||(req.method==='POST'&&(route==='/lyrics'||/^\/submissions\/[a-zA-Z0-9-]+\/review$/.test(route)))||(req.method==='DELETE'&&/^\/lyrics\/[a-zA-Z0-9-]+$/.test(route));
        if(!allowed)return send(res,404,{error:{message:'Маршрут не найден.'}});
        const response=await fetch(`${api.replace(/\/$/,'')}/admin${route}${url.search}`,{method:req.method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:req.method==='GET'?undefined:await body(req),signal:AbortSignal.timeout(15000),redirect:'error'});
        res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:{message:'Метод не поддерживается.'}});
      const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\//,'');
      const file=path.resolve(dist,relative);
      if(!file.startsWith(dist+path.sep))return send(res,404,{error:{message:'Не найдено.'}});
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
      const data=await readFile(file);res.writeHead(200,{'Content-Type':mime});res.end(req.method==='HEAD'?undefined:data);
    }catch(e){send(res,e.code==='ENOENT'?404:e.status||502,{error:{message:e.code==='ENOENT'?'Не найдено.':e.status?e.message:'Не удалось выполнить запрос. Проверьте настройки и доступность API.'}});}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  createPanelServer().listen(Number(process.env.PORT||4100),'0.0.0.0',()=>console.log('Oskolok developer panel started'));
}
