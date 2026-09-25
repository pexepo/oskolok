import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { spotifyService } from '../services/SpotifyService.js';
import { SoundCloudMapper } from '../services/SoundCloudMapper.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import type { Track } from '../types/index.js';
import {prisma} from '../database/client.js';
import {encryptSession,decryptStoredSession} from '../services/telegramSession.js';
import {trackController} from './trackController.js';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {musicCatalogService} from '../services/MusicCatalogService.js';

type Provider = 'spotify' | 'soundcloud';
const providers = {
 spotify: { id:env.SPOTIFY_CLIENT_ID, secret:env.SPOTIFY_CLIENT_SECRET, auth:'https://accounts.spotify.com/authorize', token:'https://accounts.spotify.com/api/token', api:'https://api.spotify.com/v1', scope:'playlist-read-private playlist-read-collaborative user-library-read streaming user-read-playback-state user-modify-playback-state user-read-currently-playing' },
 soundcloud: { id:env.SOUNDCLOUD_CLIENT_ID, secret:env.SOUNDCLOUD_CLIENT_SECRET, auth:'https://secure.soundcloud.com/authorize', token:'https://secure.soundcloud.com/oauth/token', api:'https://api.soundcloud.com', scope:'' },
};
// Server-only, per-user credentials. Expire on restart; no tokens in browser storage.
type StoredToken={access:string;refresh?:string;expires:number;scope?:string};
const locks=new Map<string,Promise<StoredToken>>();
const tokenId=(p:string,user:string)=>`${user}:${p}`;
async function stored(p:string,user:string){const row=await prisma.musicAccountToken.findUnique({where:{id:tokenId(p,user)}});return row?JSON.parse(decryptStoredSession(row.encryptedData)) as StoredToken:null;}
async function save(p:string,user:string,data:StoredToken){await prisma.musicAccountToken.upsert({where:{id:tokenId(p,user)},create:{id:tokenId(p,user),userId:user,provider:p,encryptedData:encryptSession(JSON.stringify(data))},update:{encryptedData:encryptSession(JSON.stringify(data))}});}
const yandexPending=new Map<string,{deviceCode:string;expires:number;nextPoll:number;interval:number}>();
function yandex(input:Record<string,unknown>):Promise<any>{
 const base=path.dirname(fileURLToPath(import.meta.url));
 const worker=[path.join(base,'../services/yandex_worker.py'),path.resolve('server/src/services/yandex_worker.py')].find(existsSync);
 if(!worker)throw new Error('Модуль Яндекс Музыки не найден');
 const python=process.env.PYTHON_PATH||[path.resolve('.venv/bin/python'),path.resolve('.venv/Scripts/python.exe')].find(existsSync)||'python3';
 return new Promise((resolve,reject)=>{const child=spawn(python,[worker],{stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new Error('Яндекс Музыка не ответила вовремя'));},120000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',()=>{clearTimeout(timer);try{const result=JSON.parse(out);if(result.ok)resolve(result.data);else reject(new Error(result.error));}catch{reject(new Error(err.includes('No module named')?'Установите Python зависимость: pip install -r server/python-requirements.txt':'Не удалось прочитать ответ Яндекс Музыки'));}});child.stdin.end(JSON.stringify(input));});
}
type OAuthAttempt={user:string;provider:Provider;verifier:string;redirect:string;expires:number};
const pendingProvider=(p:Provider)=>`oauth_pending_${p}`;
const pendingId=(state:string)=>`oauth:${createHash('sha256').update(state).digest('hex')}`;
export async function saveOAuthAttempt(state:string,item:OAuthAttempt){
 const provider=pendingProvider(item.provider),encryptedData=encryptSession(JSON.stringify(item));
 await prisma.musicAccountToken.upsert({
  where:{userId_provider:{userId:item.user,provider}},
  create:{id:pendingId(state),userId:item.user,provider,encryptedData},
  update:{id:pendingId(state),encryptedData},
 });
}
export async function takeOAuthAttempt(state:string,p:Provider):Promise<OAuthAttempt|null>{
 if(!/^[A-Za-z0-9_-]{40,100}$/.test(state))return null;
 const id=pendingId(state),provider=pendingProvider(p);
 const row=await prisma.musicAccountToken.findUnique({where:{id}});
 if(!row||row.provider!==provider)return null;
 const claimed=await prisma.musicAccountToken.deleteMany({where:{id,provider}});
 if(claimed.count!==1)return null;
 const item=JSON.parse(decryptStoredSession(row.encryptedData)) as OAuthAttempt;
 return item.user===row.userId&&item.provider===p&&item.expires>Date.now()?item:null;
}
const callback = (p:Provider) => `${process.env.MUSIC_OAUTH_ORIGIN || `http://127.0.0.1:${env.PORT}`}/api/music-accounts/${p}/callback`;
const provider = (s:string):Provider => {if(s!=='spotify'&&s!=='soundcloud')throw new Error('Площадка не поддерживается');return s;};
const route = (fn:any) => async(req:any,res:any) => {try{await fn(req,res);}catch(e){res.status(400).json({error:{message:e instanceof Error?e.message:'Ошибка подключения'}});}};
async function tokenRequest(p:Provider, values:Record<string,string>){
 const c=providers[p];const body=new URLSearchParams({...values,client_id:c.id,...(c.secret?{client_secret:c.secret}:{})});
 const r=await fetch(c.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('Не удалось подтвердить вход. Проверьте настройки приложения на площадке.');
 return await r.json() as any;
}
async function access(p:Provider,user:string){
 const key=tokenId(p,user),a=await stored(p,user);if(!a)throw new Error('Сначала войдите в аккаунт');
 if(a.expires>Date.now()+30000)return a.access;
 if(!a.refresh)throw new Error('Войдите в аккаунт заново');
 let pending=locks.get(key);
 if(!pending){pending=(async()=>{const fresh=await stored(p,user);if(fresh&&fresh.expires>Date.now()+30000)return fresh;const t=await tokenRequest(p,{grant_type:'refresh_token',refresh_token:fresh?.refresh||a.refresh!});const value={access:t.access_token,refresh:t.refresh_token||fresh?.refresh,expires:Date.now()+t.expires_in*1000,scope:t.scope||fresh?.scope};await save(p,user,value);return value;})();locks.set(key,pending);void pending.finally(()=>{if(locks.get(key)===pending)locks.delete(key);}).catch(()=>{});}
 return (await pending).access;
}
async function request(p:Provider,user:string,path:string){
 const c=providers[p],url=new URL(path,c.api+'/');if(url.origin!==new URL(c.api).origin)throw new Error('Некорректная ссылка каталога');
 const token=await access(p,user),r=await fetch(url,{headers:{Authorization:`${p==='spotify'?'Bearer':'OAuth'} ${token}`},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error(musicAccountError(p,r.status,url.pathname));
 return await r.json() as any;
}
export function musicAccountError(p:Provider,status:number,pathname:string){
 if(p==='spotify'){
  if(status===401)return 'Сессия Spotify истекла. Отключите аккаунт в Осколке и войдите снова.';
  if(status===403&&/^\/v1\/me(?:\/playlists)?$/.test(pathname))return 'Spotify не дал доступ к аккаунту. Для тестового приложения владелец должен добавить ваш Spotify email в Dashboard → Settings → Users Management. После добавления переподключите Spotify в Осколке.';
  if(status===403&&/^\/v1\/playlists\/[^/]+\/items$/.test(pathname))return 'Spotify разрешает импортировать треки только из ваших плейлистов и тех, где вы соавтор. Чужой плейлист, сохранённый в библиотеке, может показываться в списке, но его треки недоступны через API.';
  if(status===429)return 'Spotify временно ограничил запросы. Повторите попытку позже.';
 }
 return status===403?'Площадка не разрешила доступ к этой подборке.':`Площадка вернула ошибку ${status}.`;
}
async function pages(p:Provider,user:string,path:string){let next:string|null=path;const out:any[]=[];const seen=new Set<string>();while(next){if(seen.has(next))throw new Error('Площадка повторила страницу каталога');seen.add(next);const d=await request(p,user,next);out.push(...(Array.isArray(d)?d:d.items||d.collection||[]));next=d.next||d.next_href||null;}return out;}
export const musicAccountCallback=Router();
musicAccountCallback.get('/:provider/callback',async(req:any,res:any)=>{
 try{
  const p=provider(req.params.provider),state=String(req.query.state||''),item=await takeOAuthAttempt(state,p);
  if(!item)throw new Error('Ссылка входа устарела. Вернитесь в Осколок и нажмите «Spotify · Войти» ещё раз.');
  if(req.query.error||!req.query.code)throw new Error('Вход отменён. Вернитесь в Осколок и попробуйте снова.');
  const t=await tokenRequest(p,{grant_type:'authorization_code',code:String(req.query.code),redirect_uri:item.redirect,code_verifier:item.verifier});
  await save(p,item.user,{access:t.access_token,refresh:t.refresh_token,expires:Date.now()+t.expires_in*1000,scope:t.scope});
  res.type('html').send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Осколок · аккаунт подключён</title><main style="font:18px system-ui;max-width:28rem;margin:15vh auto;padding:2rem;text-align:center"><h1>Аккаунт подключён ✓</h1><p>Вернитесь в Осколок — подключение появится автоматически.</p></main>');
 }catch(error){
  const message=error instanceof Error?error.message:'Не удалось завершить вход. Вернитесь в Осколок и попробуйте снова.';
  const safe=message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  res.status(400).type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Осколок · вход не завершён</title><main style="font:18px system-ui;max-width:28rem;margin:15vh auto;padding:2rem;text-align:center"><h1>Вход не завершён</h1><p>${safe}</p></main>`);
 }
});
export const musicAccounts=Router();
musicAccounts.get('/',route(async(_req:any,res:any)=>res.json({data:[...await Promise.all(Object.entries(providers).map(async([id,c])=>({id,configured:!!c.id&&(id!=='soundcloud'||!!c.secret),connected:!!await stored(id as Provider,res.locals.userId)}))),{id:'yandex',configured:true,connected:!!await stored('yandex',res.locals.userId)}]})));
musicAccounts.post('/yandex/connect',route(async(_req:any,res:any)=>{const data=await yandex({action:'code'}),userId=res.locals.userId;yandexPending.set(userId,{deviceCode:data.deviceCode,expires:Date.now()+data.expiresIn*1000,nextPoll:0,interval:Math.max(3000,data.interval*1000)});res.json({data:{userCode:data.userCode,verificationUrl:data.verificationUrl,expiresIn:data.expiresIn}});}));
musicAccounts.get('/yandex/status',route(async(_req:any,res:any)=>{const userId=res.locals.userId,pending=yandexPending.get(userId);if(!pending){res.json({data:{state:await stored('yandex',userId)?'connected':'idle'}});return;}if(Date.now()>pending.expires){yandexPending.delete(userId);res.json({data:{state:'expired'}});return;}if(Date.now()<pending.nextPoll){res.json({data:{state:'pending'}});return;}pending.nextPoll=Date.now()+pending.interval;const token=await yandex({action:'poll',deviceCode:pending.deviceCode});if(token.pending){res.json({data:{state:'pending'}});return;}await save('yandex',userId,{access:token.access,refresh:token.refresh,expires:Date.now()+(token.expires||3600)*1000});yandexPending.delete(userId);res.json({data:{state:'connected'}});}));
musicAccounts.get('/yandex/playlists',route(async(_req:any,res:any)=>{const account=await stored('yandex',res.locals.userId);if(!account)throw new Error('Подключите Яндекс Музыку');const lists=await yandex({action:'playlists',token:account.access});res.json({data:[{id:'liked',title:'Любимые треки'},...lists]});}));
musicAccounts.get('/yandex/playlists/:id',route(async(req:any,res:any)=>{const account=await stored('yandex',res.locals.userId);if(!account)throw new Error('Подключите Яндекс Музыку');const rows:Array<{artist:string;title:string;artworkUrl?:string}>=await yandex({action:'tracks',token:account.access,id:req.params.id});const tracks:Track[]=[];let cursor=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<rows.length){const row=rows[cursor++],result=await musicCatalogService.search(`${row.artist} ${row.title}`,{limit:8}).catch(()=>null);const norm=(v:string)=>v.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();const match=result?.tracks.find(t=>norm(t.title)===norm(row.title)&&norm(t.artist.name)===norm(row.artist));if(match){tracks.push({...match,artworkUrl:match.artworkUrl||row.artworkUrl});}}}));await Promise.all(tracks.map(t=>trackCacheRepository.setCachedTrack(t)));res.json({data:{title:req.params.id==='liked'?'Любимые треки':'Плейлист',source:'yandex',tracks,total:rows.length,warning:tracks.length<rows.length?'Некоторые записи не найдены в каталоге Осколка.':''}});}));
musicAccounts.delete('/yandex',route(async(_req:any,res:any)=>{await prisma.musicAccountToken.deleteMany({where:{userId:res.locals.userId,provider:'yandex'}});yandexPending.delete(res.locals.userId);res.json({data:{ok:true}});}));
musicAccounts.post('/:provider/connect',route(async(req:any,res:any)=>{
 const p=provider(req.params.provider),c=providers[p];if(!c.id||(p==='soundcloud'&&!c.secret))throw new Error('Для входа нужны ключи зарегистрированного приложения площадки.');
 await prisma.musicAccountToken.deleteMany({where:{provider:{in:[pendingProvider('spotify'),pendingProvider('soundcloud')]},updatedAt:{lt:new Date(Date.now()-60*60*1000)}}});
 const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url'),redirect=callback(p);
 await saveOAuthAttempt(state,{user:res.locals.userId,provider:p,verifier,redirect,expires:Date.now()+20*60*1000});
 const u=new URL(c.auth);u.search=new URLSearchParams({client_id:c.id,response_type:'code',redirect_uri:redirect,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',...(c.scope?{scope:c.scope}:{})}).toString();res.json({data:{url:u.href}});
}));
musicAccounts.delete('/:provider',route(async(req:any,res:any)=>{await prisma.musicAccountToken.deleteMany({where:{userId:res.locals.userId,provider:provider(req.params.provider)}});res.json({data:{ok:true}});}));
musicAccounts.get('/spotify/playback-token',route(async(_req:any,res:any)=>{const token=await access('spotify',res.locals.userId);const account=await stored('spotify',res.locals.userId);if(!account?.scope?.includes('streaming'))throw new Error('Переподключите Spotify для воспроизведения.');res.setHeader('Cache-Control','no-store');res.json({data:{token}});}));
musicAccounts.post('/spotify/match',route(async(req:any,res:any)=>{
 const trackId=String(req.body?.trackId||'');if(!trackId||trackId.length>200)throw new Error('Выберите трек');
 const track=await trackController.resolveTrack(trackId);if(!track)throw new Error('Трек не найден');
 const account=await stored('spotify',res.locals.userId);if(!account){res.json({data:null});return;}
 if(track.id.startsWith('spotify:')){res.json({data:{id:track.sourceId,uri:`spotify:track:${track.sourceId}`}});return;}
 const norm=(v:string)=>v.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const response=await request('spotify',res.locals.userId,`search?type=track&limit=10&q=${encodeURIComponent(`track:${track.title} artist:${track.artist.name}`)}`);
 const found=(response.tracks?.items||[]).find((x:any)=>norm(x.name)===norm(track.title)&&x.artists?.some((a:any)=>norm(a.name)===norm(track.artist.name))&&Math.abs(x.duration_ms/1000-track.duration)<=3&&x.is_playable!==false);
 res.json({data:found?{id:found.id,uri:found.uri}:null});
}));
musicAccounts.post('/spotify/player',route(async(req:any,res:any)=>{const {method,path,body}=req.body||{};if(!['PUT','POST','GET'].includes(method)||!['me/player/play','me/player/pause','me/player/seek','me/player/volume','me/player','me/player/devices'].includes(path))throw new Error('Недопустимая операция плеера');const token=await access('spotify',res.locals.userId);const url=new URL(path,providers.spotify.api+'/');if(req.body?.deviceId)url.searchParams.set('device_id',String(req.body.deviceId));if(req.body?.positionMs!==undefined)url.searchParams.set('position_ms',String(req.body.positionMs));if(req.body?.volumePercent!==undefined)url.searchParams.set('volume_percent',String(req.body.volumePercent));const result=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});if(!result.ok)throw new Error(result.status===403?'Spotify Premium или разрешение воспроизведения недоступны':`Spotify вернул ${result.status}`);res.json({data:result.status===204?{ok:true}:await result.json()});}));
musicAccounts.get('/:provider/playlists',route(async(req:any,res:any)=>{
 const p=provider(req.params.provider),user=res.locals.userId;
 const spotifyId=p==='spotify'?(await request('spotify',user,'me')).id:null;
 const list=await pages(p,user,p==='spotify'?'me/playlists?limit=50':'me/playlists?linked_partitioning=true&limit=50');
 res.json({data:[{id:'liked',title:'Любимые треки'},...list.map(x=>({id:String(x.id||x.urn),title:x.name||x.title,count:x.items?.total??x.tracks?.total??x.track_count,artworkUrl:x.images?.[0]?.url||x.artwork_url||x.image_url,...(p==='spotify'?{importable:x.owner?.id===spotifyId||x.collaborative===true}: {})}))]});
}));
musicAccounts.get('/:provider/playlists/:id',route(async(req:any,res:any)=>{
 const p=provider(req.params.provider),id=encodeURIComponent(req.params.id),user=res.locals.userId;let tracks:Track[]=[];
 if(p==='spotify'){const rows=await pages(p,user,id==='liked'?'me/tracks?limit=50':`playlists/${id}/items?limit=50`);tracks=rows.map(x=>x.track||x.item).filter(x=>x?.id&&x.type!=='episode').map(x=>spotifyService.mapTrack(x));}
 else {let rows:any[];if(id==='liked')rows=await pages(p,user,'me/likes/tracks?linked_partitioning=true&limit=50');else{const d=await request(p,user,`playlists/${id}`);rows=d.tracks||[];}for(const row of rows){const x=row.track||row;const full=x.title?x:await request(p,user,`tracks/${encodeURIComponent(x.urn||x.id)}`);tracks.push(SoundCloudMapper.mapTrack(full));}}
 await Promise.all(tracks.map(t=>trackCacheRepository.setCachedTrack(t)));res.json({data:{title:id==='liked'?'Любимые треки':'Плейлист',source:p,tracks,total:tracks.length}});
}));
