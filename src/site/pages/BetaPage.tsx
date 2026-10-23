import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Copy, ExternalLink, Lock, Send } from 'lucide-react';
import { saveApplication, siteApi, SiteApiError, type BetaConfig } from '../api.js';
import { CHANNEL_URL, PageShell, PlatformIcon, usePageMeta } from '../components/chrome.js';
import type { Platform } from '../api.js';

const PLATFORMS: Array<[Platform, string]> = [['windows', 'Windows'], ['macos', 'macOS'], ['linux', 'Linux'], ['android', 'Android'], ['ios', 'iOS'], ['web', 'Web']];
type Fields = { telegramUsername: string; purpose: string; about: string; platforms: Platform[]; consent: boolean; website: string };
type Created = { number: string; statusToken: string; verifyUrl: string; verifyExpiresAt: string };

/** Same rules as the server (server/src/services/betaApplications.ts). The server stays the authority. */
export function normalizeUsername(value: string) {
  const v = value.normalize('NFKC').trim().replace(/\s+/g, '').replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i, '').replace(/^@+/, '').replace(/[/?#].*$/, '').toLowerCase();
  return /^[a-z][a-z0-9_]{3,31}$/.test(v) && !v.endsWith('_') && !v.includes('__') ? v : null;
}
export function validate(f: Fields, limits = { min: 10, max: 1000 }) {
  const errors: Partial<Record<keyof Fields, string>> = {};
  if (!f.telegramUsername.trim()) errors.telegramUsername = 'Укажи Telegram username.';
  else if (!normalizeUsername(f.telegramUsername)) errors.telegramUsername = 'Username: от 5 до 32 латинских букв, цифр и _, начинается с буквы.';
  for (const [key, label] of [['purpose', 'Расскажи, зачем тебе бета'], ['about', 'Расскажи немного о себе']] as const) {
    const length = [...f[key].trim()].length;
    if (!length) errors[key] = `${label}.`;
    else if (length < limits.min) errors[key] = `Напиши чуть подробнее, хотя бы ${limits.min} символов.`;
    else if (length > limits.max) errors[key] = `Не больше ${limits.max} символов.`;
  }
  if (!f.consent) errors.consent = 'Нужно согласие на обработку данных заявки.';
  return errors;
}

function Skeleton() {
  return <div className="s-glass s-form" aria-busy="true" aria-label="Загружаем форму">
    {[48, 130, 130, 44].map((h, i) => <div key={i} style={{ display: 'grid', gap: 10 }}><div className="s-skel" style={{ height: 14, width: 160 }} /><div className="s-skel" style={{ height: h }} /></div>)}
  </div>;
}

function Closed() {
  return <div className="s-glass s-success" role="status">
    <div className="s-success-mark" style={{ color: 'var(--s-warn)', borderColor: '#f2c46b55', background: '#f2c46b14' }}><Lock size={30} /></div>
    <h2>Набор на бета-тестирование временно закрыт</h2>
    <p>Спасибо за интерес к Осколку! Следи за новостями проекта в нашем Telegram-канале: там мы объявим следующий набор.</p>
    <div className="s-actions"><a className="s-btn s-btn-primary" href={CHANNEL_URL} target="_blank" rel="noopener noreferrer">Telegram-канал<ExternalLink size={16} aria-hidden="true" /></a><Link className="s-btn" to="/beta/status">Статус отправленной заявки</Link></div>
  </div>;
}

function Success({ created }: { created: Created }) {
  const statusUrl = `${location.origin}/beta/status#t=${created.statusToken}`;
  const [copied, setCopied] = React.useState(false);
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => { heading.current?.focus(); }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(statusUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* The link stays visible to copy by hand. */ } };
  return <div className="s-glass s-success" role="status">
    <div className="s-success-mark"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg></div>
    <h2 ref={heading} tabIndex={-1}>Заявка отправлена!</h2>
    <p>Спасибо за интерес к Осколку. Мы рассмотрим твою заявку и сообщим о решении в Telegram.</p>
    <div className="s-verify">
      <b>Остался один шаг: подтверди Telegram</b>
      <p className="s-note">Нажми кнопку, в боте нажми «Запустить». Так мы узнаем, что заявку отправил владелец аккаунта, и бот сможет написать тебе о решении. Без подтверждения заявка не попадёт на рассмотрение. Ссылка работает 30 минут.</p>
      <a className="s-btn s-btn-primary s-btn-lg" href={created.verifyUrl} target="_blank" rel="noopener noreferrer"><Send size={18} aria-hidden="true" />Подтвердить в Telegram</a>
    </div>
    <div style={{ display: 'grid', gap: 8 }}>
      <b style={{ fontWeight: 650 }}>Заявка {created.number}: ссылка на статус</b>
      <p className="s-note">Она сохранена в этом браузере. Скопируй её, если захочешь проверить статус с другого устройства. Никому её не пересылай.</p>
      <div className="s-copy"><code>{statusUrl}</code><button className="s-btn s-btn-sm" type="button" onClick={copy}><Copy size={15} aria-hidden="true" />{copied ? 'Скопировано' : 'Копировать'}</button></div>
    </div>
    <div className="s-actions"><Link className="s-btn" to={`/beta/status#t=${created.statusToken}`}>Открыть статус<ArrowRight size={16} aria-hidden="true" /></Link></div>
  </div>;
}

