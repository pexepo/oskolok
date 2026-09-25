import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

export async function prepareTelegramAudio(source:{path:string;extension:string},title:string,artist:string,cover?:string){
 const dir=await mkdtemp(path.join(tmpdir(),'oskolok-telegram-'));
 const output=path.join(dir,`track.${source.extension==='mp3'?'mp3':'m4a'}`);
 const args=['-nostdin','-hide_banner','-loglevel','error','-y','-i',source.path];
 if(cover)args.push('-i',cover);
 args.push('-map','0:a:0');
 if(cover)args.push('-map','1:v:0');
 args.push('-c:a','copy');
 if(cover)args.push('-c:v','mjpeg','-disposition:v','attached_pic');
 args.push('-metadata',`title=${title}`,'-metadata',`artist=${artist}`,output);
 const result=await new Promise<boolean>(resolve=>{
  const child=spawn(process.env.FFMPEG_PATH||'ffmpeg',args,{stdio:'ignore'});
  const timer=setTimeout(()=>{child.kill();resolve(false);},30000);
  child.on('error',()=>{clearTimeout(timer);resolve(false);});
  child.on('exit',code=>{clearTimeout(timer);resolve(code===0);});
 });
 if(!result){await rm(dir,{recursive:true,force:true});return {path:source.path,cleanup:async()=>{}};}
 return {path:output,cleanup:async()=>{await rm(dir,{recursive:true,force:true});}};
}
