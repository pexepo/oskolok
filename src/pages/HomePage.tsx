import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Play, Pause, SlidersHorizontal, Sparkles, Loader2, Volume2 } from 'lucide-react';
import { usePlayerStore } from '../stores/usePlayerStore.js';
import { useThemeStore } from '../stores/useThemeStore.js';
import { HomeTrackWidget } from '../components/player/HomeTrackWidget.js';
import { Modal } from '../components/common/Modal.js';
import {ShinyButton} from '../components/ui/shiny-button.js';

const MOODS = [
  { id: 'energetic', label: 'Бодрое' },
  { id: 'calm', label: 'Спокойное' },
  { id: 'melancholic', label: 'Грустное' },
  { id: 'joyful', label: 'Радостное' },
  { id: 'focus', label: 'Концентрация' },
];

const CHARACTERS = [
  { id: 'popular', label: 'Популярное' },
  { id: 'discover', label: 'Незнакомое' },
  { id: 'familiar', label: 'Любимое' },
];

const LANGUAGES = [
  { id: 'all', label: 'Любой язык' },
  { id: 'russian', label: 'Русский' },
  { id: 'foreign', label: 'Иностранный' },
];

export const HomePage: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    isWaveActive,
    isStartingWave,
    waveOptions,
    startMyWave,
  } = usePlayerStore();
  const { isDark } = useThemeStore();

  const reducedMotion = useReducedMotion();
  const [waveStarted,setWaveStarted] = useState(isWaveActive);
  const [isHoveringCenter, setIsHoveringCenter] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [selectedMood, setSelectedMood] = useState(waveOptions?.mood || 'energetic');
  const [selectedCharacter, setSelectedCharacter] = useState(waveOptions?.character || 'popular');
  const [selectedLanguage, setSelectedLanguage] = useState(waveOptions?.language || 'all');

  useEffect(() => {
    if (waveOptions) {
      if (waveOptions.mood) setSelectedMood(waveOptions.mood);
      if (waveOptions.character) setSelectedCharacter(waveOptions.character);
      if (waveOptions.language) setSelectedLanguage(waveOptions.language);
    }
  }, [waveOptions]);

  const handleWaveAction = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setWaveStarted(true);
    if (isWaveActive) {
      togglePlay();
    } else {
      await startMyWave({
        mood: selectedMood,
        character: selectedCharacter,
        language: selectedLanguage,
      });
    }
  };

  const handleApplySettings = async () => {
    setIsSettingsOpen(false);
    await startMyWave({
      mood: selectedMood,
      character: selectedCharacter,
      language: selectedLanguage,
    });
  };

  return (
    <div className="original-home relative w-full h-full flex flex-col items-center justify-center select-none overflow-hidden">
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
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            transition={{ duration: 1.0, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="text-3xl sm:text-4xl md:text-[44px] lg:text-[50px] font-[300] tracking-wide text-[#162b50] dark:text-[#8ea8cb] leading-[1.3] text-center transition-colors duration-300"
          >
            найди новый{' '}
            <span className="text-blue-600 dark:text-[#38bdf8] font-[400] transition-all duration-300 group-hover:text-blue-500 dark:group-hover:text-[#60a5fa] dark:drop-shadow-[0_0_14px_rgba(56,189,248,0.75)]">
              осколок
            </span>
            <br />
            для своего плейлиста
          </motion.h1>

          {/* Decorative Waveform Line Underneath Text */}
          <motion.div
            initial={{ opacity: 0, scaleX: 0.7 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 1.1, delay: 0.38, ease: 'easeOut' }}
            className="mt-6 flex flex-col items-center justify-center w-full max-w-[340px] sm:max-w-[420px] relative"
          >
            <svg
              viewBox="0 0 400 48"
              className="original-center-wave w-full h-12 overflow-visible pointer-events-none"
            >
              <defs>
                <linearGradient id="centerPulseGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity="0.0" />
                  <stop offset="25%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity={isDark ? '0.6' : '0.35'} />
                  <stop offset="50%" stopColor={isDark ? '#60a5fa' : '#1d4ed8'} stopOpacity={isDark ? '1.0' : '0.85'} />
                  <stop offset="75%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity={isDark ? '0.6' : '0.35'} />
                  <stop offset="100%" stopColor={isDark ? '#38bdf8' : '#2563eb'} stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Subtle animated wave pulse when music is playing or on hover */}
              <motion.path
                d="M 10 24 L 145 24 C 155 24, 160 30, 168 31 C 176 32, 184 -2, 192 -2 C 200 -2, 208 50, 216 50 C 223 50, 229 12, 235 12 C 241 12, 246 29, 252 29 C 257 29, 262 24, 270 24 L 390 24"
                fill="none"
                stroke="url(#centerPulseGrad)"
                strokeWidth={isHoveringCenter || isPlaying ? (isDark ? 1.9 : 1.6) : (isDark ? 1.5 : 1.3)}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  filter: isDark ? 'drop-shadow(0 0 8px rgba(56,189,248,0.85)) drop-shadow(0 0 16px rgba(37,99,235,0.6))' : undefined,
                }}
                animate={
                  isPlaying
                    ? {
                        strokeWidth: isDark ? [1.5, 2.1, 1.5] : [1.3, 1.8, 1.3],
                        filter: isDark
                          ? [
                              'drop-shadow(0 0 6px rgba(56,189,248,0.6))',
                              'drop-shadow(0 0 12px rgba(56,189,248,0.95)) drop-shadow(0 0 20px rgba(37,99,235,0.8))',
                              'drop-shadow(0 0 6px rgba(56,189,248,0.6))',
                            ]
                          : [
                              'drop-shadow(0 0 0px rgba(37,99,235,0))',
                              'drop-shadow(0 0 6px rgba(37,99,235,0.45))',
                              'drop-shadow(0 0 0px rgba(37,99,235,0))',
                            ],
                      }
                    : isDark
                    ? {
                        filter: [
                          'drop-shadow(0 0 6px rgba(56,189,248,0.7))',
                          'drop-shadow(0 0 10px rgba(56,189,248,0.9)) drop-shadow(0 0 16px rgba(37,99,235,0.6))',
                          'drop-shadow(0 0 6px rgba(56,189,248,0.7))',
                        ],
                      }
                    : {}
                }
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              />
            </svg>
          </motion.div>
        </div>

        <div className="wave-controls">
          <span className="wave-caption">Моя волна</span>
          <ShinyButton onClick={handleWaveAction} disabled={isStartingWave} className="wave-play-button"
            aria-label={isWaveActive&&isPlaying?'Приостановить Мою волну':'Включить Мою волну'} aria-busy={isStartingWave}>
            {isStartingWave?<Loader2 size={32} className="animate-spin"/>:isWaveActive&&isPlaying?<Pause size={34} fill="currentColor"/>:<Play size={34} fill="currentColor" style={{marginLeft:5}}/>}
          </ShinyButton>
          <div className="wave-settings-slot"><AnimatePresence>
            {(waveStarted||isWaveActive)&&<motion.div key="settings" initial={{opacity:0,y:reducedMotion?0:-16,scale:reducedMotion?1:.92}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0}} transition={{type:'spring',stiffness:230,damping:23}}><ShinyButton onClick={()=>setIsSettingsOpen(true)} className="wave-settings-button" aria-haspopup="dialog"><SlidersHorizontal size={17}/>Настроить волну</ShinyButton></motion.div>}
          </AnimatePresence></div>
        </div>
      </div>

      {/* Settings Modal: "Настройки Моей волны" (Clean Typography, No emojis) */}
      <Modal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        title="Настройки Моей волны"
      >
        <div className="space-y-5 pt-1 select-none">
          {/* Mood Section */}
          <div>
            <label className="block text-xs font-semibold text-[#7188a3] dark:text-slate-400 uppercase tracking-wider mb-2">
              Настроение
            </label>
            <div className="flex flex-wrap gap-2">
              {MOODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMood(m.id)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedMood === m.id
                      ? 'bg-blue-600 dark:bg-sky-500 text-white dark:text-slate-950 shadow-xs'
                      : 'bg-blue-50/70 dark:bg-slate-800/80 text-[#162b50] dark:text-slate-200 hover:bg-blue-100/70 dark:hover:bg-slate-700/80'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Character Section */}
          <div>
            <label className="block text-xs font-semibold text-[#7188a3] dark:text-slate-400 uppercase tracking-wider mb-2">
              Характер
            </label>
            <div className="flex flex-wrap gap-2">
              {CHARACTERS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCharacter(c.id)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedCharacter === c.id
                      ? 'bg-blue-600 dark:bg-sky-500 text-white dark:text-slate-950 shadow-xs'
                      : 'bg-blue-50/70 dark:bg-slate-800/80 text-[#162b50] dark:text-slate-200 hover:bg-blue-100/70 dark:hover:bg-slate-700/80'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Language Section */}
          <div>
            <label className="block text-xs font-semibold text-[#7188a3] dark:text-slate-400 uppercase tracking-wider mb-2">
              Язык треков
            </label>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSelectedLanguage(l.id)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedLanguage === l.id
                      ? 'bg-blue-600 dark:bg-sky-500 text-white dark:text-slate-950 shadow-xs'
                      : 'bg-blue-50/70 dark:bg-slate-800/80 text-[#162b50] dark:text-slate-200 hover:bg-blue-100/70 dark:hover:bg-slate-700/80'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-blue-100/80 dark:border-slate-800">
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-white hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleApplySettings}
              disabled={isStartingWave}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5"
            >
              {isStartingWave ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Загрузка...</span>
                </>
              ) : (
                <>
                  <SlidersHorizontal size={13} />
                  <span>Применить и слушать</span>
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Bottom-Left: Real Playback Info Block (Section 6 & 7) */}
      <HomeTrackWidget />
      <NavLink to="/search" className="home-recommendations-link">Собрано для вас <span>→</span></NavLink>
    </div>
  );
};
