/* Rewards catalogue: tiered achievements (automatic) and medals (prestigious, manual or rule-based).
   Pure data + pure maths only — no database — so it can be unit-tested and shared with the UI via the API. */

export type Tier='bronze'|'silver'|'gold';
export const TIERS:Tier[]=['bronze','silver','gold'];
export type Text={ru:string;en:string};
/** Everything an achievement can be measured by; computed once per evaluation. */
export type RewardStats={
 collection:number;listeningMinutes:number;bestStreak:number;currentStreak:number;distinctArtists:number;lyrics:number;likes:number;
 nightPlays:number;sources:number;playlists:number;reports:number;plays:number;daysSinceJoin:number;topTrackPlays:number;
 validReports:number;acceptedTimings:number;joinRank:number;
};
export type AchievementDef={id:string;title:Text;description:Text;icon:string;metric:keyof RewardStats;unit:Text;thresholds:number[]};
export type MedalDef={id:string;title:Text;description:Text;icon:string;color:string;auto?:{metric:keyof RewardStats;atLeast?:number;atMost?:number;hint:Text}};

/* Thresholds are ascending; index 0 = bronze, 1 = silver, 2 = gold. One-step achievements use bronze only. */
export const ACHIEVEMENTS:AchievementDef[]=[
 {id:'collection',title:{ru:'Коллекционер',en:'Collector'},description:{ru:'Треки в коллекции: любимые и плейлисты',en:'Tracks in your collection: liked and playlists'},icon:'library',metric:'collection',unit:{ru:'треков',en:'tracks'},thresholds:[100,1000,5000]},
 {id:'minutes',title:{ru:'Меломан',en:'Music lover'},description:{ru:'Минуты, проведённые с музыкой в Осколке',en:'Minutes spent listening in Oskolok'},icon:'headphones',metric:'listeningMinutes',unit:{ru:'минут',en:'minutes'},thresholds:[60,600,6000]},
 {id:'plays',title:{ru:'На повторе',en:'On repeat'},description:{ru:'Всего прослушиваний',en:'Total plays'},icon:'play',metric:'plays',unit:{ru:'прослушиваний',en:'plays'},thresholds:[100,1000,10000]},
 {id:'streak',title:{ru:'Постоянство',en:'Consistency'},description:{ru:'Дней подряд с музыкой (лучшая серия)',en:'Days in a row with music (best streak)'},icon:'flame',metric:'bestStreak',unit:{ru:'дней подряд',en:'days in a row'},thresholds:[3,7,30]},
 {id:'artists',title:{ru:'Широкий кругозор',en:'Open ears'},description:{ru:'Разных артистов прослушано',en:'Different artists listened to'},icon:'users',metric:'distinctArtists',unit:{ru:'артистов',en:'artists'},thresholds:[25,100,500]},
 {id:'devotion',title:{ru:'Заслушал до дыр',en:'Worn out'},description:{ru:'Прослушиваний одного трека',en:'Plays of a single track'},icon:'repeat',metric:'topTrackPlays',unit:{ru:'раз',en:'times'},thresholds:[10,50,200]},
 {id:'night_owl',title:{ru:'Сова',en:'Night owl'},description:{ru:'Прослушивания с полуночи до пяти утра (МСК)',en:'Plays between midnight and 5 am (Moscow time)'},icon:'moon',metric:'nightPlays',unit:{ru:'ночных треков',en:'night plays'},thresholds:[10,100,500]},
 {id:'explorer',title:{ru:'Исследователь',en:'Explorer'},description:{ru:'Разные источники музыки: Spotify, SoundCloud, YouTube…',en:'Different music sources: Spotify, SoundCloud, YouTube…'},icon:'compass',metric:'sources',unit:{ru:'источников',en:'sources'},thresholds:[2,4,6]},
 {id:'first_like',title:{ru:'Первая любовь',en:'First love'},description:{ru:'Поставьте первый лайк',en:'Like your first track'},icon:'heart',metric:'likes',unit:{ru:'лайк',en:'like'},thresholds:[1]},
 {id:'curator',title:{ru:'Куратор',en:'Curator'},description:{ru:'Созданные плейлисты',en:'Playlists created'},icon:'list-music',metric:'playlists',unit:{ru:'плейлистов',en:'playlists'},thresholds:[1,10,25]},
 {id:'lyricist',title:{ru:'Автор текстов',en:'Lyricist'},description:{ru:'Опубликованные тексты и синхронизации',en:'Published lyrics and syncs'},icon:'pen-line',metric:'lyrics',unit:{ru:'текстов',en:'lyrics'},thresholds:[1,10,50]},
 {id:'reporter',title:{ru:'Внимательный',en:'Sharp-eyed'},description:{ru:'Отправленные обращения о проблемах',en:'Problem reports filed'},icon:'flag',metric:'reports',unit:{ru:'обращений',en:'reports'},thresholds:[1,5,20]},
 {id:'veteran',title:{ru:'Старожил',en:'Old-timer'},description:{ru:'Дней с момента регистрации',en:'Days since joining'},icon:'calendar-heart',metric:'daysSinceJoin',unit:{ru:'дней',en:'days'},thresholds:[30,180,365]},
];