export function BetaPage() {
  usePageMeta('Бета-тест Осколка: подать заявку', 'Заявка на закрытое бета-тестирование музыкального плеера Осколок. Подтверждение через Telegram-бота, решение придёт в Telegram.', '/beta');
  const [config, setConfig] = React.useState<BetaConfig | null>(null);
  const [loadError, setLoadError] = React.useState('');
  const [fields, setFields] = React.useState<Fields>({ telegramUsername: '', purpose: '', about: '', platforms: [], consent: false, website: '' });
  const [touched, setTouched] = React.useState<Partial<Record<keyof Fields, boolean>>>({});
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [created, setCreated] = React.useState<Created | null>(null);
  const busy = React.useRef(false);

  const load = React.useCallback(() => {
    setLoadError('');
    siteApi<BetaConfig>('/beta').then(setConfig).catch(e => setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить форму.'));
  }, []);
  React.useEffect(load, [load]);

  const errors = validate(fields, config?.limits);
  const shown = (key: keyof Fields) => (touched[key] ? errors[key] : undefined) || serverErrors[key];
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => { setFields(f => ({ ...f, [key]: value })); setServerErrors(e => { const { [key]: _, ...rest } = e; return rest; }); };
  const togglePlatform = (p: Platform) => set('platforms', fields.platforms.includes(p) ? fields.platforms.filter(x => x !== p) : [...fields.platforms, p]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current || !config) return;
    setTouched({ telegramUsername: true, purpose: true, about: true, consent: true });
    if (Object.keys(errors).length) {
      const first = (['telegramUsername', 'purpose', 'about', 'consent'] as const).find(k => errors[k]);
      document.getElementById(`f-${first}`)?.focus();
      return;
    }
    busy.current = true; setSending(true); setFormError('');
    try {
      const result = await siteApi<Created>('/beta/applications', { method: 'POST', body: { ...fields, formToken: config.formToken } });
      saveApplication({ token: result.statusToken, number: result.number, savedAt: Date.now() });
      sessionStorage.setItem('oskolok_beta_last', result.statusToken);
      setCreated(result);
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } catch (error) {
      if (error instanceof SiteApiError) {
        if (error.code === 'BETA_CLOSED') setConfig(c => c ? { ...c, open: false } : c);
        setServerErrors(error.fields);
        setFormError(error.message);
        // A used or stale form ticket is replaced so the next attempt can pass.
        if (error.code === 'SUBMIT_FAILED') siteApi<BetaConfig>('/beta').then(setConfig).catch(() => {});
      } else setFormError('Не удалось отправить заявку. Попробуй ещё раз.');
    } finally { busy.current = false; setSending(false); }
  };

  const count = (key: 'purpose' | 'about') => { const n = [...fields[key]].length, max = config?.limits.max || 1000; return <span className="s-counter" data-over={n > max} aria-hidden="true">{n}/{max}</span>; };
  const fieldProps = (key: keyof Fields) => ({ id: `f-${key}`, 'aria-invalid': !!shown(key) || undefined, 'aria-describedby': `f-${key}-hint f-${key}-error`, onBlur: () => setTouched(t => ({ ...t, [key]: true })) });

  return <PageShell>
    <div className="s-wrap s-page">
      <header className="s-page-head">
        <nav className="s-crumbs" aria-label="Навигация"><Link to="/">Осколок</Link><span aria-hidden="true">/</span><span>Бета-тест</span></nav>
        <h1>Заявка на бета-тест</h1>
        <p className="s-lead">Три коротких поля. После отправки подтверди Telegram в нашем боте: так заявка попадёт на рассмотрение, а решение придёт тебе в личные сообщения.</p>
      </header>
      <div className="s-beta-layout">
        <div>
          {created ? <Success created={created} />
            : loadError ? <div className="s-glass s-success" role="alert"><div className="s-form-alert"><AlertCircle size={18} />{loadError}</div><div className="s-actions"><button className="s-btn" type="button" onClick={load}>Попробовать снова</button></div></div>
            : !config ? <Skeleton />
            : !config.open ? <Closed />
            : <form className="s-glass s-form" onSubmit={submit} noValidate aria-describedby={formError ? 'form-error' : undefined}>
              <div className="s-field" data-invalid={!!shown('telegramUsername')}>
                <label htmlFor="f-telegramUsername">Telegram username</label>
                <input className="s-input" {...fieldProps('telegramUsername')} type="text" inputMode="text" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} placeholder="@username" value={fields.telegramUsername} onChange={e => set('telegramUsername', e.target.value)} />
                <div className="s-field-foot"><span id="f-telegramUsername-hint" className="s-hint">{shown('telegramUsername') ? '' : 'Без пароля и номера телефона. Аккаунт подтвердишь в боте.'}</span>{shown('telegramUsername') && <span id="f-telegramUsername-error" className="s-error">{shown('telegramUsername')}</span>}</div>
              </div>
              <div className="s-field" data-invalid={!!shown('purpose')}>
                <label htmlFor="f-purpose">Зачем тебе бета-тест</label>
                <textarea className="s-textarea" {...fieldProps('purpose')} rows={4} maxLength={1200} placeholder="Расскажи, почему хочешь попробовать Осколок и что тебя заинтересовало в проекте" value={fields.purpose} onChange={e => set('purpose', e.target.value)} />
                <div className="s-field-foot">{shown('purpose') ? <span id="f-purpose-error" className="s-error">{shown('purpose')}</span> : <span id="f-purpose-hint" />}{count('purpose')}</div>
              </div>
              <div className="s-field" data-invalid={!!shown('about')}>
                <label htmlFor="f-about">Немного о себе</label>
                <textarea className="s-textarea" {...fieldProps('about')} rows={4} maxLength={1200} placeholder="Расскажи немного о себе, какую музыку слушаешь и как обычно пользуешься музыкальными сервисами" value={fields.about} onChange={e => set('about', e.target.value)} />
                <div className="s-field-foot">{shown('about') ? <span id="f-about-error" className="s-error">{shown('about')}</span> : <span id="f-about-hint" />}{count('about')}</div>
              </div>
              <fieldset className="s-field">
                <legend>На чём будешь слушать <span className="s-muted" style={{ fontWeight: 400 }}>(необязательно)</span></legend>
                <div className="s-platform-picks">
                  {PLATFORMS.map(([p, label]) => <label key={p} className="s-pick"><input type="checkbox" checked={fields.platforms.includes(p)} onChange={() => togglePlatform(p)} /><span><PlatformIcon platform={p} size={16} />{label}</span></label>)}
                </div>
                {serverErrors.platforms && <span className="s-error">{serverErrors.platforms}</span>}
              </fieldset>
              <div className="s-hp" aria-hidden="true"><label htmlFor="f-website">Сайт</label><input id="f-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={fields.website} onChange={e => set('website', e.target.value)} /></div>
              <div className="s-field" data-invalid={!!shown('consent')}>
                <label className="s-consent"><input {...fieldProps('consent')} type="checkbox" checked={fields.consent} onChange={e => set('consent', e.target.checked)} /><span>Я согласен на обработку данных заявки по <Link className="s-link" to="/privacy" target="_blank">политике конфиденциальности</Link>: username, ответы и выбранные платформы нужны только для рассмотрения заявки.</span></label>
                {shown('consent') && <span id="f-consent-error" className="s-error">{shown('consent')}</span>}
              </div>
              {formError && <div id="form-error" className="s-form-alert" role="alert"><AlertCircle size={18} />{formError}</div>}
              <button className="s-btn s-btn-primary s-btn-lg s-btn-block" type="submit" disabled={sending} aria-busy={sending}>{sending ? <><span className="s-spinner" aria-hidden="true" />Отправляем…</> : <>Подать заявку<ArrowRight size={18} aria-hidden="true" /></>}</button>
            </form>}
        </div>
        <aside className="s-aside">
          <div className="s-glass s-aside-card"><h2>Как это работает</h2><ol><li>Отправь заявку на этой странице.</li><li>Подтверди аккаунт в боте <a className="s-link" href="https://t.me/oskolokplayerbot" target="_blank" rel="noopener noreferrer">@oskolokplayerbot</a>.</li><li>Мы прочитаем заявку и примем решение.</li><li>Бот пришлёт ответ. Войди в Осколок через тот же Telegram.</li></ol></div>
          <div className="s-glass s-aside-card"><h2>Что получат тестеры</h2><ul><li>Доступ к веб-версии и приложениям для Windows, macOS и Android.</li><li>Сборку для iPhone, когда она будет готова.</li><li>Новые функции раньше всех и прямую связь с разработкой.</li></ul></div>
          <div className="s-glass s-aside-card"><h2>Уже отправлял заявку?</h2><p>Статус хранится в этом браузере и в боте по команде /beta_status.</p><Link className="s-btn s-btn-sm" to="/beta/status" style={{ marginTop: 14 }}>Проверить статус</Link></div>
        </aside>
      </div>
    </div>
  </PageShell>;
}
