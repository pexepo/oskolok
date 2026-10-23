import React from 'react';
import { ChevronLeft, ChevronRight, Download, Share, Search } from 'lucide-react';
import logo from '../../assets/logo.png';

/* Schematic iPhone and computer screens for the install guides. They reproduce only the real system labels
   (iOS in Russian) and highlight the control to press; they are drawings, not screenshots. */
const Phone = ({ children, dark = false, wall = false }: { children: React.ReactNode; dark?: boolean; wall?: boolean }) =>
  <div className="ill"><div className={`ill-screen${dark ? ' dark' : ''}${wall ? ' wall' : ''}`}><span className="ill-island" /><div className="ill-status"><span>9:41</span><span>●●● ▮</span></div>{children}</div></div>;
const Num = ({ n, style }: { n: number; style: React.CSSProperties }) => <span className="ill-num" style={style}>{n}</span>;
const Row = ({ children, hl, chevron = true, value }: { children: React.ReactNode; hl?: boolean; chevron?: boolean; value?: React.ReactNode }) =>
  <div className={`ill-row${hl ? ' ill-hl' : ''}`}><span>{children}</span><i>{value}{chevron && <ChevronRight size={14} style={{ verticalAlign: 'middle' }} />}</i></div>;

export const IllSafari = () => <Phone>
  <div style={{ position: 'absolute', inset: '44px 0 96px', overflow: 'hidden' }}><div className="ill-page"><img src={logo} alt="" /><b>Осколок</b><i style={{ width: '80%' }} /><i style={{ width: '60%' }} /><i style={{ width: '70%' }} /></div></div>
  <div className="ill-safari"><div className="ill-url ill-hl">oskolok.lol/app</div><div className="ill-toolbar"><ChevronLeft size={18} /><ChevronRight size={18} /><Share size={18} /><span>⧉</span></div></div>
  <Num n={1} style={{ bottom: 66, left: 18 }} />
</Phone>;

export const IllShareButton = () => <Phone>
  <div style={{ position: 'absolute', inset: '44px 0 96px', overflow: 'hidden' }}><div className="ill-page"><img src={logo} alt="" /><b>Осколок</b><i style={{ width: '80%' }} /><i style={{ width: '60%' }} /></div></div>
  <div className="ill-safari"><div className="ill-url">oskolok.lol/app</div><div className="ill-toolbar"><ChevronLeft size={18} /><ChevronRight size={18} /><span className="ill-hl" style={{ padding: '2px 6px' }}><Share size={18} /></span><span>⧉</span></div></div>
  <Num n={2} style={{ bottom: 44, left: '58%' }} />
</Phone>;

export const IllAddToHome = () => <Phone>
  <div className="ill-dim" />
  <div className="ill-sheet">
    <div className="ill-sheet-head"><img src={logo} alt="" /><span><b>Осколок</b>oskolok.lol</span></div>
    <div className="ill-group"><Row chevron={false}>Скопировать</Row><Row chevron={false}>Добавить в «Избранное»</Row><Row chevron={false} hl>На экран «Домой»</Row></div>
  </div>
  <Num n={3} style={{ bottom: 30, right: 14 }} />
</Phone>;

export const IllAddConfirm = () => <Phone>
  <div className="ill-nav"><span>Отменить</span><b>На экран «Домой»</b><span className="ill-hl" style={{ padding: '3px 6px', fontWeight: 600 }}>Добавить</span></div>
  <div className="ill-group"><div className="ill-row" style={{ justifyContent: 'flex-start', gap: 12 }}><img src={logo} alt="" style={{ width: 44, height: 44, borderRadius: 10 }} /><span style={{ display: 'grid' }}><b>Осколок</b><i style={{ fontStyle: 'normal', color: '#8e8e93', fontSize: 11 }}>https://oskolok.lol/app</i></span></div></div>
  <div className="ill-foot">Значок появится на экране «Домой».</div>
  <Num n={4} style={{ top: 40, right: 8 }} />
</Phone>;

export const IllHomeScreen = () => <Phone dark wall>
  <div className="ill-home">{['Фото', 'Камера', 'Почта', 'Заметки', 'Карты', 'Погода', 'Часы', 'Файлы'].map(n => <span key={n} className="ill-app"><i />{n}</span>)}<span className="ill-app"><img className="ill-hl" src={logo} alt="" />Осколок</span></div>
  <Num n={5} style={{ top: 238, left: 52 }} />
</Phone>;

export const IllTrustComputer = () => <Phone dark wall>
  <div className="ill-dim" />
  <div className="ill-alert"><p><b>Доверять этому компьютеру?</b>Ваши настройки и данные будут доступны с этого компьютера при подключении.</p><div><span className="ill-hl">Доверять</span><span>Не доверять</span></div></div>
</Phone>;

export const IllDeveloperMode = () => <Phone>
  <div className="ill-nav"><span><ChevronLeft size={14} style={{ verticalAlign: 'middle' }} />Назад</span><b>Режим разработчика</b><span /></div>
  <div className="ill-group"><div className="ill-row ill-hl"><span>Режим разработчика</span><span className="ill-toggle" /></div></div>
  <div className="ill-foot">После включения iPhone попросит перезагрузку. После перезагрузки подтверди включение.</div>
  <div className="ill-cap" style={{ marginTop: 18 }}>Путь</div>
  <div className="ill-group"><Row>Настройки</Row><Row>Конфиденциальность и безопасность</Row><Row hl>Режим разработчика</Row></div>
</Phone>;

