import React from 'react';
import { Github, Globe, Instagram, Link2, Plus, Send, Trash2, Twitch, Twitter, Youtube, type LucideIcon } from 'lucide-react';
import { apiClient } from '../../api/apiClient.js';
import { useTranslation } from '../../stores/useLanguageStore.js';

export type SocialPlatform = 'telegram' | 'vk' | 'instagram' | 'youtube' | 'tiktok' | 'x' | 'twitch' | 'discord' | 'github' | 'soundcloud' | 'spotify' | 'yandexMusic' | 'website';
export type SocialLink = { platform: SocialPlatform; url: string };
export type ProfileTheme = 'default' | 'gradient' | 'solid' | 'blur';
export type Visibility = { nowPlaying: boolean; showcase: boolean; lyrics: boolean; stats: boolean };
export type Customization = { accentColor: string | null; theme: ProfileTheme; pronouns: string; location: string; status: { emoji: string; text: string }; socialLinks: SocialLink[]; visibility: Visibility };

export const DEFAULT_CUSTOMIZATION: Customization = { accentColor: null, theme: 'default', pronouns: '', location: '', status: { emoji: '', text: '' }, socialLinks: [], visibility: { nowPlaying: true, showcase: true, lyrics: true, stats: true } };
const STATUS_EMOJI = ['🎧', '🎵', '🔥', '🌙', '💤', '✨', '🖤', '🎸', '🎹', '🛸', '🌊', '☕'];

/** Brand marks: lucide where it has one, a compact monogram otherwise. */
const ICONS: Partial<Record<SocialPlatform, LucideIcon>> = { telegram: Send, instagram: Instagram, youtube: Youtube, x: Twitter, twitch: Twitch, github: Github, website: Globe };
const MONO: Partial<Record<SocialPlatform, string>> = { vk: 'VK', tiktok: 'Tt', discord: 'Ds', soundcloud: 'SC', spotify: 'Sp', yandexMusic: 'Я' };
const NAMES: Record<SocialPlatform, string> = { telegram: 'Telegram', vk: 'ВКонтакте', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', twitch: 'Twitch', discord: 'Discord', github: 'GitHub', soundcloud: 'SoundCloud', spotify: 'Spotify', yandexMusic: 'Яндекс Музыка', website: 'Сайт' };
const HOSTS: Array<[SocialPlatform, RegExp]> = [['telegram', /(^|\.)(t\.me|telegram\.(me|dog))$/], ['vk', /(^|\.)vk\.(com|ru)$/], ['instagram', /(^|\.)instagr(am\.com|\.am)$/], ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/], ['tiktok', /(^|\.)tiktok\.com$/], ['x', /(^|\.)(x|twitter)\.com$/], ['twitch', /(^|\.)twitch\.tv$/], ['discord', /(^|\.)discord(app)?\.(com|gg)$/], ['github', /(^|\.)github\.com$/], ['soundcloud', /(^|\.)soundcloud\.com$/], ['spotify', /(^|\.)spotify\.(com|link)$/], ['yandexMusic', /(^|\.)music\.yandex\./]];
export function detectPlatform(value: string): SocialPlatform {
  if (/^@[A-Za-z0-9_]{4,32}$/.test(value.trim())) return 'telegram';
  try { const host = new URL(/^[a-z]+:/i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^(www|m)\./, ''); return HOSTS.find(([, re]) => re.test(host))?.[0] || 'website'; } catch { return 'website'; }
}

export function SocialIcon({ platform, size = 16 }: { platform: SocialPlatform; size?: number }) {
  const Icon = ICONS[platform];
  return Icon ? <Icon size={size} aria-hidden="true" /> : <span className="social-mono" style={{ fontSize: size * .62 }} aria-hidden="true">{MONO[platform] || <Link2 size={size} />}</span>;
}

/** Round icon buttons, like the contact row on the reference card. Discord is a copyable handle. */
export function SocialLinks({ links, className = '' }: { links?: SocialLink[]; className?: string }) {
  const t = useTranslation();
  if (!links?.length) return null;
  return <div className={`social-links ${className}`}>{links.map((link, i) => link.platform === 'discord' && !/^https?:/.test(link.url)
    ? <button key={i} type="button" className="social-link social-link--wide" title={`Discord: ${link.url}`} onClick={() => void navigator.clipboard?.writeText(link.url)} aria-label={t(`Скопировать Discord ${link.url}`, `Copy Discord ${link.url}`)}><SocialIcon platform="discord" /><span>{link.url}</span></button>
    : <a key={i} className="social-link" href={link.url} target="_blank" rel="noopener noreferrer nofollow" title={NAMES[link.platform]} aria-label={NAMES[link.platform]}><SocialIcon platform={link.platform} /></a>)}</div>;
}

/** Inline style that carries the profile accent to whatever renders the profile. */
export const accentStyle = (c?: Customization | null): React.CSSProperties | undefined => c?.accentColor ? { '--profile-accent': c.accentColor } as React.CSSProperties : undefined;

export function ProfileStatus({ c }: { c?: Customization | null }) {
  if (!c || (!c.status.emoji && !c.status.text)) return null;
  return <p className="profile-status-line">
    {(c.status.emoji || c.status.text) && <span className="profile-status">{c.status.emoji && <span aria-hidden="true">{c.status.emoji}</span>}{c.status.text}</span>}
  </p>;
}

