import {z} from 'zod';

/** Profile customisation: social links, accent, theme, status, section visibility. Pure — no DB access. */
export const SOCIAL_PLATFORMS=['telegram','vk','instagram','youtube','tiktok','x','twitch','discord','github','soundcloud','spotify','yandexMusic','website'] as const;
export type SocialPlatform=typeof SOCIAL_PLATFORMS[number];
export type SocialLink={platform:SocialPlatform;url:string};
export const MAX_SOCIAL_LINKS=10;
export const PROFILE_THEMES=['default','gradient','solid','blur'] as const;
export type ProfileTheme=typeof PROFILE_THEMES[number];
export const VISIBILITY_KEYS=['nowPlaying','showcase','lyrics','stats'] as const;
export type ProfileVisibility=Record<typeof VISIBILITY_KEYS[number],boolean>;
export const DEFAULT_VISIBILITY:ProfileVisibility={nowPlaying:true,showcase:true,lyrics:true,stats:true};

// Order matters only for readability; hosts never overlap between platforms.
const HOSTS:Array<[SocialPlatform,string[]]>=[
 ['telegram',['t.me','telegram.me','telegram.dog']],['vk',['vk.com','vk.ru','vkontakte.ru']],['instagram',['instagram.com','instagr.am']],
 ['youtube',['youtube.com','youtu.be']],['tiktok',['tiktok.com']],['x',['x.com','twitter.com']],['twitch',['twitch.tv']],
 ['discord',['discord.com','discord.gg','discordapp.com']],['github',['github.com']],['soundcloud',['soundcloud.com']],
 ['spotify',['spotify.com','spotify.link']],['yandexMusic',['music.yandex.ru','music.yandex.com','music.yandex.by','music.yandex.kz']],
];

export class ProfileValidationError extends Error{status=400;}
const fail=(message:string):never=>{throw new ProfileValidationError(message);};
const CONTROL=/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g;
/** One-line text: strips control/bidi characters and collapses whitespace. */
export const cleanLine=(s:string)=>s.replace(CONTROL,'').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim();
/** Multi-line text (bio): keeps newlines, max two blank lines in a row. */
export const cleanMultiline=(s:string)=>s.replace(/\r\n?/g,'\n').replace(CONTROL,'').replace(/\n{3,}/g,'\n\n').trim();

export function detectPlatform(url:string):SocialPlatform{
 let host='';
 try{host=new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile)\./,'');}catch{return 'website';}
 for(const [platform,domains] of HOSTS)if(domains.some(d=>host===d||host.endsWith(`.${d}`)))return platform;
 return 'website';
}

const DISCORD_NAME=/^[a-z0-9_.]{2,32}$/;
/** Validates one link. Discord accepts a bare username; every other value must become an http(s) URL. */
export function normalizeSocialLink(input:{platform?:string|null;url:string}):SocialLink{
 let raw=cleanLine(String(input.url||''));
 if(!raw)fail('Ссылка пустая.');
 if(raw.length>300)fail('Ссылка длиннее 300 символов.');
 const declared=SOCIAL_PLATFORMS.includes(input.platform as SocialPlatform)?input.platform as SocialPlatform:undefined;
 if(declared==='discord'&&!/[/:]/.test(raw)){
  const name=raw.replace(/^@/,'').toLowerCase();
  if(!DISCORD_NAME.test(name))fail('Ник Discord: 2–32 символа, латиница, цифры, «_» и «.».');
  return {platform:'discord',url:name};
 }
 if(/^@[A-Za-z0-9_]{4,32}$/.test(raw)&&(!declared||declared==='telegram'))raw=`https://t.me/${raw.slice(1)}`;
 if(!/^[a-z][a-z0-9+.-]*:/i.test(raw)){
  if(/^[^\s/]+\.[^\s/]+/.test(raw))raw=`https://${raw.replace(/^\/+/,'')}`;
  else fail('Укажите ссылку, начинающуюся с https://');
 }
 let url:URL;
 try{url=new URL(raw);}catch{return fail('Ссылка указана неверно.');}
 if(url.protocol!=='https:'&&url.protocol!=='http:')fail('Разрешены только ссылки http:// и https://');
 if(url.username||url.password)fail('Ссылка не должна содержать логин или пароль.');
 const host=url.hostname.toLowerCase();
 if(!host.includes('.')||host.endsWith('.')||/^[\d.]+$/.test(host)||host.startsWith('[')||/(^|\.)(localhost|local|internal)$/.test(host))fail('Укажите публичный адрес сайта.');
 const href=url.toString();
 if(href.length>300)fail('Ссылка длиннее 300 символов.');
 return {platform:detectPlatform(href),url:href};
}

