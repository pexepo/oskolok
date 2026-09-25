import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { validateTelegramInitData } from '../server/src/services/telegramAuth.js';
const token = 'test-only-token', now = 1800000000;
function sign(fields: Record<string,string>) {
 const data = new URLSearchParams(fields);
 const secret = createHmac('sha256','WebAppData').update(token).digest();
 const check = [...data.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 data.set('hash', createHmac('sha256',secret).update(check).digest('hex'));
 return data.toString();
}
const fields = { auth_date:String(now), query_id:'query', user:JSON.stringify({id:42,first_name:'Тест',photo_url:'https://example.com/photo.jpg'}) };
describe('Telegram signed identity',()=>{
 it('accepts a signed user including Unicode fields',()=>{expect(validateTelegramInitData(sign(fields),token,now).id).toBe(42);});
 it('rejects tampering and the wrong bot',()=>{
  expect(()=>validateTelegramInitData(sign(fields).replace('query_id=query','query_id=changed'),token,now)).toThrow();
  expect(()=>validateTelegramInitData(sign(fields),'other-token',now)).toThrow();
 });
 it('rejects expired and future sessions',()=>{
  expect(()=>validateTelegramInitData(sign(fields),token,now+86401)).toThrow();
  expect(()=>validateTelegramInitData(sign(fields),token,now-31)).toThrow();
 });
 it('rejects duplicates, missing signatures and malformed users',()=>{
  expect(()=>validateTelegramInitData(sign(fields)+'&user=other',token,now)).toThrow();
  expect(()=>validateTelegramInitData('auth_date=1',token,now)).toThrow();
  expect(()=>validateTelegramInitData(sign({...fields,user:JSON.stringify({id:-1,first_name:'x'})}),token,now)).toThrow();
 });
});
