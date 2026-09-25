import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Maximize2 } from 'lucide-react';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useThemeStore } from '../../stores/useThemeStore.js';
import { ArtworkImage } from '../common/ArtworkImage.js';

export const HomeTrackWidget: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    next,
    previous,
    volume,
    setVolume,
    isMuted,
    toggleMute,
    setFullPlayerOpen,
    startMyWave,
  } = usePlayerStore();
  const { isDark } = useThemeStore();

  const [isHovered, setIsHovered] = useState(false);

  const displayTitle = currentTrack ? currentTrack.title : 'Моя волна';

  const handlePlayClick = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (currentTrack) {
      togglePlay();
    } else {
      startMyWave();
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.95, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: 14, scale: 0.95, filter: 'blur(4px)' }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="home-track-widget absolute bottom-8 left-8 sm:left-10 z-30 select-none group"
      >
        {/* Frameless floating Now Playing widget matching the corner of the reference */}
        <div className="flex items-center gap-3 select-none">
          {/* Animated Wave Bars Icon */}
          <div
            onClick={handlePlayClick}
            className="flex items-center gap-[3px] h-6 px-1 shrink-0 cursor-pointer"
            title={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            {[0.4, 0.9, 0.6, 0.75].map((scale, i) => (
              <motion.span
                key={i}
                className="w-[2px] rounded-full bg-blue-600 dark:bg-[#38bdf8]"
                style={{
                  filter: isDark ? 'drop-shadow(0 0 6px rgba(56,189,248,0.85))' : undefined,
                  minHeight: '4px',
                }}
                animate={
                  isPlaying
                    ? {
                        height: ['5px', `${Math.round(18 * scale)}px`, '5px'],
                        opacity: [0.6, 1, 0.6],
                      }
                    : { height: '5px', opacity: isDark ? 0.45 : 0.35 }
                }
                transition={
                  isPlaying
                    ? {
                        duration: 0.8 + i * 0.15,
                        repeat: Infinity,
                        ease: 'easeInOut',
                        repeatType: 'reverse',
                        delay: i * 0.12,
                      }
                    : { duration: 0.3 }
                }
              />
            ))}
          </div>

          {/* Thin Vertical Divider matching reference */}
          <div className="w-[1px] h-6 bg-blue-300/40 dark:bg-white/20 shrink-0" />

          {/* Track Info (Section 6 & 7: "Сейчас играет" / Title) */}
          <div
            onClick={() => (currentTrack ? setFullPlayerOpen(true) : startMyWave())}
            className="min-w-0 pr-1 cursor-pointer group/info"
            title={currentTrack ? 'Открыть Интерференцию' : 'Включить Мою волну'}
          >
            <div className="text-[11px] font-normal tracking-wide text-[#7188a3] dark:text-[#7e92ad] select-none">
              Сейчас играет
            </div>
            <div className="text-xs sm:text-[13px] font-normal text-[#162b50] dark:text-[#c8d6e8] group-hover/info:text-blue-600 dark:group-hover/info:text-[#38bdf8] transition-colors truncate max-w-[200px] sm:max-w-[260px]">
              {displayTitle}
            </div>
          </div>

          {/* Delicate controls reveal gently on hover without any box frame */}
          <motion.div
            animate={{ opacity: isHovered ? 1 : 0 }}
            className="flex items-center gap-1 shrink-0 transition-opacity"
          >
            <button
              onClick={() => previous()}
              className="p-1 rounded-full text-[#7188a3] dark:text-slate-400 hover:text-blue-600 dark:hover:text-[#38bdf8] transition-colors cursor-pointer"
              title="Предыдущий трек"
            >
              <SkipBack size={13} className="fill-current" />
            </button>

            <button
              onClick={handlePlayClick}
              className="w-6 h-6 rounded-full bg-blue-600 hover:bg-blue-500 dark:bg-[#38bdf8] dark:hover:bg-[#60a5fa] text-white dark:text-slate-950 flex items-center justify-center shadow-xs dark:shadow-[0_0_12px_rgba(56,189,248,0.6)] transition-transform hover:scale-105 active:scale-95 cursor-pointer"
              title={isPlaying ? 'Пауза' : 'Воспроизвести'}
            >
              {isPlaying ? (
                <Pause size={11} className="fill-white dark:fill-slate-950" />
              ) : (
                <Play size={11} className="fill-white dark:fill-slate-950 ml-0.5" />
              )}
            </button>

            <button
              onClick={() => next()}
              className="p-1 rounded-full text-[#7188a3] dark:text-slate-400 hover:text-blue-600 dark:hover:text-[#38bdf8] transition-colors cursor-pointer"
              title="Следующий трек"
            >
              <SkipForward size={13} className="fill-current" />
            </button>

            {currentTrack && (
              <button
                onClick={() => setFullPlayerOpen(true)}
                className="p-1 rounded-full text-[#7188a3] dark:text-slate-400 hover:text-blue-600 dark:hover:text-[#38bdf8] transition-colors cursor-pointer"
                title="Открыть Интерференцию"
              >
                <Maximize2 size={12} />
              </button>
            )}
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
