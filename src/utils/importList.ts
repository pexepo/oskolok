export interface ImportRow {artist:string;title:string}
/** CSV exports (including quoted commas/newlines), TSV or Artist — Title text. */
export function parseImportList(text:string):ImportRow[]{
  if(text.length>1000000)throw new Error('Максимум 1 МБ.');
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
  if(quoted)throw new Error('В CSV не закрыты кавычки.');
  if(value||row.length){row.push(value.trim());records.push(row);}
  const header=records[0]?.map(v=>v.replace(/^\uFEFF/,'').toLowerCase())||[];
  const artistIndex=header.findIndex(v=>['artist','artist name','artist name(s)','artists','исполнитель','артист'].includes(v));
  const titleIndex=header.findIndex(v=>['track','track name','title','name','название','трек'].includes(v));
  let result:ImportRow[];
  if(artistIndex>=0&&titleIndex>=0)result=records.slice(1).map(r=>({artist:r[artistIndex]||'',title:r[titleIndex]||''}));
  else result=text.split(/\r?\n/).filter(l=>l.trim()).map(l=>{const parts=l.split(/\s+[—–-]\s+/);return {artist:parts.shift()?.trim()||'',title:parts.join(' — ').trim()};});
  result=result.filter(r=>r.artist&&r.title);
  if(!result.length)throw new Error('Нужны колонки Artist / Track Name или строки «Исполнитель — Название».');
  if(result.length>500)throw new Error('Разделите список на части до 500 треков.');
  return [...new Map(result.map(r=>[`${r.artist.toLowerCase()}\0${r.title.toLowerCase()}`,r])).values()];
}