export function normalizeSocialLinks(list:Array<{platform?:string|null;url:string}>):SocialLink[]{
 if(list.length>MAX_SOCIAL_LINKS)fail(`Не больше ${MAX_SOCIAL_LINKS} ссылок.`);
 const out:SocialLink[]=[],seen=new Set<string>();
 for(const item of list){const link=normalizeSocialLink(item),key=`${link.platform}:${link.url.toLowerCase()}`;if(!seen.has(key)){seen.add(key);out.push(link);}}
 return out;
}

const isEmoji=(s:string)=>!s||(/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(s)&&!/[\p{L}\s<>]/u.test(s)&&[...s].length<=10);
export const HEX_COLOR=/^#[0-9a-f]{6}$/i;

export const profileCustomizationSchema=z.object({
 accentColor:z.string().trim().regex(HEX_COLOR,'Цвет указывается в формате #RRGGBB.').transform(s=>s.toLowerCase()).nullable().optional(),
 theme:z.enum(PROFILE_THEMES).optional(),
 pronouns:z.string().max(200).transform(cleanLine).pipe(z.string().max(40,'Местоимения — до 40 символов.')).optional(),
 location:z.string().max(400).transform(cleanLine).pipe(z.string().max(80,'Город — до 80 символов.')).optional(),
 statusEmoji:z.string().max(64).transform(cleanLine).refine(isEmoji,'Статус: можно выбрать только эмодзи.').optional(),
 statusText:z.string().max(400).transform(cleanLine).pipe(z.string().max(80,'Статус — до 80 символов.')).optional(),
 socialLinks:z.array(z.object({platform:z.string().max(20).nullable().optional(),url:z.string().max(400)})).max(MAX_SOCIAL_LINKS,`Не больше ${MAX_SOCIAL_LINKS} ссылок.`).optional(),
 visibility:z.object(Object.fromEntries(VISIBILITY_KEYS.map(k=>[k,z.boolean().optional()])) as Record<typeof VISIBILITY_KEYS[number],z.ZodOptional<z.ZodBoolean>>).strict().optional(),
});
export type ProfileCustomizationInput=z.infer<typeof profileCustomizationSchema>;

/** Converts validated input to CreatorProfile columns (only fields that were sent). */
export function customizationColumns(input:ProfileCustomizationInput,currentVisibility?:string|null){
 const data:Record<string,string|null>={};
 if(input.accentColor!==undefined)data.accentColor=input.accentColor;
 if(input.theme!==undefined)data.profileTheme=input.theme;
 for(const key of ['pronouns','location','statusEmoji','statusText'] as const)if(input[key]!==undefined)data[key]=input[key]!;
 if(input.socialLinks!==undefined)data.socialLinks=JSON.stringify(normalizeSocialLinks(input.socialLinks));
 if(input.visibility!==undefined)data.profileVisibility=JSON.stringify({...parseVisibility(currentVisibility),...input.visibility});
 return data;
}

export function parseVisibility(raw?:string|null):ProfileVisibility{
 let value:any={};try{value=JSON.parse(raw||'{}');}catch{/* corrupted column: defaults */}
 return Object.fromEntries(VISIBILITY_KEYS.map(k=>[k,typeof value?.[k]==='boolean'?value[k]:DEFAULT_VISIBILITY[k]])) as ProfileVisibility;
}
/** Stored links are re-validated on read so a corrupted or legacy row never reaches the client. */
export function parseSocialLinks(raw?:string|null):SocialLink[]{
 let list:unknown=[];try{list=JSON.parse(raw||'[]');}catch{return [];}
 if(!Array.isArray(list))return [];
 return list.slice(0,MAX_SOCIAL_LINKS).flatMap(item=>{try{return [normalizeSocialLink(item as SocialLink)];}catch{return [];}});
}

type CustomRow={accentColor?:string|null;profileTheme?:string|null;pronouns?:string|null;location?:string|null;statusEmoji?:string|null;statusText?:string|null;socialLinks?:string|null;profileVisibility?:string|null}|null|undefined;
export function readCustomization(profile:CustomRow){
 return {
  accentColor:profile?.accentColor&&HEX_COLOR.test(profile.accentColor)?profile.accentColor:null,
  theme:(PROFILE_THEMES as readonly string[]).includes(profile?.profileTheme||'')?profile!.profileTheme as ProfileTheme:'default' as ProfileTheme,
  pronouns:profile?.pronouns||'',
  location:profile?.location||'',
  status:{emoji:profile?.statusEmoji||'',text:profile?.statusText||''},
  socialLinks:parseSocialLinks(profile?.socialLinks),
  visibility:parseVisibility(profile?.profileVisibility),
 };
}
