import React from 'react';
import { RotateCcw, Moon, Blend } from 'lucide-react';
import { SLEEP_PRESETS, useSleepTimer, startSleepTimer, startEndOfTrackTimer, cancelSleepTimer, sleepTimerActive, formatRemaining } from '../../audio/sleepTimer.js';
import { Modal } from '../common/Modal.js';
import { EqualizerPanel } from '../settings/EqualizerPanel.js';
import { audioManager } from '../../audio/AudioManager.js';
import { DEFAULT_EFFECTS, SPEED_PRESETS, type MediaEffects } from '../../audio/mediaEffects.js';
import { libraryActions } from '../../telemetry/bus.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';

export const formatSpeed = (v: number) => `${String(Math.round(v * 100) / 100).replace('.', ',')}×`;
let speedEventTimer: ReturnType<typeof setTimeout> | undefined;
import { useTranslation } from '../../stores/useLanguageStore.js';

/** «Звук» on the player bar: speed, pitch and reverb on top, the equalizer below. Settings stay for the next tracks. */
export function MediaSettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslation();
  const [fx, setFx] = React.useState<MediaEffects>(() => audioManager.getEffects());
  React.useEffect(() => { if (open) setFx(audioManager.getEffects()); }, [open]);
  const update = (next: Partial<MediaEffects>) => { audioManager.setEffects(next); setFx(audioManager.getEffects()); };
  // Speed is listening context, not a verdict on the track: one event once the listener settles on a value.
  const setSpeed = (speed: number) => {
    update({ speed });
    clearTimeout(speedEventTimer);
    speedEventTimer = setTimeout(() => libraryActions.emit('speed_change', usePlayerStore.getState().currentTrack, { speed: audioManager.getEffects().speed }), 1200);
  };
  const webAudio = audioManager.equalizerSupported();
  const changed = fx.speed !== 1 || fx.pitch !== 0 || fx.reverb !== 0 || !fx.preservePitch;
  const percent = (v: number) => `${Math.round(v * 100)}%`;
  return <Modal isOpen={open} onClose={onClose} title={t('Звук', 'Sound')} className="max-w-lg media-settings-modal">
    <SleepTimerSection />
    <CrossfadeSection />
    <div className="media-fx">
      <div className="media-fx-row">
        <span>{t('Скорость', 'Speed')}<b className={fx.speed !== 1 ? 'is-changed' : ''}>{formatSpeed(fx.speed)}</b></span>
        <div className="media-fx-presets" role="radiogroup" aria-label={t('Скорость воспроизведения', 'Playback speed')}>
          {SPEED_PRESETS.map(value => <button key={value} type="button" role="radio" aria-checked={fx.speed === value} className={fx.speed === value ? 'is-active' : ''} onClick={() => setSpeed(value)}>{formatSpeed(value)}</button>)}
        </div>
        <input type="range" min={0.5} max={2} step={0.05} value={fx.speed} aria-label={t('Точная скорость', 'Fine speed')} onChange={e => setSpeed(Number(e.target.value))} style={{ '--p': `${(fx.speed - 0.5) / 1.5 * 100}%` } as React.CSSProperties} />
        {fx.speed !== 1 && <button type="button" className="text-button media-fx-one" onClick={() => setSpeed(1)}>{t('Вернуть 1×', 'Back to 1×')}</button>}
      </div>
      <label className="media-fx-check">
        <input type="checkbox" checked={!fx.preservePitch} onChange={e => update({ preservePitch: !e.target.checked })} />
        <span>{t('Как пластинка: тон меняется вместе со скоростью (slowed / speed up)', 'Like a record: pitch follows speed (slowed / sped up)')}</span>
      </label>
      <label className={`media-fx-row${webAudio ? '' : ' is-off'}`}>
        <span>{t('Тон', 'Pitch')}<b>{fx.pitch > 0 ? `+${fx.pitch}` : fx.pitch} {t('пт.', 'st')}</b></span>
        <input type="range" min={-6} max={6} step={1} value={fx.pitch} disabled={!webAudio} onChange={e => update({ pitch: Number(e.target.value) })} style={{ '--p': `${(fx.pitch + 6) / 12 * 100}%` } as React.CSSProperties} />
      </label>
      <label className={`media-fx-row${webAudio ? '' : ' is-off'}`}>
        <span>{t('Реверберация', 'Reverb')}<b>{percent(fx.reverb)}</b></span>
        <input type="range" min={0} max={1} step={0.05} value={fx.reverb} disabled={!webAudio} onChange={e => update({ reverb: Number(e.target.value) })} style={{ '--p': percent(fx.reverb) } as React.CSSProperties} />
      </label>
      {!webAudio && <small className="media-fx-note">{t('На этом устройстве доступна только скорость: браузер не пускает звук через обработку.', 'Only speed is available on this device: the browser does not allow audio processing.')}</small>}
      <button type="button" className="sg-btn media-fx-reset" disabled={!changed} onClick={() => update(DEFAULT_EFFECTS)}><RotateCcw size={14} />{t('Сбросить эффекты', 'Reset effects')}</button>
    </div>
    <div className="set-eq media-fx-eq"><h4>{t('Эквалайзер', 'Equalizer')}</h4><EqualizerPanel /></div>
  </Modal>;
}

