import {describe,it,expect,vi,afterEach} from 'vitest';
const db=vi.hoisted(()=>({findUnique:vi.fn(async()=>null),upsert:vi.fn(async()=>({}))}));
vi.mock('../server/src/database/client.js',()=>({prisma:{artistEnrichment:db}}));
vi.mock('../server/src/config/env.js',()=>({env:{DEEPL_API_KEY:''}}));
import {translateLines} from '../server/src/services/TranslationService.js';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('translation reliability',()=>{
 it('preserves line slots and punctuation',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify([['Привет','en'],['Мир','en']]))));
  expect((await translateLines(['Hello','','...','World'],'ru')).translations).toEqual(['Привет','','...','Мир']);
 });
 it('does not cache or pretend success when both providers fail',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('down',{status:503})));
  await expect(translateLines(['Unavailable line'],'ru')).rejects.toThrow('временно недоступен');
  expect(db.upsert).not.toHaveBeenCalled();
 });
 it('uses the single-text fallback when batch shape is wrong',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response(JSON.stringify([[['Резервный перевод','Fallback line']],null,'en']))));
  expect((await translateLines(['Fallback line'],'ru')).translations).toEqual(['Резервный перевод']);
 });
});
