import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { PageShell, usePageMeta } from '../components/chrome.js';
import { StepGuide, type GuideStep } from '../components/StepGuide.js';

const Faq = ({ items }: { items: Array<[string, React.ReactNode]> }) => <div className="s-faq">{items.map(([q, a]) => <details key={q}><summary>{q}<Plus size={18} aria-hidden="true" /></summary><div>{a}</div></details>)}</div>;
const Head = ({ title, lead, crumb }: { title: string; lead: string; crumb: string }) => <header className="s-page-head">
  <nav className="s-crumbs" aria-label="Навигация"><Link to="/">Осколок</Link><span aria-hidden="true">/</span><Link to="/download">Загрузки</Link><span aria-hidden="true">/</span><span>{crumb}</span></nav>
  <h1>{title}</h1><p className="s-lead">{lead}</p>
</header>;

const ANDROID: GuideStep[] = [
  { title: 'Скачай APK', body: <p>Открой <Link className="s-link" to="/download?platform=android">страницу загрузок</Link> на телефоне и нажми «Скачать». Файл весит меньше мегабайта: интерфейс приходит с сайта.</p> },
  { title: 'Разреши установку', body: <p>Открой скачанный файл. Android попросит разрешить браузеру установку приложений из этого источника: включи переключатель и вернись назад.</p>, trouble: { problem: 'кнопка «Установить» неактивна', fix: <p>Закрой всплывающие окна поверх экрана (пузырьки чатов, фильтры синего света) и попробуй снова.</p> } },
  { title: 'Установи', body: <p>Нажми «Установить». Если Play Защита предупредит о неизвестном приложении, выбери «Подробнее» и «Всё равно установить». Осколок подписан постоянным ключом, обновления ставятся поверх.</p> },
  { title: 'Войди через Telegram', body: <p>Открой Осколок и войди. Музыка играет в фоне, кнопки появляются в уведомлении и на экране блокировки.</p> },
];
export function AndroidGuidePage() {
  usePageMeta('Как установить Осколок на Android', 'Установка APK Осколка на Android 8 и новее: разрешения, Play Защита, частые проблемы.', '/download/android');
  return <PageShell><div className="s-wrap s-page">
    <Head crumb="Android" title="Осколок на Android" lead="APK ставится за минуту. В Google Play приложения пока нет, поэтому Android один раз спросит разрешение." />
    <StepGuide steps={ANDROID} resetKey="android" />
    <h2 className="s-h2" style={{ fontSize: 'clamp(26px,3vw,36px)', marginTop: 56 }}>Если не получается</h2>
    <Faq items={[
      ['«Приложение не установлено»', <p>Удали старую версию Осколка, если она была подписана другим ключом, и установи заново. Проверь свободное место.</p>],
      ['Музыка останавливается в фоне', <p>Отключи для Осколка оптимизацию батареи: «Настройки» → «Приложения» → «Осколок» → «Батарея» → «Без ограничений». Названия пунктов зависят от производителя телефона.</p>],
      ['Нет кнопок в уведомлении', <p>Разреши Осколку показывать уведомления: Android 13 и новее спрашивает это при первом запуске.</p>],
    ]} />
    <div className="s-actions" style={{ marginTop: 32 }}><Link className="s-btn" to="/download"><ArrowLeft size={16} aria-hidden="true" />К загрузкам</Link></div>
  </div></PageShell>;
}

const DESKTOP: GuideStep[] = [
  { title: 'Выбери файл', body: <><p><b>Windows:</b> установщик ставит Осколок как обычную программу, portable запускается из любой папки без установки.</p><p><b>macOS:</b> Apple Silicon для Mac на M1 и новее, Intel для более старых Mac. Узнать процессор: меню Apple → «Об этом Mac».</p></> },
  { title: 'Windows: запусти установщик', body: <p>Если появится синее окно «Система Windows защитила ваш компьютер», нажми «Подробнее» и «Выполнить в любом случае». Предупреждение появляется, потому что у сборки пока нет платного сертификата издателя.</p>, trouble: { problem: 'антивирус удаляет файл', fix: <p>Сверь SHA-256 файла со страницей загрузок. Если совпадает, добавь файл в исключения антивируса.</p> } },
  { title: 'macOS: перенеси в «Программы»', body: <p>Открой DMG и перетащи значок Осколка в папку «Программы». Запусти из «Программ», а не из окна DMG.</p> },
  { title: 'macOS: разреши первый запуск', body: <p>Если macOS сообщит, что не может проверить приложение, открой «Системные настройки» → «Конфиденциальность и безопасность», пролистай вниз и нажми «Всё равно открыть». Это нужно один раз.</p>, trouble: { problem: 'кнопки «Всё равно открыть» нет', fix: <p>Сначала попробуй запустить Осколок, закрой предупреждение, и кнопка появится в настройках в течение часа.</p> } },
  { title: 'Войди через Telegram', body: <p>Осколок откроется и предложит войти. Новые версии интерфейса приходят автоматически, переустанавливать нужно только при выходе новой оболочки.</p> },
];
export function DesktopGuidePage() {
  usePageMeta('Как установить Осколок на Windows и macOS', 'Установка десктопного Осколка: SmartScreen, Gatekeeper, выбор сборки для Apple Silicon или Intel.', '/download/desktop');
  return <PageShell><div className="s-wrap s-page">
    <Head crumb="Windows и macOS" title="Осколок на компьютере" lead="Десктопное приложение для Windows и macOS. На Linux пока работает веб-версия." />
    <StepGuide steps={DESKTOP} resetKey="desktop" />
    <div className="s-actions" style={{ marginTop: 32 }}><Link className="s-btn" to="/download"><ArrowLeft size={16} aria-hidden="true" />К загрузкам</Link></div>
  </div></PageShell>;
}