export const IllTrustDeveloper = () => <Phone>
  <div className="ill-nav"><span><ChevronLeft size={14} style={{ verticalAlign: 'middle' }} />Основные</span><b>VPN и управление устройством</b><span /></div>
  <div className="ill-cap">Приложение разработчика</div>
  <div className="ill-group"><Row hl>Apple Development: you@icloud.com</Row></div>
  <div className="ill-dim" style={{ top: '45%' }} />
  <div className="ill-sheet"><div className="ill-group"><div className="ill-row blue ill-hl" style={{ justifyContent: 'center' }}>Доверять «you@icloud.com»</div></div><div className="ill-foot" style={{ textAlign: 'center' }}>Подтверди кнопкой «Доверять» в окне.</div></div>
</Phone>;

export const IllUntrusted = () => <Phone dark wall>
  <div className="ill-dim" />
  <div className="ill-alert"><p><b>Ненадежный разработчик</b>На этом iPhone не установлено доверие разработчику. Это можно сделать в настройках.</p><div><span className="ill-hl">Отменить</span></div></div>
</Phone>;

export const IllComputerTools = () => <div className="ill-pc">
  <div className="ill-pc-bar"><i /><i /><i /><span style={{ marginLeft: 8 }}>Браузер · sideloadly.io</span></div>
  <div className="ill-pc-body">
    <div className="ill-field"><span>Windows: сначала установи с сайта Apple</span><div>iTunes (не из Microsoft Store) · iCloud</div></div>
    <div className="ill-field"><span>Затем скачай программу для установки</span><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Download size={14} />Sideloadly для Windows / macOS</div></div>
    <div className="ill-field"><span>И файл Осколка со страницы загрузок</span><div className="ill-hl" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><img src={logo} alt="" style={{ width: 18, height: 18 }} />Oskolok.ipa</div></div>
  </div>
</div>;

export const IllCable = () => <div className="ill-pc" style={{ aspectRatio: 'auto', background: '#121a29' }}>
  <div className="ill-pc-bar"><span>iPhone подключён кабелем</span></div>
  <div className="ill-cable"><span className="ill-laptop"><div>Компьютер</div><span /></span><i className="ill-wire" /><Phone><div className="ill-alert" style={{ top: '30%', left: '6%', right: '6%' }}><p style={{ fontSize: 8, padding: 6 }}><b style={{ fontSize: 9 }}>Доверять?</b></p><div><span className="ill-hl" style={{ fontSize: 8, padding: 4 }}>Доверять</span></div></div></Phone></div>
</div>;

export const IllSideloadly = () => <div className="ill-pc">
  <div className="ill-pc-bar"><i /><i /><i /><span style={{ marginLeft: 8 }}>Схема окна Sideloadly</span></div>
  <div className="ill-pc-body">
    <div className="ill-drop ill-hl"><img src={logo} alt="" /><span>Перетащи сюда Oskolok.ipa</span></div>
    <div className="ill-field"><span>Устройство</span><div>iPhone (USB)</div></div>
    <div className="ill-field"><span>Apple ID</span><div>you@icloud.com</div></div>
    <span className="ill-btn ill-hl">Start</span>
    <Num n={1} style={{ top: 22, left: 22 }} /><Num n={2} style={{ top: 168, left: 6 }} /><Num n={3} style={{ bottom: 18, right: 100 }} />
  </div>
</div>;

export const IllAltServer = () => <div className="ill-pc">
  <div className="ill-pc-bar"><i /><i /><i /><span style={{ marginLeft: 8 }}>Меню AltServer (значок в трее или строке меню)</span></div>
  <div className="ill-pc-body">
    <div className="ill-group" style={{ margin: 0, background: '#0f141e', color: '#e8ecf3' }}>
      <div className="ill-row" style={{ color: '#e8ecf3' }}>Install AltStore<i><ChevronRight size={14} /></i></div>
      <div className="ill-row ill-hl" style={{ color: '#e8ecf3', borderTop: '1px solid #2e384b' }}>iPhone<i /></div>
      <div className="ill-row" style={{ color: '#8b97ad', borderTop: '1px solid #2e384b' }}>Settings…</div>
    </div>
    <div className="ill-field"><span>Затем AltServer спросит</span><div>Apple ID и пароль</div></div>
  </div>
</div>;

export const IllAltStoreMyApps = () => <Phone>
  <div className="ill-nav"><span /><b>My Apps</b><span className="ill-hl" style={{ padding: '0 6px', fontSize: 20, lineHeight: 1 }}>+</span></div>
  <div className="ill-cap">Выбери файл</div>
  <div className="ill-group"><div className="ill-row"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Search size={14} />Загрузки</span><i /></div><div className="ill-row ill-hl"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><img src={logo} alt="" style={{ width: 22, height: 22 }} />Oskolok.ipa</span><i /></div></div>
  <div className="ill-foot">AltStore установит приложение и сам продлит подпись, пока AltServer доступен в той же сети Wi-Fi.</div>
  <Num n={1} style={{ top: 40, right: 6 }} /><Num n={2} style={{ top: 150, left: 4 }} />
</Phone>;

export const IllOskolokApp = () => <Phone dark wall>
  <div className="ill-home">{['Фото', 'Камера', 'Почта', 'Файлы', 'Карты', 'Погода', 'Часы', 'Заметки'].map(n => <span key={n} className="ill-app"><i />{n}</span>)}<span className="ill-app"><img className="ill-hl" src={logo} alt="" />Осколок</span></div>
</Phone>;
