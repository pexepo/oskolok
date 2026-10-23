import type {AdminRequest} from './workspace.js';
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const KINDS:Record<string,string>={leak:'Слив',snippet:'Сниппет',demo:'Демо',other:'Другое'};
const STATUS:Record<string,string>={pending:'На проверке',approved:'Одобрено',rejected:'Отклонено'};
const urls:string[]=[];

/** «Анрелизы» moderation for the developer panel workspace: listen, approve/reject, edit, delete. */
export async function renderUnreleasedAdmin(body:HTMLElement,request:AdminRequest,action:(fn:()=>Promise<void>)=>Promise<void>,isDisposed:()=>boolean){
 while(urls.length)URL.revokeObjectURL(urls.pop()!);
 const call=(path:string,data:unknown,method='POST')=>request(path,{method,body:JSON.stringify(data)});
 const rows=await request('/unreleased?status=all');if(isDisposed())return;
 body.innerHTML=`<label>Фильтр <select><option value="pending">На проверке</option><option value="approved">Одобрено</option><option value="rejected">Отклонено</option><option value="all">Все</option></select></label><div class="admin-report-list"></div>`;
 const select=body.querySelector('select')!;
 const draw=()=>{
  const filter=select.value,list=rows.filter((r:any)=>filter==='all'||r.status===filter);
  body.querySelector('.admin-report-list')!.innerHTML=list.map((r:any)=>`<details class="frost-panel admin-report" data-row="${escape(r.id)}"><summary><strong>${escape(r.artistName)} — ${escape(r.title)}</strong> · ${escape(KINDS[r.kind]||r.kind)} · ${escape(STATUS[r.status]||r.status)}</summary>
   <p>${escape(r.author?.username?'@'+r.author.username:r.author?.name||r.userId)} · ${escape(new Date(r.createdAt).toLocaleString())} · ${escape(r.audio?.fileName||'')} (${r.audio?((r.audio.size||0)/1048576).toFixed(1)+' МБ':'файл не найден'})</p>
   <p>${escape(r.artistId||'без привязки к карточке')}${r.source?' · источник: '+escape(r.source):''}</p>${r.description?`<p>${escape(r.description)}</p>`:''}
   <div class="admin-unreleased-media"><button class="secondary-button" data-listen="${escape(r.id)}">Прослушать</button>${r.coverFileId?`<button class="secondary-button" data-cover="${escape(r.id)}">Показать обложку</button>`:''}</div>
   <form data-edit="${escape(r.id)}"><label>Название<input name="title" value="${escape(r.title)}" maxlength="200" required/></label><label>Артист<input name="artistName" value="${escape(r.artistName)}" maxlength="200" required/></label><label>ID артиста<input name="artistId" value="${escape(r.artistId||'')}" maxlength="200" placeholder="spotify:artist:…"/></label><label>Тип<select name="kind">${Object.entries(KINDS).map(([k,v])=>`<option value="${k}"${k===r.kind?' selected':''}>${v}</option>`).join('')}</select></label><label>Источник<input name="source" value="${escape(r.source)}" maxlength="500"/></label><label>Описание<textarea name="description" maxlength="4000">${escape(r.description)}</textarea></label><button class="secondary-button">Сохранить метаданные</button></form>
   <label>Комментарий для автора<textarea data-note="${escape(r.id)}" maxlength="1000">${escape(r.reviewNote)}</textarea></label>
   <div class="admin-unreleased-actions">${r.status!=='approved'?`<button class="primary-button" data-review="${escape(r.id)}" data-decision="approved">Одобрить</button>`:''}${r.status!=='rejected'?`<button class="secondary-button" data-review="${escape(r.id)}" data-decision="rejected">Отклонить</button>`:''}<button class="secondary-button" data-delete="${escape(r.id)}">Удалить</button></div></details>`).join('')||'<p>Заявок нет.</p>';
  const list$=body.querySelector('.admin-report-list')!;
  const media=async(id:string,kind:'audio'|'cover',button:HTMLButtonElement)=>{const blob=await request(`/unreleased/${encodeURIComponent(id)}/${kind}`,{headers:{Accept:'application/octet-stream'}});const url=URL.createObjectURL(blob instanceof Blob?blob:new Blob([blob]));urls.push(url);const el=document.createElement(kind==='audio'?'audio':'img') as HTMLAudioElement&HTMLImageElement;el.src=url;if(kind==='audio'){el.controls=true;el.autoplay=true;}else{el.alt='';el.width=160;}button.replaceWith(el);};
  list$.querySelectorAll<HTMLButtonElement>('[data-listen]').forEach(b=>b.onclick=()=>void action(()=>media(b.dataset.listen!,'audio',b)));
  list$.querySelectorAll<HTMLButtonElement>('[data-cover]').forEach(b=>b.onclick=()=>void action(()=>media(b.dataset.cover!,'cover',b)));
  list$.querySelectorAll<HTMLButtonElement>('[data-review]').forEach(b=>b.onclick=()=>void action(async()=>{await call(`/unreleased/${encodeURIComponent(b.dataset.review!)}/review`,{decision:b.dataset.decision,reviewNote:list$.querySelector<HTMLTextAreaElement>(`[data-note="${b.dataset.review}"]`)!.value});await renderUnreleasedAdmin(body,request,action,isDisposed);}));
  list$.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach(b=>b.onclick=()=>{if(!confirm('Удалить анрелиз вместе с файлами?'))return;void action(async()=>{await request(`/unreleased/${encodeURIComponent(b.dataset.delete!)}`,{method:'DELETE',body:'{}'});await renderUnreleasedAdmin(body,request,action,isDisposed);});});
  list$.querySelectorAll<HTMLFormElement>('form[data-edit]').forEach(f=>f.onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(new FormData(f)) as Record<string,string>;void action(async()=>{await call(`/unreleased/${encodeURIComponent(f.dataset.edit!)}/update`,{...v,artistId:v.artistId.trim()||null});await renderUnreleasedAdmin(body,request,action,isDisposed);});});
 };
 select.onchange=draw;draw();
}