/** Settings block: look, status and links. Saves to PATCH /profile/customization. */
export function ProfileCustomizationEditor({ value, onSaved }: { value?: Customization | null; onSaved: (c: Customization) => void }) {
  const t = useTranslation();
  const [draft, setDraft] = React.useState<Customization>(value || DEFAULT_CUSTOMIZATION), [newLink, setNewLink] = React.useState(''), [state, setState] = React.useState<'' | 'saving' | 'saved'>(''), [error, setError] = React.useState('');
  React.useEffect(() => { if (value) setDraft(value); }, [value]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value || DEFAULT_CUSTOMIZATION);
  const set = (patch: Partial<Customization>) => { setDraft(d => ({ ...d, ...patch })); setState(''); };
  const addLink = () => {
    const raw = newLink.trim(); if (!raw) return;
    if (draft.socialLinks.length >= 10) { setError(t('Не больше 10 ссылок.', 'Up to 10 links.')); return; }
    set({ socialLinks: [...draft.socialLinks, { platform: detectPlatform(raw), url: raw }] }); setNewLink(''); setError('');
  };
  const save = async () => {
    setState('saving'); setError('');
    try {
      const saved = await apiClient.request<Customization>('/profile/customization', { method: 'PATCH', body: JSON.stringify({ statusEmoji: draft.status.emoji, statusText: draft.status.text, socialLinks: draft.socialLinks, visibility: draft.visibility }) });
      setDraft(saved); onSaved(saved); setState('saved');
    } catch (e) { setError((e as Error).message); setState(''); }
  };
  const vis: Array<[keyof Visibility, string]> = [['nowPlaying', t('Что я слушаю сейчас', 'What I’m playing now')], ['showcase', t('Витрина треков', 'Track showcase')], ['lyrics', t('Мои тексты', 'My lyrics')], ['stats', t('Статистика в карточке', 'Stats on my card')]];
  return <section className="set-group profile-custom" style={accentStyle(draft)}>
    <h4>{t('Статус и ссылки', 'Status & links')}</h4>
    <div className="set-row set-row--stack"><span>{t('Статус', 'Status')}<small>{t('Короткая строка под ником', 'A short line under your name')}</small></span>
      <div className="profile-status-edit">
        <div className="profile-emoji">{STATUS_EMOJI.map(e => <button key={e} type="button" aria-pressed={draft.status.emoji === e} onClick={() => set({ status: { ...draft.status, emoji: draft.status.emoji === e ? '' : e } })}>{e}</button>)}</div>
        <input aria-label={t('Текст статуса', 'Status text')} value={draft.status.text} maxLength={80} placeholder={t('Например: пишу альбом', 'e.g. writing an album')} onChange={e => set({ status: { ...draft.status, text: e.target.value } })} />
      </div></div>
    <div className="set-row set-row--stack"><span>{t('Ссылки на соцсети', 'Social links')}<small>{t('Telegram, VK, Instagram, YouTube, TikTok, X, Twitch, Discord, GitHub, SoundCloud, Spotify, Яндекс Музыка или свой сайт — до 10', 'Telegram, VK, Instagram, YouTube, TikTok, X, Twitch, Discord, GitHub, SoundCloud, Spotify, Yandex Music or your site — up to 10')}</small></span>
      <ul className="profile-links-edit">{draft.socialLinks.map((link, i) => <li key={i}><SocialIcon platform={link.platform} /><input value={link.url} onChange={e => { const list = [...draft.socialLinks]; list[i] = { platform: detectPlatform(e.target.value), url: e.target.value }; set({ socialLinks: list }); }} aria-label={NAMES[link.platform]} /><button type="button" className="text-button" onClick={() => set({ socialLinks: draft.socialLinks.filter((_, j) => j !== i) })} aria-label={t('Удалить ссылку', 'Remove link')}><Trash2 size={14} /></button></li>)}</ul>
      <div className="profile-link-add"><input value={newLink} placeholder={t('https://… или @ник в Telegram', 'https://… or a Telegram @handle')} onChange={e => setNewLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }} /><button type="button" className="profile-btn" onClick={addLink} disabled={!newLink.trim()}><Plus size={14} />{t('Добавить', 'Add')}</button></div>
    </div>
    <div className="set-row set-row--stack"><span>{t('Что видят другие', 'What others see')}</span>
      <div className="profile-vis">{vis.map(([k, label]) => <label key={k} className="set-switch-inline"><input type="checkbox" role="switch" checked={draft.visibility[k]} onChange={e => set({ visibility: { ...draft.visibility, [k]: e.target.checked } })} />{label}</label>)}</div></div>
    {error && <p className="set-note" role="alert">{error}</p>}
    <div className="profile-custom-actions"><span aria-live="polite">{state === 'saved' && !dirty ? t('Сохранено', 'Saved') : ''}</span><button type="button" className="primary-button" disabled={!dirty || state === 'saving'} onClick={() => void save()}>{state === 'saving' ? t('Сохраняем…', 'Saving…') : t('Сохранить оформление', 'Save look')}</button></div>
  </section>;
}