/* Medals: rarer, shown next to the name. `auto` medals are granted by a rule; all medals can be awarded or revoked by hand. */
export const MEDALS:MedalDef[]=[
 {id:'community',title:{ru:'Вклад в сообщество',en:'Community contributor'},description:{ru:'Опубликовал не меньше 10 текстов или синхронизаций',en:'Published at least 10 lyrics or syncs'},icon:'hand-heart',color:'#3ddc97',auto:{metric:'lyrics',atLeast:10,hint:{ru:'10 опубликованных текстов',en:'10 published lyrics'}}},
 {id:'bug_hunter',title:{ru:'Охотник за багами',en:'Bug hunter'},description:{ru:'Обращения, признанные разработчиком',en:'Reports confirmed by the developer'},icon:'bug',color:'#ff8a3d',auto:{metric:'validReports',atLeast:3,hint:{ru:'3 подтверждённых обращения',en:'3 confirmed reports'}}},
 {id:'timekeeper',title:{ru:'Хранитель ритма',en:'Timekeeper'},description:{ru:'Поправил тайминги текстов для всех',en:'Fixed lyric timings for everyone'},icon:'timer',color:'#2bc4c4',auto:{metric:'acceptedTimings',atLeast:5,hint:{ru:'5 принятых правок тайминга',en:'5 accepted timing fixes'}}},
 {id:'first_100',title:{ru:'Первые 100',en:'First 100'},description:{ru:'Один из первых ста слушателей Осколка',en:'One of the first hundred Oskolok listeners'},icon:'medal',color:'#ffb547',auto:{metric:'joinRank',atMost:100,hint:{ru:'среди первых 100 аккаунтов',en:'among the first 100 accounts'}}},
 {id:'near_dev',title:{ru:'Около-разработчик',en:'Almost a developer'},description:{ru:'Помогает разработке: идеи, разборы, тесты',en:'Helps development: ideas, triage, testing'},icon:'wrench',color:'#7c9cff'},
 {id:'voice',title:{ru:'Голос сообщества',en:'Voice of the community'},description:{ru:'Его идеи и отзывы двигают Осколок вперёд',en:'Their ideas and feedback move Oskolok forward'},icon:'megaphone',color:'#b07cff'},
 {id:'patron',title:{ru:'Меценат',en:'Patron'},description:{ru:'Поддержал Осколок',en:'Supported Oskolok'},icon:'gem',color:'#ff7ce0'},
 {id:'legend',title:{ru:'Легенда',en:'Legend'},description:{ru:'Особый вклад, который не описать одной строкой',en:'A contribution too big for one line'},icon:'crown',color:'#ff5c7a'},
];

export const achievementById=new Map(ACHIEVEMENTS.map(a=>[a.id,a]));
export const medalById=new Map(MEDALS.map(m=>[m.id,m]));

/** Number of tiers reached for a value (0 = locked). */
export function tierIndex(thresholds:number[],value:number){
 let reached=0;
 for(const t of thresholds)if(Number.isFinite(value)&&value>=t)reached++;else break;
 return reached;
}
/** Tier name for a 1-based tier count: one-step achievements are always gold (they are complete). */
export const tierName=(thresholds:number[],reached:number):Tier|null=>reached<=0?null:thresholds.length===1?'gold':TIERS[Math.min(reached,TIERS.length)-1];

