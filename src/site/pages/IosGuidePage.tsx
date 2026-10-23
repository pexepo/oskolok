import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Info, Plus } from 'lucide-react';
import { siteApi, type ReleaseCatalog } from '../api.js';
import { PageShell, usePageMeta } from '../components/chrome.js';
import { StepGuide, type GuideStep } from '../components/StepGuide.js';
import * as I from '../components/illustrations.js';

type Method = 'web' | 'sideloadly' | 'altstore' | 'testflight';
const fig = (node: React.ReactNode, caption: string) => ({ node, caption });

const P = ({ children }: { children: React.ReactNode }) => <p>{children}</p>;

function ipaStep(hasIpa: boolean): GuideStep {
  return {
    title: 'Скачай файл Осколка',
    body: <>
      <P>Приложение для iPhone распространяется файлом с расширением .ipa. Это как установщик, только для iPhone. Файл доступен участникам бета-теста на странице загрузок после входа через Telegram.</P>
      {hasIpa ? <P><Link className="s-link" to="/download?platform=ios">Открыть загрузку для iPhone</Link></P> : <P><b>Сейчас сборка ещё проверяется.</b> Как только она появится, кнопка загрузки откроется на странице загрузок, а мы напишем в канале. Пока можно поставить веб-приложение: первый способ в этом гайде.</P>}
    </>,
    trouble: { problem: 'кнопка загрузки неактивна', fix: <P>Войди в Осколок через Telegram-аккаунт, которому одобрили заявку, и обнови страницу загрузок.</P> },
    figure: fig(<I.IllComputerTools />, 'Что нужно на компьютере: программа установки и файл Осколка'),
  };
}
const devMode: GuideStep = {
  title: 'Включи режим разработчика',
  body: <><P>На iOS 16 и новее приложения, установленные с компьютера, запускаются только с этим режимом. Открой «Настройки» → «Конфиденциальность и безопасность» → «Режим разработчика» и включи переключатель.</P><P>iPhone попросит перезагрузиться. После перезагрузки подтверди включение и введи код-пароль.</P></>,
  trouble: { problem: 'пункта «Режим разработчика» нет', fix: <P>Он появляется после первой попытки установить приложение с компьютера. Сначала выполни установку, затем вернись в настройки.</P> },
  figure: fig(<I.IllDeveloperMode />, 'Настройки → Конфиденциальность и безопасность → Режим разработчика'),
};
const trustDev: GuideStep = {
  title: 'Разреши запуск приложения',
  body: <><P>Открой «Настройки» → «Основные» → «VPN и управление устройством». В разделе «Приложение разработчика» нажми на свой Apple ID и выбери «Доверять».</P><P>Это нужно один раз для твоего Apple ID. Отключать другие защиты iPhone не надо.</P></>,
  trouble: { problem: 'при запуске появляется «Ненадежный разработчик»', fix: <P>Это и есть этот шаг: iPhone ждёт, пока ты разрешишь своего «разработчика», то есть свой Apple ID.</P> },
  figure: fig(<I.IllTrustDeveloper />, 'Настройки → Основные → VPN и управление устройством'),
};
const openApp: GuideStep = {
  title: 'Открой Осколок',
  body: <><P>Найди значок на экране «Домой» и войди через Telegram. Коллекция, плейлисты и настройки подтянутся с сервера.</P><P>Музыка играет в фоне и управляется с экрана блокировки, из Пункта управления и с наушников.</P></>,
  figure: fig(<I.IllOskolokApp />, 'Значок Осколка на экране «Домой»'),
};

