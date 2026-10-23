import {useReportStore} from '../components/common/ReportDialog.js';
import {useTranslation} from '../stores/useLanguageStore.js';
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Play, Pause, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { useShallow } from 'zustand/react/shallow';
import { useThemeStore } from '../stores/useThemeStore.js';
import { HomeTrackWidget } from '../components/player/HomeTrackWidget.js';
// The shattered-glass settings panel (and its shard atlas) loads only when opened.
const WaveSettingsPanel = React.lazy(() => import('../components/discovery/WaveSettingsPanel.js').then(m => ({ default: m.WaveSettingsPanel })));
import {ShinyButton} from '../components/ui/shiny-button.js';
import UniqueLoading from '../components/ui/morph-loading.js';
import { HomeCharts } from '../components/discovery/HomeCharts.js';
import { HomeForYou } from '../components/discovery/HomeForYou.js';
import { CenterPulseWave } from '../components/discovery/CenterPulseWave.js';
import { useAudioLevels } from '../audio/audioLevels.js';

export const HomePage: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    isWaveActive,
    isStartingWave,
    startMyWave,
  } = usePlayerStore(useShallow(s => ({ currentTrack: s.currentTrack, isPlaying: s.isPlaying, togglePlay: s.togglePlay, isWaveActive: s.isWaveActive, isStartingWave: s.isStartingWave, startMyWave: s.startMyWave })));
  const { isDark } = useThemeStore();

  const t=useTranslation();
  const reducedMotion = useReducedMotion();
  const [waveStarted,setWaveStarted] = useState(isWaveActive);
  const [isHoveringCenter, setIsHoveringCenter] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // The wordmark's hairlines and halo breathe with the kick of whatever is playing.
  const wordmarkRef = React.useRef<HTMLSpanElement>(null);
  useAudioLevels(l => wordmarkRef.current?.style.setProperty('--beat', Math.min(1, l.beat * .8 + l.bass * .35).toFixed(3)));

  const handleWaveAction = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setWaveStarted(true);
    if (isWaveActive) {
      togglePlay();
    } else {
      // No options: the wave starts with the saved panel settings.
      await startMyWave();
    }
  };

  return (
    <div className="home-page">
    <section className="original-home relative w-full h-full flex flex-col items-center justify-center select-none overflow-hidden">
      {/* Center Stage: Hero Typography & Decorative Wave */}
      <div className="relative z-20 flex flex-col items-center justify-center px-6 text-center">
        {/* Main Text (Section 1: "найди новый осколок \n для своего плейлиста") */}
        <div
          onMouseEnter={() => setIsHoveringCenter(true)}
          onMouseLeave={() => setIsHoveringCenter(false)}
          className="group flex flex-col items-center"
        >
          <motion.h1
            initial={{ opacity: 0, y: 22, scale: 0.95, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
            transition={{ duration: 1.0, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="sg-hero-title"
          >
            <span className="sg-hero-line">{t('найди новый','find a new')}</span>
            <span className="sg-wordmark" data-text={t('осколок','shard')} ref={wordmarkRef}>
              <i className="sg-wordmark-glow" aria-hidden="true" />
              <i className="sg-flare sg-flare--l" aria-hidden="true" />
              <span className="sg-wordmark-text">{t('осколок','shard')}</span>
              <i className="sg-flare sg-flare--r" aria-hidden="true" />
            </span>
            <span className="sg-hero-line">{t('для своего плейлиста','for your playlist')}</span>
          </motion.h1>

          {/* Decorative Waveform Line Underneath Text */}
          <motion.div
            initial={{ opacity: 0, scaleX: 0.7 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 1.1, delay: 0.38, ease: 'easeOut' }}
            className="mt-6 flex flex-col items-center justify-center w-full max-w-[340px] sm:max-w-[420px] relative"
          >
            <CenterPulseWave isPlaying={isPlaying} isDark={isDark} emphasized={isHoveringCenter} />
          </motion.div>
        </div>

        <div className="wave-controls">
          <span className="wave-caption">{t('Резонанс','Resonance')}</span>
          <ShinyButton onClick={handleWaveAction} disabled={isStartingWave} className="wave-play-button"
            aria-label={isWaveActive&&isPlaying?t('Приостановить Резонанс','Pause Resonance'):t('Включить Резонанс','Play Resonance')} aria-busy={isStartingWave}>
            {isStartingWave?<UniqueLoading size="md" label={t('Запускаем Резонанс','Starting Resonance')}/>:isWaveActive&&isPlaying?<Pause size={34} fill="currentColor"/>:<Play size={34} fill="currentColor" style={{marginLeft:5}}/>}
          </ShinyButton>
          <div className="wave-settings-slot"><AnimatePresence>
            {/* Settings are reachable before the first start too: language and mode decide what the wave plays. */}{<motion.div key="settings" initial={{opacity:0,y:reducedMotion?0:-16,scale:reducedMotion?1:.92}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0}} transition={{type:'spring',stiffness:230,damping:23}}><ShinyButton onClick={()=>setIsSettingsOpen(true)} className="wave-settings-button" aria-haspopup="dialog"><SlidersHorizontal size={17}/>{t('Настроить волну', 'Tune the wave')}</ShinyButton></motion.div>}
          </AnimatePresence></div>
        </div>
      </div>

      {/* «Моя волна» settings: full panel with the shattered-glass header */}
      {isSettingsOpen && <React.Suspense fallback={null}><WaveSettingsPanel open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} /></React.Suspense>}

      {/* Bottom-Left: Real Playback Info Block (Section 6 & 7) */}
      <HomeTrackWidget />
      <button onClick={()=>useReportStore.getState().open()} className="home-recommendations-link">{t("Сообщить о проблеме","Report a problem")} <span>→</span></button>
      <button className="sg-scroll-cue" onClick={()=>document.getElementById('home-for-you')?.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'start'})}>
        <span>{t('Для тебя','For you')}</span><ChevronDown size={16}/>
      </button>
    </section>
    <HomeForYou />
    <HomeCharts />
    </div>
  );
};