export type AchievementProgress={id:string;title:Text;description:Text;icon:string;unit:Text;value:number;tier:Tier|null;tiersReached:number;tiers:Array<{tier:Tier;threshold:number;reached:boolean}>;next:number|null;progress:number;maxed:boolean};
/** Progress towards the next tier as 0..1; previous threshold is the floor so bars restart at each tier. */
export function achievementProgress(def:AchievementDef,value:number):AchievementProgress{
 const v=Math.max(0,Math.floor(Number(value)||0)),reached=tierIndex(def.thresholds,v),maxed=reached>=def.thresholds.length;
 const next=maxed?null:def.thresholds[reached],floor=reached?def.thresholds[reached-1]:0;
 const progress=maxed?1:Math.max(0,Math.min(1,(v-floor)/Math.max(1,next!-floor)));
 return {id:def.id,title:def.title,description:def.description,icon:def.icon,unit:def.unit,value:v,tier:tierName(def.thresholds,reached),tiersReached:reached,
  tiers:def.thresholds.map((threshold,i)=>({tier:def.thresholds.length===1?'gold':TIERS[i],threshold,reached:i<reached})),next,progress:Math.round(progress*1000)/1000,maxed};
}
export const evaluateAchievements=(stats:RewardStats)=>ACHIEVEMENTS.map(def=>achievementProgress(def,stats[def.metric]));

/** Whether a rule-based medal's condition holds. Manual medals never qualify automatically. */
export function medalQualifies(def:MedalDef,stats:RewardStats){
 if(!def.auto)return false;
 const v=Number(stats[def.auto.metric]);
 if(!Number.isFinite(v))return false;
 if(def.auto.atLeast!=null&&v<def.auto.atLeast)return false;
 if(def.auto.atMost!=null&&(v<=0||v>def.auto.atMost))return false;
 return true;
}

const DAY=864e5;
/** Day key in a fixed UTC offset (minutes), so "a day" matches the listener's calendar rather than UTC. */
export const dayKey=(t:number,offsetMin=180)=>Math.floor((t+offsetMin*6e4)/DAY);
/** Best and current run of consecutive calendar days with at least one play. */
export function streaks(times:number[],now=Date.now(),offsetMin=180){
 const days=[...new Set(times.map(t=>dayKey(t,offsetMin)))].sort((a,b)=>a-b);
 let best=0,run=0,prev=Number.NaN;
 for(const d of days){run=d===prev+1?run+1:1;best=Math.max(best,run);prev=d;}
 const today=dayKey(now,offsetMin),last=days[days.length-1];
 return {best,current:last===today||last===today-1?run:0};
}
/** Hour 0..23 in the fixed offset (Moscow by default). */
export const localHour=(t:number,offsetMin=180)=>new Date(t+offsetMin*6e4).getUTCHours();
/** First artist name of a credit line, normalised for distinct counting. */
export const primaryArtist=(name:string)=>name.split(/,|&| feat\.? | ft\.? |\sx\s/i)[0].trim().toLocaleLowerCase();
const SOURCE_PREFIXES=['spotify','deezer','soundcloud','youtube','licensed','personal','yandex','tidal','vk','apple'];
/** Playback source from a track id prefix (licensed counts as YouTube). */
export const trackSource=(trackId:string)=>{const p=trackId.split(':')[0];return SOURCE_PREFIXES.includes(p)?(p==='licensed'?'youtube':p):'other';};

export class RewardValidationError extends Error{status=400;}
/** Validates an admin award: known medal, note within limits (trimmed, single-line-ish). */
export function validateMedalAward(input:{medalId?:unknown;note?:unknown}){
 const medalId=typeof input.medalId==='string'?input.medalId.trim():'';
 if(!medalId||!medalById.has(medalId))throw new RewardValidationError('Неизвестная медаль.');
 if(input.note!=null&&typeof input.note!=='string')throw new RewardValidationError('Комментарий должен быть строкой.');
 const note=String(input.note??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim();
 if([...note].length>200)throw new RewardValidationError('Комментарий — до 200 символов.');
 return {medalId,note};
}