function steps(method: Method, hasIpa: boolean): GuideStep[] {
  if (method === 'web') return [
    { title: 'Открой Осколок в Safari', body: <P>Открой браузер Safari и перейди на <b>oskolok.lol/app</b>. На iOS 16.4 и новее подойдёт и другой браузер, но в Safari путь самый простой.</P>, figure: fig(<I.IllSafari />, 'Адрес oskolok.lol/app в Safari'), trouble: { problem: 'страница не открывается', fix: <P>Проверь интернет и выключи режим «Экономия трафика» или VPN, если они блокируют сайт.</P> } },
    { title: 'Нажми «Поделиться»', body: <P>Это квадрат со стрелкой вверх на панели Safari. В новых версиях iOS он может прятаться в меню «•••» рядом с адресом.</P>, figure: fig(<I.IllShareButton />, 'Кнопка «Поделиться» в Safari') },
    { title: 'Выбери «На экран «Домой»»', body: <P>Прокрути список действий вниз. Если пункта не видно, нажми «Изменить действия» и включи его.</P>, figure: fig(<I.IllAddToHome />, 'Пункт «На экран «Домой»» в меню «Поделиться»') },
    { title: 'Нажми «Добавить»', body: <P>Название уже заполнено. Если iPhone предлагает открывать сайт как веб-приложение, оставь это включённым: тогда Осколок откроется без адресной строки, как обычное приложение.</P>, figure: fig(<I.IllAddConfirm />, 'Подтверждение «Добавить»') },
    { title: 'Открой Осколок с экрана «Домой»', body: <><P>Войди через Telegram и слушай. Обновления приходят сами, переустанавливать ничего не нужно.</P><P>У веб-приложения есть ограничения iOS: фоновое воспроизведение и кнопки на экране блокировки работают не всегда стабильно. Если это важно, поставь нативное приложение через компьютер.</P></>, figure: fig(<I.IllHomeScreen />, 'Значок Осколка на экране «Домой»') },
  ];
  if (method === 'sideloadly') return [
    { title: 'Подготовь компьютер', body: <><P>Скачай программу Sideloadly с официального сайта <b>sideloadly.io</b>. Она есть для Windows и macOS и бесплатна.</P><P>На Windows дополнительно установи iTunes и iCloud с сайта Apple (версии не из Microsoft Store), без них компьютер не увидит iPhone. На Mac ничего ставить не нужно.</P></>, figure: fig(<I.IllComputerTools />, 'Что скачать на компьютер'), trouble: { problem: 'антивирус ругается на Sideloadly', fix: <P>Скачивай только с sideloadly.io. Копии с других сайтов могут быть заражены.</P> } },
    ipaStep(hasIpa),
    { title: 'Подключи iPhone кабелем', body: <P>Разблокируй iPhone и подключи к компьютеру. На экране iPhone появится вопрос «Доверять этому компьютеру?». Нажми «Доверять» и введи код-пароль.</P>, figure: fig(<I.IllTrustComputer />, 'Окно «Доверять этому компьютеру?» на iPhone'), trouble: { problem: 'компьютер не видит iPhone', fix: <P>Попробуй другой кабель и порт, переустанови iTunes с сайта Apple (на Windows), перезагрузи оба устройства.</P> } },
    { title: 'Установи Осколок через Sideloadly', body: <><P>Перетащи файл Oskolok.ipa в окно Sideloadly (1), проверь, что выбран твой iPhone, и впиши Apple ID (2). Нажми Start (3), затем введи пароль Apple ID и код подтверждения, если Apple его пришлёт.</P><P>Sideloadly подписывает приложение твоим Apple ID и передаёт пароль только серверам Apple. Если не хочешь использовать основной аккаунт, заведи отдельный бесплатный Apple ID.</P></>, figure: fig(<I.IllSideloadly />, 'Схема окна Sideloadly: файл, Apple ID, Start'), trouble: { problem: 'Sideloadly пишет об ошибке входа', fix: <P>Проверь пароль и включи двухфакторную аутентификацию Apple ID. При лимите приложений удали старые неиспользуемые приложения, установленные таким же способом.</P> } },
    devMode,
    trustDev,
    openApp,
  ];
  if (method === 'altstore') return [
    { title: 'Установи AltServer на компьютер', body: <><P>Скачай AltServer с официального сайта <b>altstore.io</b> (раздел AltStore Classic) для Windows или macOS и запусти. На Windows также нужны iTunes и iCloud с сайта Apple.</P><P>AltServer появится значком в трее Windows или в строке меню Mac.</P></>, figure: fig(<I.IllComputerTools />, 'Что нужно на компьютере') },
    { title: 'Подключи iPhone и нажми «Доверять»', body: <P>Подключи iPhone кабелем, разблокируй и подтверди «Доверять этому компьютеру?».</P>, figure: fig(<I.IllTrustComputer />, 'Окно «Доверять этому компьютеру?»') },
    { title: 'Поставь AltStore на iPhone', body: <P>Нажми значок AltServer, выбери «Install AltStore» и свой iPhone, затем введи Apple ID. Через минуту на iPhone появится AltStore.</P>, figure: fig(<I.IllAltServer />, 'Меню AltServer: Install AltStore'), trouble: { problem: 'AltServer не видит iPhone', fix: <P>На Windows переустанови iTunes и iCloud с сайта Apple, на Mac проверь, что iPhone виден в Finder.</P> } },
    devMode,
    trustDev,
    { ...ipaStep(hasIpa), title: 'Скачай файл Осколка на iPhone', figure: fig(<I.IllAltStoreMyApps />, 'AltStore: My Apps → «+» → файл Осколка') },
    { title: 'Установи Осколок из AltStore', body: <P>Открой AltStore, вкладку «My Apps», нажми «+» и выбери скачанный Oskolok.ipa в «Файлах». AltStore установит приложение.</P>, figure: fig(<I.IllAltStoreMyApps />, 'AltStore: My Apps → «+»') },
    openApp,
  ];
  return [];
}

