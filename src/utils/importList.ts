import { tr } from '../stores/useLanguageStore.js';
export interface ImportRow {artist:string;title:string}
/** CSV exports (including quoted commas/newlines), TSV or Artist — Title text. */
export function parseImportList(text:string):ImportRow[]{
  if(text.length>8000000)throw new Error(tr('Максимум 8 МБ.', '8 MB max.'));
  const first=text.replace(/^\uFEFF/,'').split(/\r?\n/)[0];
  const delimiter=first.includes('\t')?'\t':first.includes(';')?';':',';
  const records:string[][]=[];let row:string[]=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(c===delimiter&&!quoted){row.push(value.trim());value='';}
    else if(c==='\n'&&!quoted){row.push(value.trim());records.push(row);row=[];value='';}
    else if(c!=='\r')value+=c;
  }
  if(quoted)throw new Error(tr('В CSV не закрыты кавычки.', 'Unclosed quotes in CSV.'));
  if(value||row.length){row.push(value.trim());records.push(row);}
  const header=records[0]?.map(v=>v.replace(/^\uFEFF/,'').toLowerCase())||[];
  const artistIndex=header.findIndex(v=>['artist','artist name','artist name(s)','artists','исполнитель','артист'].includes(v));
  const titleIndex=header.findIndex(v=>['track','track name','title','name','название','трек'].includes(v));
  let result:ImportRow[];
  if(artistIndex>=0&&titleIndex>=0)result=records.slice(1).map(r=>({artist:r[artistIndex]||'',title:r[titleIndex]||''}));
  else result=text.split(/\r?\n/).filter(l=>l.trim()).map(l=>{const parts=l.split(/\s+[—–-]\s+/);return {artist:parts.shift()?.trim()||'',title:parts.join(' — ').trim()};});
  result=result.filter(r=>r.artist&&r.title);
  if(!result.length)throw new Error(tr('Нужны колонки Artist / Track Name или строки «Исполнитель — Название».', 'Needs Artist / Track Name columns or “Artist — Title” lines.'));
  if(result.length>20000)throw new Error(tr('Разделите список на части до 20 000 треков.', 'Split the list into parts of up to 20,000 tracks.'));
  return [...new Map(result.map(r=>[`${r.artist.toLowerCase()}\0${r.title.toLowerCase()}`,r])).values()];
}
