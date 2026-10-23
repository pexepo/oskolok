import {createHash} from 'node:crypto';
import {prisma} from '../database/client.js';
import {env} from '../config/env.js';
import {logger} from '../utils/logger.js';

/** Line-preserving machine translation for lyrics and annotations.
 * Google's dictionary endpoint (keyless, one `q` per line so the line count never drifts),
 * DeepL with shared context when configured; bounded Google fallback and complete-result caching. */
export const TRANSLATION_TARGETS=['ru','en','uk','be','kk','de','fr','es','it','pt','pl','tr','ja','ko','zh-CN'] as const;
export type TranslationTarget=typeof TRANSLATION_TARGETS[number];
export type TranslationResult={translations:string[];source:string;sameLanguage:boolean};

const MAX_ITEMS=400,MAX_CHARS=12000,BATCH_CHARS=3500,BATCH_ITEMS=50,TTL=30*24*3600*1000;
const memory=new Map<string,{at:number;value:TranslationResult}>();

const keyOf=(texts:string[],target:string)=>`tr:v2:${env.DEEPL_API_KEY?"deepl":"google"}:${target}:${createHash('sha1').update(texts.join('\u0001')).digest('hex')}`;

async function googleBatch(texts:string[],target:string):Promise<{text:string;lang:string}[]>{
 const response=await fetch(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(target)}`,{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8','user-agent':'Mozilla/5.0'},
  body:texts.map(text=>`q=${encodeURIComponent(text)}`).join('&'),signal:AbortSignal.timeout(12000),
 });
 if(!response.ok)throw new Error(`Google translate HTTP ${response.status}`);
 const json=await response.json() as unknown;
 const list:unknown[]=Array.isArray(json)?json:[];
 if(list.length!==texts.length)throw new Error('Google translate returned a different line count');
 // With auto-detection each item is [text, detectedLang].
 const result=list.map(item=>Array.isArray(item)?{text:item[0],lang:String(item[1]??'')}:{text:item,lang:''});
 if(result.some(row=>typeof row.text!=='string'||!row.text.trim()))throw new Error('Invalid Google translation');
 return result as {text:string;lang:string}[];
}

async function googleSingle(text:string,target:string):Promise<{text:string;lang:string}>{
 const response=await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`,{signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Translation unavailable');
 const json=await response.json() as any;
 const translated=Array.isArray(json?.[0])?json[0].map((part:any)=>typeof part?.[0]==='string'?part[0]:'').join(''):'';
 if(!translated)throw new Error('Empty translation');
 return {text:translated,lang:typeof json[2]==='string'?json[2]:''};
}
async function deepL(texts:string[],target:string,context:string):Promise<{text:string;lang:string}[]>{
 const host=env.DEEPL_API_KEY.endsWith(':fx')?'api-free.deepl.com':'api.deepl.com';
 const response=await fetch(`https://${host}/v2/translate`,{method:'POST',headers:{Authorization:`DeepL-Auth-Key ${env.DEEPL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({text:texts,target_lang:target==='zh-CN'?'ZH':target.toUpperCase(),context,preserve_formatting:true}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`DeepL HTTP ${response.status}`);
 const json=await response.json() as any;
 if(!Array.isArray(json.translations)||json.translations.length!==texts.length||json.translations.some((v:any)=>typeof v.text!=='string'||!v.text.trim()))throw new Error('Invalid DeepL translation');
 return json.translations.map((v:any)=>({text:v.text,lang:String(v.detected_source_language||'').toLowerCase()}));
}

/** Splits into request-sized batches without ever splitting a line. */
function batches(texts:string[]){
 const out:number[][]=[];let current:number[]=[],size=0;
 texts.forEach((text,index)=>{if(current.length&&(size+text.length>BATCH_CHARS||current.length>=BATCH_ITEMS)){out.push(current);current=[];size=0;}current.push(index);size+=text.length+8;});
 if(current.length)out.push(current);
 return out;
}

export class TranslationError extends Error{status=400;}

export async function translateLines(input:unknown,targetInput:unknown):Promise<TranslationResult>{
 const target=String(targetInput||'ru');
 if(!(TRANSLATION_TARGETS as readonly string[]).includes(target))throw new TranslationError('Этот язык перевода не поддерживается.');
 if(!Array.isArray(input)||input.length>MAX_ITEMS)throw new TranslationError(`Можно перевести до ${MAX_ITEMS} строк за раз.`);
 const texts=input.map(item=>String(item??'').replace(/\s+/g,' ').trim());
 if(texts.some(text=>text.length>MAX_CHARS))throw new TranslationError('Слишком длинный фрагмент для перевода.');
 const key=keyOf(texts,target),cached=memory.get(key);
 if(cached&&Date.now()-cached.at<TTL)return cached.value;
 const stored=await prisma.artistEnrichment.findUnique({where:{id:key}}).catch(()=>null);
 if(stored&&Date.now()-stored.updatedAt.getTime()<TTL){try{const value=JSON.parse(stored.data) as TranslationResult;memory.set(key,{at:Date.now(),value});return value;}catch{/* re-translate */}}

 const translations=texts.map(text=>/[\p{L}\p{N}]/u.test(text)?'':text),languages:string[]=[];
 const deadline=Date.now()+45000;
 // Empty lines and pure punctuation stay as they are.
 const work=texts.map((text,index)=>({text,index})).filter(item=>/[\p{L}\p{N}]/u.test(item.text));
 for(const batch of batches(work.map(item=>item.text))){
  const items=batch.map(i=>work[i]);
  try{
   if(Date.now()>deadline)throw new Error('Translation deadline');
   const inputs=items.map(item=>item.text);
   const result=env.DEEPL_API_KEY?await deepL(inputs,target,texts.join('\n').slice(0,6000)).catch(()=>googleBatch(inputs,target)):await googleBatch(inputs,target);
   result.forEach((row,i)=>{translations[items[i].index]=row.text;if(row.lang)languages.push(row.lang);});
  }catch(err){
   logger.warn({message:err instanceof Error?err.message:'Translation failed'},'Batch translation failed');
   let cursor=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(cursor<items.length&&Date.now()<deadline){const item=items[cursor++];try{const row=await googleSingle(item.text,target);translations[item.index]=row.text;if(row.lang)languages.push(row.lang);}catch{}}}));
  }
 }
 if(work.some(item=>!translations[item.index]))throw new Error('Перевод временно недоступен. Попробуйте ещё раз.');
 const counts=new Map<string,number>();for(const lang of languages)counts.set(lang,(counts.get(lang)||0)+1);
 const source=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'auto';
 const sameLanguage=source.split('-')[0]===target.split('-')[0];
 const value:TranslationResult={translations:translations.map((text,i)=>text||texts[i]),source,sameLanguage};
 // Only fully translated results are cached, so a transient outage never sticks.
 if(work.every(item=>translations[item.index])){
  memory.set(key,{at:Date.now(),value});
  if(memory.size>500)memory.delete(memory.keys().next().value!);
  await prisma.artistEnrichment.upsert({where:{id:key},create:{id:key,data:JSON.stringify(value)},update:{data:JSON.stringify(value)}}).catch(()=>{});
 }
 return value;
}
