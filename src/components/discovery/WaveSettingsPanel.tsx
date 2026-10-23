import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { X, RotateCcw, Play, Gem, Library, Sparkles, Sunrise, Briefcase, Dumbbell, Car, Moon, type LucideIcon } from 'lucide-react';
import LumaSpin from '../ui/luma-spin.js';
import { ResonanceOrb, IDLE_PALETTE } from './ResonanceOrb.js';
import { apiClient } from '../../api/apiClient.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useLibraryStore } from '../../stores/useLibraryStore.js';
import { usePlaylistStore } from '../../stores/usePlaylistStore.js';
import { useShallow } from 'zustand/react/shallow';
import { useThemeStore } from '../../stores/useThemeStore.js';
import { useTranslation } from '../../stores/useLanguageStore.js';
import { paletteFromArtwork, type Rgb } from '../../utils/releasePalette.js';
import { DEFAULT_WAVE_SETTINGS, MUSIC_LANGS, WAVE_MODES, WAVE_ACTIVITIES, type WaveActivity, cachedWaveCatalog, fetchWaveCatalog, validateAgainst, waveSourceState, type MusicLang, type WaveCatalog, type WaveChoice, type WaveEngine, type WaveMode } from '../../stores/waveSettings.js';
import './wave-settings.css';

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
const NO_PREFS = { ru: { subgenre: null, mood: null }, en: { subgenre: null, mood: null }, ja: { subgenre: null, mood: null } };

/* Every mood has its own light: the orb and the mood swatches use the same three colours. */
const MOOD_LIGHT: Record<string, { palette: Rgb[]; energy: number }> = {
  calm: { palette: [[0.2, 0.45, 0.95], [0.35, 0.7, 1], [0.6, 0.9, 1]], energy: 0.15 },
  energetic: { palette: [[1, 0.3, 0.2], [1, 0.55, 0.15], [1, 0.82, 0.3]], energy: 0.95 },
  melancholic: { palette: [[0.3, 0.22, 0.7], [0.52, 0.38, 0.95], [0.75, 0.6, 1]], energy: 0.3 },
  bright: { palette: [[1, 0.62, 0.2], [1, 0.84, 0.25], [1, 0.95, 0.6]], energy: 0.7 },
  uplifting: { palette: [[1, 0.45, 0.55], [1, 0.72, 0.35], [1, 0.92, 0.55]], energy: 0.75 },
  inspiring: { palette: [[0.95, 0.4, 0.7], [1, 0.65, 0.45], [1, 0.9, 0.55]], energy: 0.7 },
  atmospheric: { palette: [[0.08, 0.45, 0.55], [0.18, 0.75, 0.75], [0.55, 0.95, 0.85]], energy: 0.4 },
};
const ACTIVITY_ICON: Record<WaveActivity, LucideIcon> = { wake: Sunrise, work: Briefcase, workout: Dumbbell, road: Car, sleep: Moon };
/* An activity tints the orb when no mood is chosen. */
const ACTIVITY_LIGHT: Record<WaveActivity, { palette: Rgb[]; energy: number }> = {
  wake: { palette: [[1, 0.55, 0.35], [1, 0.75, 0.4], [1, 0.92, 0.7]], energy: 0.5 },
  work: { palette: [[0.2, 0.5, 0.6], [0.3, 0.7, 0.75], [0.7, 0.92, 0.9]], energy: 0.3 },
  workout: { palette: [[0.95, 0.15, 0.3], [1, 0.4, 0.2], [1, 0.75, 0.25]], energy: 1 },
  road: { palette: [[0.35, 0.3, 0.9], [0.9, 0.4, 0.6], [1, 0.7, 0.45]], energy: 0.6 },
  sleep: { palette: [[0.1, 0.12, 0.4], [0.25, 0.3, 0.7], [0.55, 0.6, 0.95]], energy: 0.05 },
};
const rgb = (c: Rgb) => `rgb(${c.map(v => Math.round(v * 255)).join(' ')})`;
const hsl = (h: number, s: number, l: number): Rgb => {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
};
/** Three vivid colours of a cover (greys say little about a cover). */
const vivid = (colors: Rgb[]): Rgb[] => {
  const sat = (c: Rgb) => Math.max(...c) - Math.min(...c);
  const picked = [...colors].sort((a, b) => sat(b) - sat(a)).slice(0, 3);
  return picked.length === 3 && sat(picked[2]) > 0.12 ? picked : [...IDLE_PALETTE];
};
/** Yandex «Моя волна» cannot express Japanese or «из коллекции»; Осколок's builder serves those. */
const yandexServes = (lang: MusicLang | 'all', mode: WaveMode | null) => lang !== 'ja' && mode !== 'collection';

