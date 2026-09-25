import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPanelServer} from './server.mjs';
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r(`http://127.0.0.1:${server.address().port}`)));
test('panel keeps upstream credentials on the server, checks sessions and origins',async()=>{
 let received;
 const upstream=http.createServer((req,res)=>{received=req.headers.authorization;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[]}));});
 const api=await listen(upstream);
 const key='test-key-'.repeat(5),password='test-panel-password';
 const panel=createPanelServer({PANEL_PASSWORD:password,ADMIN_API_KEY:key,OSKOLOK_API_URL:api, PANEL_ORIGIN:'http://panel.test'});
 const base=await listen(panel);
 try{
  assert.equal((await fetch(base+'/api/submissions')).status,401);
  assert.equal((await fetch(base+'/session',{method:'POST',headers:{Origin:'https://bad.test','Content-Type':'application/json'},body:JSON.stringify({password})})).status,403);
  const auth=await fetch(base+'/session',{method:'POST',headers:{Origin:'http://panel.test','Content-Type':'application/json'},body:JSON.stringify({password})});
  assert.equal(auth.status,200);const cookie=auth.headers.get('set-cookie').split(';')[0];
  const response=await fetch(base+'/api/submissions',{headers:{Cookie:cookie}});
  assert.equal(response.status,200);assert.equal(received,`Bearer ${key}`);
  assert.ok(!(await response.text()).includes(key));
  assert.equal((await fetch(base+'/api/../../profile',{headers:{Cookie:cookie}})).status,404);
  const staticResponse=await fetch(base+'/');assert.equal(staticResponse.status,200);
  assert.ok((await staticResponse.text()).includes('Осколок'));
  await fetch(base+'/session',{method:'DELETE',headers:{Cookie:cookie,Origin:'http://panel.test','Content-Type':'application/json'},body:'{}'});
  assert.equal((await fetch(base+'/api/submissions',{headers:{Cookie:cookie}})).status,401);
 }finally{await Promise.all([new Promise(r=>panel.close(r)),new Promise(r=>upstream.close(r))]);}
});
