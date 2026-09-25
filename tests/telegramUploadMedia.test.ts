import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import bigInt from 'big-integer';
import {Api} from 'teleproto';
import {uploadAudioDocument} from '../server/src/services/telegramSession.js';

describe('Telegram profile upload',()=>{
 it('creates a document without sending a Saved Messages entry',async()=>{
   const dir=await mkdtemp(path.join(tmpdir(),'oskolok-upload-test-'));
   const file=path.join(dir,'track.mp3');
   await writeFile(file,Buffer.from('audio'));
   try{
     const document=new Api.Document({id:bigInt(123),accessHash:bigInt(456),fileReference:Buffer.from('ref'),date:0,mimeType:'audio/mpeg',size:bigInt(5),dcId:1,attributes:[]});
     const client={uploadFile:vi.fn(async()=>new Api.InputFile({id:bigInt(1),parts:1,name:'track.mp3',md5Checksum:''})),invoke:vi.fn(async(request:unknown)=>{
       expect(request).toBeInstanceOf(Api.messages.UploadMedia);
       return new Api.MessageMediaDocument({document});
     }),sendFile:vi.fn()};
     const result=await uploadAudioDocument(client as any,file,'Title','Artist',180);
     expect(result.id).toBe('123');
     expect(client.uploadFile).toHaveBeenCalledTimes(1);
     expect(client.invoke).toHaveBeenCalledTimes(1);
     expect(client.sendFile).not.toHaveBeenCalled();
   }finally{await rm(dir,{recursive:true,force:true});}
 });
});