interface WaveSettingsPanelProps { open: boolean; onClose: () => void }

/** «Резонанс» settings, in the shape of Yandex «Настроить Мою волну»: a living orb on top, then groups
 * of one-tap choices that apply at once. Language → its own subgenres and moods; character; source. */
export const WaveSettingsPanel: React.FC<WaveSettingsPanelProps> = ({ open, onClose }) => {
  const t = useTranslation(), reduced = useReducedMotion(), titleId = useId();
  const panel = useRef<HTMLDivElement>(null), close = useRef(onClose);
  close.current = onClose;
  const { waveSettings, setWaveSettings, isWaveActive, isStartingWave, startMyWave, waveStatus, waveMessage, currentTrack } = usePlayerStore(useShallow(s => ({ waveSettings: s.waveSettings, setWaveSettings: s.setWaveSettings, isWaveActive: s.isWaveActive && s.waveKind === 'settings', isStartingWave: s.isStartingWave, startMyWave: s.startMyWave, waveStatus: s.waveStatus, waveMessage: s.waveMessage, currentTrack: s.currentTrack })));
  const isDark = useThemeStore(s => s.isDark);
  const likedCount = useLibraryStore(s => s.likedTracks.length);
  const playlistTracks = usePlaylistStore(s => (Array.isArray(s.playlists) ? s.playlists : []).reduce((n, p) => n + (p.tracks?.length || 0), 0));
  const catalogQuery = useQuery({ queryKey: ['wave-catalog'], queryFn: fetchWaveCatalog, initialData: cachedWaveCatalog() ?? undefined, staleTime: 6 * 60 * 60 * 1000, enabled: open, retry: 2 });
  const catalog: WaveCatalog | null = catalogQuery.data ?? null;
  const accountsQuery = useQuery({ queryKey: ['music-accounts'], queryFn: () => apiClient.request<Array<{ id: string; connected: boolean }>>('/music-accounts'), enabled: open, staleTime: 60_000, retry: 1 });
  const yandexConnected = !!accountsQuery.data?.some(a => a.id === 'yandex' && a.connected) || waveSourceState.yandexConnected;

  // A saved subgenre the server no longer offers becomes «без ограничения» instead of an empty wave.
  useEffect(() => {
    if (!catalog) return;
    const valid = validateAgainst(waveSettings, catalog);
    if (JSON.stringify(valid.perLanguage) !== JSON.stringify(waveSettings.perLanguage)) setWaveSettings({ perLanguage: valid.perLanguage });
  }, [catalog, waveSettings, setWaveSettings]);

  // Focus trap, Esc, body scroll lock, focus restore.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const { overflow, paddingRight } = document.body.style;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (gutter > 0) document.body.style.paddingRight = `${gutter}px`;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus() ?? panel.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const controls = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.getClientRects().length > 0 && el.tabIndex >= 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); panel.current.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow; document.body.style.paddingRight = paddingRight;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  const label = (o: { ru: string; en: string }) => t(o.ru, o.en);
  const lang = waveSettings.language;
  const prefs = lang === 'all' ? null : waveSettings.perLanguage[lang];
  const choices = lang === 'all' || !catalog ? null : catalog[lang];
  const langOption = MUSIC_LANGS.find(l => l.id === lang);
  const modeOption = WAVE_MODES.find(m => m.id === waveSettings.mode);
  const subOption = choices?.subgenres.find(s => s.id === prefs?.subgenre), moodOption = choices?.moods.find(m => m.id === prefs?.mood);
  const activityOption = WAVE_ACTIVITIES.find(a => a.id === waveSettings.activity);
  const summary = [activityOption && label(activityOption), langOption ? label(langOption) : t('Любой язык', 'Any language'), subOption && label(subOption), moodOption && label(moodOption), modeOption && label(modeOption)].filter(Boolean).join(' · ');
  const isDefault = lang === 'all' && waveSettings.mode === null && !waveSettings.activity && Object.values(waveSettings.perLanguage).every(p => !p.subgenre && !p.mood);
  const collectionSize = likedCount + playlistTracks;
  const usesYandex = yandexConnected && waveSettings.engine === 'yandex' && yandexServes(lang, waveSettings.mode);

  const setLang = (code: MusicLang | 'all') => setWaveSettings({ language: code });
  const setMode = (mode: WaveMode | null) => setWaveSettings({ mode });
  const setEngine = (engine: WaveEngine) => setWaveSettings({ engine });
  const setPref = (patch: Partial<{ subgenre: string | null; mood: string | null }>) => {
    if (lang === 'all') return;
    setWaveSettings({ perLanguage: { ...waveSettings.perLanguage, [lang]: { ...waveSettings.perLanguage[lang], ...patch } } });
  };

  // Orb colours: the chosen mood's light; otherwise the Yandex hue of the track; otherwise the playing cover.
  const [cover, setCover] = useState<Rgb[] | null>(null);
  useEffect(() => {
    let live = true;
    if (!open || !currentTrack?.artworkUrl) { setCover(null); return; }
    void paletteFromArtwork(currentTrack.artworkUrl).then(colors => { if (live) setCover(vivid(colors)); });
    return () => { live = false; };
  }, [open, currentTrack?.artworkUrl]);
  const light = prefs?.mood ? MOOD_LIGHT[prefs.mood] : waveSettings.activity ? ACTIVITY_LIGHT[waveSettings.activity] : undefined;
  const hue = currentTrack?.vibe?.hue;
  const orbPalette = useMemo<Rgb[]>(() => light?.palette
    ?? (typeof hue === 'number' ? [hsl(hue, .85, .45), hsl((hue + 25) % 360, .9, .58), hsl((hue + 50) % 360, .95, .72)] : cover ?? [...IDLE_PALETTE]), [light, hue, cover]);
  const energy = currentTrack?.vibe?.energy ?? light?.energy ?? (waveSettings.mode === 'niche' ? .6 : .45);

  // Arrow keys move along a choice group, like native radios.
  const radioKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const index = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = radios[(index + keys[event.key] + radios.length) % radios.length];
    next.focus(); next.click();
  };
  const radio = (checked: boolean, onPick: () => void, className: string, children: React.ReactNode, key: string) =>
    <button key={key} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1}
      className={`${className}${checked ? ' is-active' : ''}`} onClick={() => { if (!checked) onPick(); }}>{children}</button>;
  const group = (title: string, children: React.ReactNode, className = 'wave-chips', hint?: React.ReactNode) =>
    <section className="wave-group">
      <h3>{title}</h3>
      <div role="radiogroup" aria-label={title} className={className} onKeyDown={radioKeys}>{children}</div>
      {hint}
    </section>;
  const chips = (list: WaveChoice[], value: string | null, anyLabel: string, onPick: (id: string | null) => void) =>
    [null, ...list].map(option => radio((value || null) === (option?.id || null), () => onPick(option?.id || null), 'wave-chip', option ? label(option) : anyLabel, option?.id || 'any'));

  const listen = async () => { if (!isWaveActive) await startMyWave(); if (usePlayerStore.getState().waveStatus !== 'empty') onClose(); };
  const ease = [0.16, 1, 0.3, 1] as const;

  return createPortal(<AnimatePresence>
    {open && <div className={`wave-panel-root${isDark ? ' is-dark' : ''}`}>
      <motion.div className="wave-panel-backdrop" onClick={onClose} aria-hidden="true"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .24 }} />
      <motion.div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="wave-sheet"
        initial={{ opacity: 0, y: reduced ? 0 : 28 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reduced ? 0 : 20 }} transition={{ duration: reduced ? .01 : .42, ease }}>
        <header className="wave-sheet-head">
          <h2 id={titleId}>{t('Настроить Резонанс', 'Tune Resonance')}</h2>
          <div className="wave-sheet-head-actions">
            <button type="button" className="wave-icon-button is-outline" disabled={isDefault} onClick={() => setWaveSettings({ ...DEFAULT_WAVE_SETTINGS, perLanguage: NO_PREFS, engine: waveSettings.engine })}
              aria-label={t('Сбросить настройки', 'Reset settings')} title={t('Сбросить настройки', 'Reset settings')}><RotateCcw size={15} /></button>
            <button type="button" className="wave-icon-button" onClick={onClose} aria-label={t('Закрыть настройки Резонанса', 'Close wave settings')}><X size={18} /></button>
          </div>
        </header>

        <div className="wave-sheet-scroll">
          <div className="wave-hero">
            <ResonanceOrb palette={orbPalette} energy={energy} isDark={isDark} active={open} className="wave-hero-orb" />
            <div className="wave-hero-caption">
              <p aria-live="polite">{summary}</p>
              <small>{usesYandex ? t('Подбирает «Моя волна» Яндекса', 'Picked by Yandex «My Wave»') : t('Подбирает Осколок', 'Picked by Осколок')}</small>
            </div>
          </div>

          {yandexConnected && group(t('Источник', 'Source'), <>
            {radio(waveSettings.engine === 'yandex', () => setEngine('yandex'), 'wave-segment', <><b>{t('Моя волна Яндекса', 'Yandex My Wave')}</b><small>{t('Лайки и пропуски учат вашу волну', 'Likes and skips teach your wave')}</small></>, 'yandex')}
            {radio(waveSettings.engine === 'oskolok', () => setEngine('oskolok'), 'wave-segment', <><b>{t('Подбор Осколка', 'Осколок picks')}</b><small>{t('Каталог и вкус в Осколке', 'Catalogue and taste in Осколок')}</small></>, 'oskolok')}
          </>, 'wave-segments', waveSettings.engine === 'yandex' && !yandexServes(lang, waveSettings.mode)
            ? <p className="wave-note">{t('Японскую музыку и режим «Из коллекции» Яндекс не подбирает — здесь работает подбор Осколка.', 'Yandex does not cover Japanese music or «From your collection»; Осколок picks these.')}</p> : null)}

          {group(t('Занятие', 'Activity'), [
            radio(!waveSettings.activity, () => setWaveSettings({ activity: null }), 'wave-chip', t('Просто слушаю', 'Just listening'), 'none'),
            ...WAVE_ACTIVITIES.map(option => { const Icon = ACTIVITY_ICON[option.id]; return radio(waveSettings.activity === option.id, () => setWaveSettings({ activity: option.id }), 'wave-chip', <><Icon size={15} aria-hidden="true" />{label(option)}</>, option.id); }),
          ], 'wave-chips wave-chips--scroll')}

          {group(t('Язык', 'Language'), [
            radio(lang === 'all', () => setLang('all'), 'wave-chip', t('Любой', 'Any'), 'all'),
            ...MUSIC_LANGS.map(option => radio(lang === option.id, () => setLang(option.id), 'wave-chip', <><span className="wave-chip-code" aria-hidden="true">{option.code}</span>{label(option)}</>, option.id)),
          ])}

          {group(t('Характер', 'Character'), [
            radio(waveSettings.mode === null, () => setMode(null), 'wave-card', <><Sparkles size={18} aria-hidden="true" /><b>{t('Обычный', 'Regular')}</b><small>{t('Любимое вперемешку с новым', 'Favourites mixed with new finds')}</small></>, 'regular'),
            ...WAVE_MODES.map(option => {
              const Icon = option.id === 'niche' ? Gem : Library;
              const hint = option.id === 'collection' ? (collectionSize ? t(`${collectionSize} треков в лайках и плейлистах`, `${collectionSize} tracks in likes and playlists`) : t('Коллекция пока пуста', 'Your collection is empty')) : t(option.hint[0], option.hint[1]);
              return radio(waveSettings.mode === option.id, () => setMode(option.id), 'wave-card', <><Icon size={18} aria-hidden="true" /><b>{label(option)}</b><small>{hint}</small></>, option.id);
            }),
          ], 'wave-cards')}

          {lang === 'all'
            ? <p className="wave-note">{t('Выберите язык — у каждого языка свои поджанры и настроения.', 'Pick a language — each has its own subgenres and moods.')}</p>
            : !choices
              ? <div className="wave-skeleton" aria-busy="true" aria-label={t('Загружаем настройки', 'Loading settings')}>
                  {[0, 1].map(g => <div key={g}><span className="skeleton-line" /><div>{Array.from({ length: 5 }, (_, i) => <span key={i} className="skeleton-chip" />)}</div></div>)}
                  {catalogQuery.isError && <p className="wave-note">{t('Не удалось загрузить поджанры.', 'Could not load subgenres.')} <button type="button" className="text-button" onClick={() => void catalogQuery.refetch()}>{t('Повторить', 'Retry')}</button></p>}
                </div>
              : <>
                  {group(t('Настроение', 'Mood'), [null, ...choices.moods].map(option => {
                    const checked = (prefs!.mood || null) === (option?.id || null), swatch = option ? MOOD_LIGHT[option.id]?.palette : null;
                    return radio(checked, () => setPref({ mood: option?.id || null }), 'wave-mood', <>
                      <span className="wave-mood-swatch" aria-hidden="true" style={swatch ? { background: `radial-gradient(circle at 35% 30%, ${rgb(swatch[2])}, ${rgb(swatch[1])} 45%, ${rgb(swatch[0])})` } : undefined} />
                      <span>{option ? label(option) : t('Любое', 'Any')}</span>
                    </>, option?.id || 'any');
                  }), 'wave-moods')}
                  {group(t('Поджанр и направление', 'Subgenre'), chips(choices.subgenres, prefs!.subgenre, t('Любой', 'Any'), id => setPref({ subgenre: id })))}
                  <p className="wave-note">{t('Язык определяется по письменности названий и известным артистам. Настроение — по тематическим плейлистам и соседям артистов, это приблизительный признак. Аниме-песни подтверждаются базой AnimeThemes.',
                    'Language is read from title script and known artists. Mood comes from themed playlists and related artists — an approximation. Anime songs are confirmed by AnimeThemes.')}</p>
                </>}

          {waveSettings.mode === 'collection' && !collectionSize && <p className="wave-warning" role="status">{t('В коллекции пока нет треков: в режиме «Из коллекции» нечего играть.', 'Your collection is empty: nothing to play «from your collection».')}
            <button type="button" className="text-button" onClick={() => setMode(null)}>{t('Обычный подбор', 'Regular mix')}</button></p>}
          {waveStatus === 'empty' && waveMessage && <p className="wave-warning" role="status">{waveMessage}
            {prefs && (prefs.subgenre || prefs.mood) && <button type="button" className="text-button" onClick={() => setPref({ subgenre: null, mood: null })}>{t('Снять поджанр и настроение', 'Clear subgenre and mood')}</button>}
            {waveSettings.mode && <button type="button" className="text-button" onClick={() => setMode(null)}>{t('Обычный подбор', 'Regular mix')}</button>}</p>}
        </div>

        <footer className="wave-sheet-foot">
          <p aria-live="polite">
            {isStartingWave ? t('Подбираем треки…', 'Picking tracks…')
              : isWaveActive ? t('Следующие треки уже под новые настройки.', 'What follows matches the new settings.')
              : t('Настройки сохраняются сразу.', 'Settings are saved at once.')}
          </p>
          <button type="button" className="wave-primary" onClick={listen} disabled={isStartingWave} aria-busy={isStartingWave}>
            {isStartingWave ? <LumaSpin size="sm" label={t('Запускаем Резонанс', 'Starting Resonance')} /> : isWaveActive ? null : <Play size={16} fill="currentColor" />}
            {isWaveActive ? t('Готово', 'Done') : t('Слушать', 'Listen')}
          </button>
        </footer>
      </motion.div>
    </div>}
  </AnimatePresence>, document.body);
};

export default WaveSettingsPanel;