/** «Таймер сна»: minutes with a soft fade at the end, or until the current track ends. */
function SleepTimerSection() {
  const t = useTranslation();
  const timer = useSleepTimer();
  const [, tick] = React.useState(0);
  React.useEffect(() => { if (!timer.endsAt) return; const id = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(id); }, [timer.endsAt]);
  const active = sleepTimerActive(timer);
  return <section className="sleep-timer" aria-labelledby="sleep-timer-title">
    <div className="sleep-timer__head">
      <span className="sleep-timer__icon" aria-hidden="true"><Moon size={16} /></span>
      <h4 id="sleep-timer-title">{t('Таймер сна', 'Sleep timer')}</h4>
      {active && <b className="sleep-timer__left" role="status">{timer.endOfTrack ? t('после этого трека', 'after this track') : t(`ещё ${formatRemaining((timer.endsAt || 0) - Date.now())}`, `${formatRemaining((timer.endsAt || 0) - Date.now())} left`)}</b>}
    </div>
    <div className="media-fx-presets" role="radiogroup" aria-label={t('Остановить музыку через', 'Stop music in')}>
      <button type="button" role="radio" aria-checked={!active} className={!active ? 'is-active' : ''} onClick={cancelSleepTimer}>{t('Выкл', 'Off')}</button>
      {SLEEP_PRESETS.map(m => <button key={m} type="button" role="radio" aria-checked={timer.minutes === m} className={timer.minutes === m ? 'is-active' : ''} onClick={() => startSleepTimer(m)}>{m} {t('мин', 'min')}</button>)}
      <button type="button" role="radio" aria-checked={timer.endOfTrack} className={timer.endOfTrack ? 'is-active' : ''} onClick={startEndOfTrackTimer}>{t('Конец трека', 'End of track')}</button>
    </div>
  </section>;
}

/** «Плавный переход»: the next track rises while the current one fades out (0 = tracks follow each other). */
function CrossfadeSection() {
  const t = useTranslation();
  const [value, setValue] = React.useState(() => audioManager.getCrossfade());
  const supported = audioManager.crossfadeSupported();
  const set = (v: number) => { audioManager.setCrossfade(v); setValue(v); };
  return <section className="sleep-timer" aria-labelledby="crossfade-title">
    <div className="sleep-timer__head">
      <span className="sleep-timer__icon" aria-hidden="true"><Blend size={16} /></span>
      <h4 id="crossfade-title">{t('Плавный переход между треками', 'Crossfade')}</h4>
      {value > 0 && supported && <b className="sleep-timer__left">{t(`${value} с`, `${value} s`)}</b>}
    </div>
    {supported ? <div className="media-fx-presets" role="radiogroup" aria-label={t('Длительность перехода', 'Crossfade length')}>
      {[0, 3, 6, 9, 12].map(v => <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-active' : ''} onClick={() => set(v)}>{v ? t(`${v} с`, `${v} s`) : t('Выкл', 'Off')}</button>)}
    </div> : <small className="media-fx-note">{t('На iPhone и iPad браузер не даёт менять громкость трека — треки идут друг за другом без перехода.', 'On iPhone and iPad the browser does not let us change a track’s volume, so tracks simply follow each other.')}</small>}
  </section>;
}
