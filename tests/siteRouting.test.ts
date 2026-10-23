import {describe,expect,it} from 'vitest';
import {redirectTarget,isSitePath} from '../src/routing.js';
import {normalizeUsername,validate} from '../src/site/pages/BetaPage.js';
import {normalizeTelegramUsername} from '../server/src/services/betaApplications.js';
// @ts-expect-error plain ESM build script
import {renderRoute,ROUTES} from '../scripts/sitePages.mjs';

const env=(over:Partial<Parameters<typeof redirectTarget>[3]>={})=>({userAgent:'Mozilla/5.0',search:'',hash:'',standalone:false,electron:false,telegram:false,reload:false,appSeen:false,siteSeenThisTab:false,...over});

describe('site / player routing',()=>{
 it('keeps public pages on the site and the player under /app',()=>{
  for(const p of ['/','/beta','/beta/status','/download','/download/ios','/privacy'])expect(redirectTarget(p,'','',env())).toBeNull();
  expect(redirectTarget('/app','','',env())).toBeNull();
  expect(redirectTarget('/app/search','?q=x','',env())).toBeNull();
  expect(isSitePath('/download/ios/')).toBe(true);
 });
 it('moves old player links to /app with query and hash',()=>{
  expect(redirectTarget('/search','?q=kino','',env())).toBe('/app/search?q=kino');
  expect(redirectTarget('/users/telegram:1','','#top',env())).toBe('/app/users/telegram:1#top');
  expect(redirectTarget('/track/abc','','',env())).toBe('/app/track/abc');
  expect(redirectTarget('/beta/','','',env())).toBe('/beta');
 });
 it('opens the player at «/» inside native shells, Telegram and installed apps',()=>{
  expect(redirectTarget('/','','',env({userAgent:'Mozilla/5.0 OskolokAndroid/1.2.0'}))).toBe('/app');
  expect(redirectTarget('/','','',env({userAgent:'Mozilla/5.0 OskolokIOS/1.0.0'}))).toBe('/app');
  expect(redirectTarget('/','','',env({electron:true}))).toBe('/app');
  expect(redirectTarget('/','','#tgWebAppData=abc',env({hash:'#tgWebAppData=abc'}))).toBe('/app#tgWebAppData=abc');
  expect(redirectTarget('/','','',env({standalone:true}))).toBe('/app');
 });
 it('returns an old player tab to /app after its update reload, but not a landing tab',()=>{
  expect(redirectTarget('/','','',env({reload:true,appSeen:true}))).toBe('/app');
  expect(redirectTarget('/','','',env({reload:true,appSeen:true,siteSeenThisTab:true}))).toBeNull();
  expect(redirectTarget('/','','',env({appSeen:true}))).toBeNull();
 });
});

describe('beta form validation in the browser matches the server',()=>{
 it.each(['@Durov_Team','https://t.me/durov_team','  durov_team ','t.me/Durov_Team?x=1','__bad','ab','1abcde','abcde_','ab__cd','<script>'])('normalises %s the same way',value=>{
  expect(normalizeUsername(value)).toBe(normalizeTelegramUsername(value));
 });
 it('reports every missing field',()=>{
  expect(Object.keys(validate({telegramUsername:'',purpose:'',about:'коротко',platforms:[],consent:false,website:''}))).toEqual(['telegramUsername','purpose','about','consent']);
  expect(validate({telegramUsername:'@listener',purpose:'Хочу помочь найти баги',about:'Слушаю электронику каждый день',platforms:['ios'],consent:true,website:''})).toEqual({});
 });
});

describe('static HTML for public pages',()=>{
 const template='<title>x</title><meta name="description" content="d"><link rel="canonical" href="c"><meta name="robots" content="index, follow"><meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:url" content="u"><h1 style="a">x</h1><p style="b">y</p>';
 it('writes per-route title, canonical URL and Open Graph, and keeps private pages out of search',()=>{
  const ios=renderRoute(template,ROUTES.find((r:any)=>r.path==='/download/ios'));
  expect(ios).toContain('<title>Как установить Осколок на iPhone');
  expect(ios).toContain('href="https://oskolok.lol/download/ios"');
  expect(ios).toContain('property="og:url" content="https://oskolok.lol/download/ios"');
  expect(ios).toContain('<h1 style="a">Осколок на iPhone</h1>');
  expect(renderRoute(template,ROUTES.find((r:any)=>r.path==='/beta/status'))).toContain('noindex, nofollow');
 });
});
