import React from 'react';
import { Shuffle, Repeat, Repeat1 } from 'lucide-react';
import { PlayerIcon } from './PlayerIcon.js';
import { RepeatMode } from '../../types/index.js';
import { clsx } from 'clsx';
import LumaSpin from '../ui/luma-spin.js';

import { useTranslation } from '../../stores/useLanguageStore.js';
interface PlayerControlsProps {
  isPlaying: boolean;
  isBuffering: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onChangeRepeatMode: () => void;
  size?: 'sm' | 'md' | 'lg';
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  isPlaying,
  isBuffering,
  shuffle,
  repeatMode,
  onTogglePlay,
  onPrevious,
  onNext,
  onToggleShuffle,
  onChangeRepeatMode,
  size = 'md',
}) => {
  const t = useTranslation();
  const iconSizes = {
    sm: { main: 18, sub: 16, play: 32, playBtn: 'w-8 h-8' },
    md: { main: 22, sub: 18, play: 40, playBtn: 'w-10 h-10' },
    lg: { main: 30, sub: 22, play: 58, playBtn: 'w-16 h-16' },
  }[size];

  const renderRepeatIcon = () => {
    if (repeatMode === 'one') {
      return <Repeat1 size={iconSizes.sub} className="text-blue-600 dark:text-sky-400" />;
    }
    return (
      <Repeat
        size={iconSizes.sub}
        className={repeatMode === 'all' ? 'text-blue-600 dark:text-sky-400' : 'text-[#5a6e85] dark:text-slate-400'}
      />
    );
  };

  return (
    <div className="flex items-center gap-4 select-none">
      {/* Shuffle Button */}
      <button
        onClick={onToggleShuffle}
        className={clsx(
          'p-2 rounded-full transition-colors relative cursor-pointer',
          shuffle
            ? 'text-blue-600 dark:text-sky-400 bg-blue-50 dark:bg-slate-800'
            : 'text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 hover:bg-blue-50/70 dark:hover:bg-slate-800/60'
        )}
        title={shuffle ? t('Перемешивание включено', 'Shuffle on') : t('Перемешивание выключено', 'Shuffle off')}
      >
        <Shuffle size={iconSizes.sub} />
        {shuffle && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-blue-600 dark:bg-sky-400 rounded-full" />}
      </button>

      {/* Previous Button */}
      <button
        onClick={onPrevious}
        className="p-2 rounded-full text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 hover:bg-blue-50/70 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
        title={t('Предыдущий трек (P)', 'Previous track (P)')}
      >
        <PlayerIcon name="prev" size={iconSizes.main} />
      </button>

      {/* Play/Pause Button */}
      <button
        onClick={onTogglePlay}
        disabled={isBuffering}
        className={clsx(
          'player-shard-play flex items-center justify-center hover:scale-105 active:scale-95 transition-transform duration-150 cursor-pointer',
          iconSizes.playBtn
        )}
        title={isPlaying ? t('Пауза (Space)', 'Pause (Space)') : t('Воспроизвести (Space)', 'Play (Space)')}
      >
        {isBuffering ? (
          <LumaSpin size="md" label={t('Буферизация трека', 'Buffering track')} />
        ) : (
          <PlayerIcon name={isPlaying ? 'pause' : 'play'} size={iconSizes.play} />
        )}
      </button>

      {/* Next Button */}
      <button
        onClick={onNext}
        className="p-2 rounded-full text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 hover:bg-blue-50/70 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
        title={t('Следующий трек (N)', 'Next track (N)')}
      >
        <PlayerIcon name="next" size={iconSizes.main} />
      </button>

      {/* Repeat Button */}
      <button
        onClick={onChangeRepeatMode}
        className={clsx(
          'p-2 rounded-full transition-colors relative cursor-pointer',
          repeatMode !== 'off'
            ? 'text-blue-600 dark:text-sky-400 bg-blue-50 dark:bg-slate-800'
            : 'text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 hover:bg-blue-50/70 dark:hover:bg-slate-800/60'
        )}
        title={repeatMode === 'off' ? t('Повтор выключен', 'Repeat off') : repeatMode === 'one' ? t('Повтор одного трека', 'Repeat one') : t('Повтор всех треков', 'Repeat all')}
      >
        {renderRepeatIcon()}
        {repeatMode !== 'off' && (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-blue-600 dark:bg-sky-400 rounded-full" />
        )}
      </button>
    </div>
  );
};
