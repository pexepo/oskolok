export function isNewBuild(value:unknown,current:string):boolean {
  if(!value||typeof value!=='object'||!('buildId' in value))return false;
  const id=(value as {buildId:unknown}).buildId;
  return typeof id==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(id)&&Number.isFinite(Date.parse(id))&&Date.parse(id)>Date.parse(current);
}
/** Never reload while music plays, a modal is open, or a user is editing a field. */
export function canApplyUpdate(playing:boolean,dirty:boolean,dialog:boolean):boolean{return !playing&&!dirty&&!dialog;}
