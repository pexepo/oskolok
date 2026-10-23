import {Msg,sendBanner,editBanner,editText,answerCallback,EMOJI,type BannerKind,type Markup} from './telegramBotApi.js';
export const cabinetLinks={site:'https://oskolok.lol/',tiktok:'https://www.tiktok.com/@oskoloktt',channel:'https://t.me/oskolokch',donate:'https://boosty.to/oskolokplayer/donate',beta:'https://oskolok.lol/beta',app:'https://oskolok.lol/app',download:'https://oskolok.lol/download'};
export function cabinetKeyboard():Markup {return {inline_keyboard:[
  [{text:'Профиль',icon_custom_emoji_id:EMOJI.profile[0],callback_data:'cabinet:profile'},{text:'Открыть сайт',style:'primary',icon_custom_emoji_id:EMOJI.music[0],url:cabinetLinks.site}],
  [{text:'Скачать Осколок',icon_custom_emoji_id:EMOJI.headphones[0],callback_data:'cabinet:downloads'},{text:'Об Осколке',icon_custom_emoji_id:EMOJI.info[0],callback_data:'cabinet:info'}],
  [{text:'Telegram',icon_custom_emoji_id:EMOJI.plane[0],url:cabinetLinks.channel},{text:'TikTok',icon_custom_emoji_id:EMOJI.speaker[0],url:cabinetLinks.tiktok}],
  [{text:'Поддержать',icon_custom_emoji_id:EMOJI.heart[0],url:cabinetLinks.donate},{text:'Заявка на бету',icon_custom_emoji_id:EMOJI.star[0],url:cabinetLinks.beta}],
]};}
type CabinetMessage={messageId:number;hasPhoto:boolean};
export async function sendCabinet(sender:string,beta:boolean,username?:string,section='home',message?:CabinetMessage) {
  const m=new Msg();let keyboard=cabinetKeyboard(),kind:BannerKind='welcome';
  if(section==='profile') {
    kind='profile';
    m.e('profile').t(' ').b('Ваш профиль').n(2).t(username?`@${username}\n`:'').t(`ID: ${sender}`).n().e(beta?'check':'info').t(beta?' Доступ к бете открыт.':' Приглашение в бету пока не выдано.').n(2).t('Здесь всегда доступны новости, приложения и заявка на участие.');
  } else if(section==='downloads') {
    kind='downloads';
    m.e('headphones').t(' ').b('Осколок на ваших устройствах').n(2).t('Выберите свою платформу. Для входа в плеер нужен доступ к бете.');
    keyboard={inline_keyboard:[
      [{text:'Windows · установщик',url:'https://oskolok.lol/downloads/Oskolok-Setup.exe'},{text:'Windows · portable',url:'https://oskolok.lol/downloads/Oskolok-Portable.exe'}],
      [{text:'Android · APK',url:'https://oskolok.lol/downloads/Oskolok.apk'}],
      [{text:'macOS · Apple Silicon',url:'https://oskolok.lol/downloads/Oskolok-arm64.dmg'},{text:'macOS · Intel',url:'https://oskolok.lol/downloads/Oskolok-x64.dmg'}],
      [{text:'iPhone, Linux и все инструкции',url:cabinetLinks.download}],
      [{text:'В кабинет',callback_data:'cabinet:home'}],
    ]};
  } else if(section==='info') {
    kind='info';
    m.e('music').t(' ').b('Ваша музыка. Ваши грани.').n(2).t('Осколок — музыка, коллекция, тексты и текущий трек в Telegram-профиле.').n().t('Плеер доступен на сайте, Windows, macOS и Android. Сейчас идёт закрытая бета.').n(2).e('chat').t(' Новости и связь — в Telegram. Заявка на бету и поддержка проекта — ниже.');
  } else if(section==='beta') {
    kind='beta-pending';
    m.e('star').t(' ').b('Бета по приглашению').n(2).t('Музыка и подключение Telegram станут доступны после одобрения заявки.').n().t('Оставьте заявку на сайте и подтвердите Telegram через этого бота. Когда доступ откроется, бот пришлёт уведомление. Статус заявки: /beta_status.');
  } else {
    m.e('wave').t(' ').b('Осколок').n(2).t('Ваш личный кабинет.').n().e(beta?'check':'info').t(beta?' Доступ к бете открыт.':' Бета по приглашению. Оставьте заявку — мы сообщим о доступе.');
  }
  if(section!=='home'&&section!=='downloads')keyboard={inline_keyboard:[...(keyboard!.inline_keyboard as unknown[]),[{text:'В кабинет',callback_data:'cabinet:home'}]]};
  if(message){
    if(message.hasPhoto)await editBanner(sender,message.messageId,kind,m,keyboard);
    else await editText(sender,message.messageId,m,keyboard);
  }else await sendBanner(sender,kind,m,keyboard);
}
export async function cabinetCallback(id:string,sender:string,data:string,beta:boolean,username?:string,message?:CabinetMessage) {
  const section=data.slice('cabinet:'.length);
  if(!['home','profile','downloads','info'].includes(section)){await answerCallback(id);return;}
  await answerCallback(id);await sendCabinet(sender,beta,username,section,message);
}
