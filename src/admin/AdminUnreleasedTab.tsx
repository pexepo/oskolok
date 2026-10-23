import React from 'react';
import {renderUnreleasedAdmin} from './unreleasedWorkspace.js';
import '../styles/community.css';

/** In-app admin tab reusing the developer-panel «Анрелизы» moderation view. */
export function AdminUnreleasedTab({request}:{request:(path:string,options?:RequestInit)=>Promise<any>}){
 const root=React.useRef<HTMLDivElement>(null),status=React.useRef<HTMLParagraphElement>(null);
 React.useEffect(()=>{
  let disposed=false,busy=false;const body=root.current;if(!body)return;
  const action=async(fn:()=>Promise<void>)=>{if(busy)return;busy=true;if(status.current)status.current.textContent='';try{await fn();}catch(e){if(status.current)status.current.textContent=(e as Error).message;}finally{busy=false;}};
  void action(()=>renderUnreleasedAdmin(body,request,action,()=>disposed));
  return()=>{disposed=true;body.innerHTML='';};
 },[request]);
 return <section className="adm-unreleased"><p role="status" ref={status} className="adm-notice"/><div ref={root}/></section>;
}
