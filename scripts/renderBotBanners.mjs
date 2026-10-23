import {access,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Render the editable HTML with the project's fonts/art; no production browser dependency.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidates=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);
let chrome;
for(const file of candidates)try{await access(file);chrome=file;break;}catch{}
if(!chrome)throw new Error('Chrome/Chromium required. Set CHROME_PATH to the browser executable.');
const asset=async(file,mime)=>`data:${mime};base64,${(await readFile(path.join(root,file))).toString('base64')}`;
const [template,logo,mascot,wip,crystal,serif,sans,serifLatin,sansLatin]=await Promise.all([
  readFile(path.join(root,'server/assets/bot/src/cabinet-banner.html'),'utf8'),
  asset('public/logo.png','image/png'),asset('src/assets/oskolok-mascot.webp','image/webp'),
  asset('src/assets/oskolok-wip.webp','image/webp'),asset('public/art/crystal-refraction.png','image/png'),
  asset('public/fonts/cormorant-cyr-500.woff2','font/woff2'),asset('public/fonts/onest-cyr.woff2','font/woff2'),
  asset('public/fonts/cormorant-lat-500.woff2','font/woff2'),asset('public/fonts/onest-lat.woff2','font/woff2'),
]);
const check='<svg viewBox="0 0 32 32"><path d="m8 16 5 5 11-12"/></svg>';
const banners=[
  {file:'profile',kind:'profile',accent:'#c2b0ff',glow:'#59509c77',tag:'ЛИЧНЫЙ КАБИНЕТ',title:'Ваш профиль',description:'Ваш аккаунт и статус доступа.<br>Всё об участии в бете — здесь.',chips:['Аккаунт','Бета-доступ'],visual:`<div class="halo"></div><img src="${mascot}"><div class="badge">Ваш уголок музыки</div>`},
  {file:'downloads',kind:'downloads',accent:'#8fc4ff',glow:'#2f65ac77',tag:'ПРИЛОЖЕНИЯ',title:'Музыка с вами',description:'На компьютере и в телефоне.<br>Выберите Осколок для своего устройства.',chips:['Windows','macOS','Android'],visual:`<div class="halo"></div><div class="laptop"><img src="${logo}"></div><div class="phone"><img src="${logo}"></div>`},
  {file:'info',kind:'info',accent:'#9dcfff',glow:'#3a6b9f66',tag:'О ПРОЕКТЕ',title:'Ваши грани',description:'Музыка, коллекция, тексты.<br>Соберите свой Осколок.',chips:['Открывайте','Слушайте','Делитесь'],visual:`<img src="${crystal}">`},
  {file:'beta-pending',kind:'pending',accent:'#f2ca8e',glow:'#87623d66',tag:'ЗАКРЫТАЯ БЕТА',title:'Скоро увидимся',description:'Оставьте заявку на участие.<br>Об одобрении сообщим в этом чате.',chips:['Заявка','Приглашение','Музыка'],visual:`<img src="${wip}">`},
  {file:'beta-approved',kind:'approved',accent:'#8de4c3',glow:'#287f7866',tag:'ДОСТУП ОТКРЫТ',title:'Вы в бете!',description:'Ваша заявка одобрена.<br>Добро пожаловать в Осколок.',chips:['Слушайте','Пробуйте','Делитесь отзывами'],visual:`<div class="halo"></div><img src="${mascot}"><div class="badge">${check}Одобрено</div>`},
];
const temporary=await mkdtemp(path.join(tmpdir(),'oskolok-banners-'));
try{
  for(const banner of banners){
    const replacements={FONT_SERIF:serif,FONT_SANS:sans,FONT_SERIF_LATIN:serifLatin,FONT_SANS_LATIN:sansLatin,LOGO:logo,ACCENT:banner.accent,GLOW:banner.glow,TAG:banner.tag,TITLE:banner.title,DESCRIPTION:banner.description,CHIPS:banner.chips.map(c=>`<b>${c}</b>`).join(''),KIND:banner.kind,VISUAL:banner.visual};
    const html=template.replace(/FONT_SERIF_LATIN|FONT_SANS_LATIN|FONT_SERIF|FONT_SANS|LOGO|ACCENT|GLOW|TAG|TITLE|DESCRIPTION|CHIPS|KIND|VISUAL/g,key=>replacements[key]);
    const input=path.join(temporary,`${banner.file}.html`),output=path.join(root,`server/assets/bot/${banner.file}.png`);
    await writeFile(input,html);
    await promisify(execFile)(chrome,['--headless=new','--disable-gpu','--hide-scrollbars','--no-sandbox','--force-device-scale-factor=1',`--user-data-dir=${path.join(temporary,'chrome')}`,'--window-size=1280,640','--virtual-time-budget=1500',`--screenshot=${output}`,pathToFileURL(input).href],{timeout:30000,maxBuffer:1024*1024});
    console.log(path.relative(root,output));
  }
}finally{await rm(temporary,{recursive:true,force:true});}