const METHODS: Array<{ id: Method; title: string; text: string; tone: 'available' | 'beta' | 'development' | 'soon'; chip: string }> = [
  { id: 'web', title: 'Без компьютера', text: 'Веб-приложение через Safari за минуту. Подходит всем и обновляется само.', tone: 'available', chip: 'Доступно' },
  { id: 'sideloadly', title: 'Через Windows или Mac', text: 'Нативное приложение через Sideloadly. Нужны кабель и Apple ID.', tone: 'beta', chip: 'Для бета-тестеров' },
  { id: 'altstore', title: 'Через AltStore Classic', text: 'Как Sideloadly, но подпись продлевается сама по Wi-Fi.', tone: 'beta', chip: 'Для бета-тестеров' },
  { id: 'testflight', title: 'TestFlight', text: 'Установка из приложения Apple в одно нажатие.', tone: 'soon', chip: 'Пока недоступно' },
];

const FAQ: Array<[string, React.ReactNode]> = [
  ['Приложение не устанавливается', <><p>Проверь, что на iPhone iOS 15 или новее и хватает свободного места. Перезапусти Sideloadly или AltServer и подключи iPhone заново.</p><p>С бесплатным Apple ID можно держать установленными не больше трёх таких приложений одновременно. Удали лишнее и повтори.</p></>],
  ['Файл .ipa не открывается', <p>Его не нужно открывать на iPhone напрямую. Перетащи файл в окно Sideloadly на компьютере или выбери его внутри AltStore через «+».</p>],
  ['Ошибка подписи или Apple ID', <ul><li>Проверь пароль и включи двухфакторную аутентификацию.</li><li>Если Apple пишет о лимите App ID, подожди неделю или используй другой Apple ID.</li><li>Не используй чужие сертификаты и сервисы «подписи без компьютера» из интернета: это небезопасно, и Apple часто их отзывает.</li></ul>],
  ['Не получается подтвердить разработчика', <p>Пункт появляется в «Настройки» → «Основные» → «VPN и управление устройством» только после установки и при подключении к интернету. Открой его заново через минуту.</p>],
  ['Приложение перестало запускаться', <p>Скорее всего, истёк срок подписи. С бесплатным Apple ID он длится 7 дней. Подключи iPhone и переустанови через Sideloadly, или нажми «Refresh All» в AltStore, когда AltServer запущен в той же сети Wi-Fi. Данные сохранятся: коллекция хранится на сервере.</p>],
  ['Истёк срок действия подписи', <p>Это нормальное ограничение Apple для приложений, установленных бесплатным аккаунтом. Платный аккаунт разработчика продлевает срок до года, но обновлять всё равно придётся.</p>],
  ['Компьютер не видит iPhone', <ul><li>Другой кабель и порт, лучше оригинальный.</li><li>Windows: iTunes и iCloud с сайта Apple, не из Microsoft Store.</li><li>Разблокируй iPhone и снова нажми «Доверять». Если окно не появляется: «Настройки» → «Основные» → «Перенос или сброс iPhone» → «Сбросить» → «Сбросить геонастройки» вернёт вопрос о доверии.</li></ul>],
  ['Установка зависла', <p>Подожди пару минут: первая установка дольше. Если прогресс стоит, отключи iPhone, закрой программу, перезагрузи оба устройства и повтори.</p>],
  ['Ошибка в Sideloadly или AltStore', <p>Обнови программу до последней версии с официального сайта. Текст ошибки можно отправить нам в боте или канале: поможем разобраться.</p>],
  ['Нет нужного пункта в меню «Поделиться»', <p>Прокрути меню вниз и нажми «Изменить действия». Добавить на экран «Домой» можно только из Safari на старых версиях iOS.</p>],
];

