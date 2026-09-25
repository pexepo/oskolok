import {describe,it,expect} from 'vitest';
import {Api} from 'teleproto';
import bigInt from 'big-integer';
describe('profile music MTProto request',()=>{
 it('encodes documented saveMusic flags and document reference without unsave',()=>{
   const document=new Api.InputDocument({id:bigInt(123),accessHash:bigInt(456),fileReference:Buffer.from('reference')});
   const request=new Api.account.SaveMusic({id:document}),bytes=request.getBytes();
   expect(bytes.readUInt32LE(0)).toBe(0xb26732a9);expect(bytes.readUInt32LE(4)).toBe(0);expect(bytes.subarray(8)).toEqual(document.getBytes());expect(request.classType).toBe('request');
 });
 it('encodes unsave for the same Telegram document',()=>{
   const document=new Api.InputDocument({id:bigInt(123),accessHash:bigInt(456),fileReference:Buffer.from('reference')});
   const bytes=new Api.account.SaveMusic({id:document,unsave:true}).getBytes();
   expect(bytes.readUInt32LE(0)).toBe(0xb26732a9);
   expect(bytes.readUInt32LE(4)).toBe(1);
   expect(bytes.subarray(8)).toEqual(document.getBytes());
 });
});
