/** Клиентская копия server/src/services/telegramStatus.ts — для живого превью до сохранения. Держите их одинаковыми (tests/telegramStatus.test.ts сверяет). */
export const STATUS_FIXED='Слушает в @oskolokplayerbot - ';
/** Telegram обрезает длинные title аудио; лимит в UTF-16 — стилизованные буквы занимают по две единицы. */
export const STATUS_MAX=128;
export type StatusFont='plain'|'bold'|'italic'|'script'|'mono'|'double'|'smallcaps';
export type StatusStyle={id:string;label:[string,string];prefix:string;suffix:string;font:StatusFont};
export const STATUS_STYLES:readonly StatusStyle[]=[
  {id:'classic',label:['Классика','Classic'],prefix:'',suffix:'',font:'plain'},
  {id:'note',label:['Нота','Note'],prefix:'♫ ',suffix:'',font:'plain'},
  {id:'spark',label:['Искра','Spark'],prefix:'⟡ ',suffix:' ⟡',font:'plain'},
  {id:'kagi',label:['Кавычки','Quotes'],prefix:'『',suffix:'』',font:'plain'},
  {id:'arrow',label:['Стрелка','Arrow'],prefix:'▸ ',suffix:'',font:'plain'},
  {id:'stardust',label:['Звёздная пыль','Stardust'],prefix:'˚₊‧ ',suffix:' ‧₊˚',font:'plain'},
  {id:'star',label:['Звезда','Star'],prefix:'✦ ',suffix:' ✦',font:'plain'},
  {id:'corner',label:['Уголки','Corners'],prefix:'⌜',suffix:'⌟',font:'plain'},
  {id:'bold',label:['Жирный','Bold'],prefix:'',suffix:'',font:'bold'},
  {id:'italic',label:['Курсив','Italic'],prefix:'♪ ',suffix:'',font:'italic'},
  {id:'script',label:['Рукопись','Script'],prefix:'',suffix:' ♡',font:'script'},
  {id:'mono',label:['Моно','Mono'],prefix:'› ',suffix:'',font:'mono'},
  {id:'double',label:['Контур','Outline'],prefix:'◇ ',suffix:'',font:'double'},
  {id:'smallcaps',label:['Капитель','Small caps'],prefix:'⋆ ',suffix:' ⋆',font:'smallcaps'},
];
export const STATUS_DEFAULT='classic';
const SMALL='ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ';
const DOUBLE_HOLES:Record<string,string>={C:'ℂ',H:'ℍ',N:'ℕ',P:'ℙ',Q:'ℚ',R:'ℝ',Z:'ℤ'};
/** Базовые кодовые точки Mathematical Alphanumeric Symbols: [A, a, 0]. Кириллицы там нет — она остаётся как есть. */
const BASE:Record<string,[number,number,number|null]>={bold:[0x1d400,0x1d41a,0x1d7ce],italic:[0x1d608,0x1d622,null],script:[0x1d4d0,0x1d4ea,null],mono:[0x1d670,0x1d68a,0x1d7f6],double:[0x1d538,0x1d552,0x1d7d8]};
export function stylize(text:string,font:StatusFont){
  if(font==='plain')return text;
  if(font==='smallcaps')return text.replace(/[a-z]/g,c=>SMALL[c.charCodeAt(0)-97]);
  const [upper,lower,digit]=BASE[font];
  return text.replace(/[A-Za-z0-9]/g,c=>{
    const code=c.charCodeAt(0);
    if(code<58)return digit===null?c:String.fromCodePoint(digit+code-48);
    if(code<91)return font==='double'&&DOUBLE_HOLES[c]||String.fromCodePoint(upper+code-65);
    return String.fromCodePoint(lower+code-97);
  });
}
export const statusStyle=(id:string|null|undefined)=>STATUS_STYLES.find(s=>s.id===id)||STATUS_STYLES[0];
/** null — стиль по умолчанию; неизвестные значения (в том числе старые свободные шаблоны) отвергаются. */
export function validateStatusTemplate(raw:unknown):string|null{
  if(raw===null||raw===undefined||raw===''||raw===STATUS_DEFAULT)return null;
  if(typeof raw!=='string'||!STATUS_STYLES.some(s=>s.id===raw))throw new Error('Выберите один из готовых стилей подписи.');
  return raw;
}
/** Обрезает по кодовым точкам (не рвёт суррогатные пары) так, чтобы длина в UTF-16 с «…» уложилась в budget. */
export function truncateUtf16(text:string,budget:number){
  if(text.length<=budget)return text;
  if(budget<=0)return '';
  let out='';
  for(const ch of text){if(out.length+ch.length+1>budget)break;out+=ch;}
  return out.trimEnd()+'…';
}
type Source={title:string};
export function renderStatusTitle(template:string|null|undefined,track:Source,max=STATUS_MAX){
  const s=statusStyle(template),head=stylize(s.prefix+STATUS_FIXED,s.font);
  const title=stylize((track.title||'Осколок').replace(/\s+/g,' ').trim()||'Осколок',s.font);
  return head+truncateUtf16(title,max-head.length-s.suffix.length)+s.suffix;
}