export function IosGuidePage() {
  usePageMeta('Как установить Осколок на iPhone: подробный гайд', 'Пошаговая инструкция с картинками: веб-приложение без компьютера, Sideloadly, AltStore Classic. Ограничения и решения частых проблем.', '/download/ios');
  const [method, setMethod] = React.useState<Method>('web');
  const [hasIpa, setHasIpa] = React.useState(false);
  React.useEffect(() => { siteApi<ReleaseCatalog>('/releases').then(c => setHasIpa(!!c.platforms.find(p => p.platform === 'ios')?.builds.length)).catch(() => {}); }, []);
  const list = steps(method, hasIpa);
  return <PageShell>
    <div className="s-wrap s-page">
      <header className="s-page-head">
        <nav className="s-crumbs" aria-label="Навигация"><Link to="/">Осколок</Link><span aria-hidden="true">/</span><Link to="/download">Загрузки</Link><span aria-hidden="true">/</span><span>iPhone</span></nav>
        <h1>Осколок на iPhone</h1>
        <p className="s-lead">Осколка нет в App Store, поэтому есть несколько способов установки. Разбираться в терминах не нужно: выбери способ и иди по шагам.</p>
      </header>
      <section aria-labelledby="choose-title">
        <h2 id="choose-title" style={{ font: '700 22px/1.2 var(--s-display)' }}>Как ты хочешь установить Осколок?</h2>
        <div className="s-methods">
          {METHODS.map(m => <button key={m.id} type="button" className="s-method" aria-pressed={method === m.id} onClick={() => setMethod(m.id)}><span className="s-chip" data-tone={m.tone}>{m.chip}</span><b>{m.title}</b><span>{m.text}</span></button>)}
        </div>
      </section>
      {method === 'testflight'
        ? <div className="s-glass s-step" style={{ marginTop: 30, gridTemplateColumns: '1fr' }}>
          <div><p className="s-step-num">TestFlight</p><h3>Почему TestFlight пока нет</h3>
            <p>TestFlight это официальное приложение Apple для бета-тестов. Установка в нём простая и не требует компьютера. Но чтобы выпустить приложение в TestFlight, разработчику нужна платная программа Apple Developer, а каждую сборку для внешних тестеров проверяет Apple по правилам App Store.</p>
            <p style={{ marginTop: 10 }}>Осколок воспроизводит музыку из открытых источников, и такие приложения часто не проходят эту проверку. Мы изучаем вариант, но не обещаем сроков. Если TestFlight появится, здесь будет ссылка-приглашение для одобренных бета-тестеров.</p>
            <div className="s-actions" style={{ marginTop: 18 }}><button className="s-btn s-btn-primary" type="button" onClick={() => setMethod('web')}>Поставить веб-приложение</button></div></div>
        </div>
        : <StepGuide steps={list} resetKey={method} />}

      <section aria-labelledby="limits-title" style={{ marginTop: 56 }}>
        <h2 id="limits-title" className="s-h2" style={{ fontSize: 'clamp(26px,3vw,36px)' }}>Честно об ограничениях</h2>
        <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
          <div className="s-notice" data-tone="warn"><AlertTriangle size={18} /><span><b>Подпись на 7 дней.</b> С бесплатным Apple ID приложение работает неделю, потом его нужно переподписать с компьютера (AltStore делает это сам по Wi-Fi). Платный аккаунт разработчика продлевает срок до года.</span></div>
          <div className="s-notice" data-tone="warn"><AlertTriangle size={18} /><span><b>Нужен компьютер.</b> Для нативного приложения нужен Windows или Mac и кабель. Веб-приложение ставится без компьютера.</span></div>
          <div className="s-notice"><Info size={18} /><span><b>Работает в любой стране.</b> Описанные способы не зависят от региона. Альтернативные магазины приложений Apple разрешает только в ЕС, поэтому на них мы не опираемся.</span></div>
          <div className="s-notice"><Info size={18} /><span><b>Обновления.</b> Интерфейс и функции приходят с сайта автоматически, даже в установленном приложении. Переустанавливать IPA нужно только при обновлении самой оболочки, мы сообщим об этом в боте и канале.</span></div>
          <div className="s-notice"><Info size={18} /><span><b>Безопасность.</b> Устанавливай Осколок только со страницы загрузок oskolok.lol. Не вводи Apple ID на сторонних сайтах и не отключай системную защиту iPhone: гайду это не нужно.</span></div>
        </div>
      </section>

      <section aria-labelledby="faq-title" style={{ marginTop: 56 }}>
        <h2 id="faq-title" className="s-h2" style={{ fontSize: 'clamp(26px,3vw,36px)' }}>Что делать, если не получается?</h2>
        <div className="s-faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}<Plus size={18} aria-hidden="true" /></summary><div>{a}</div></details>)}</div>
      </section>
      <div className="s-actions" style={{ marginTop: 40 }}><Link className="s-btn" to="/download"><ArrowLeft size={16} aria-hidden="true" />К загрузкам</Link><a className="s-btn s-btn-ghost" href="https://t.me/oskolokch" target="_blank" rel="noopener noreferrer">Спросить в канале</a></div>
    </div>
  </PageShell>;
}
