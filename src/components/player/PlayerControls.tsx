import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1 } from 'lucide-react';
import { RepeatMode } from '../../types/index.js';
import { clsx } from 'clsx';
import UniqueLoading from '../ui/morph-loading.js';

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
  const iconSizes = {
    sm: { main: 18, sub: 16, playBtn: 'w-8 h-8' },
    md: { main: 20, sub: 18, playBtn: 'w-10 h-10' },
    lg: { main: 28, sub: 22, playBtn: 'w-14 h-14' },
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
        title={shuffle ? 'Перемешивание включено' : 'Перемешивание выключено'}
      >
        <Shuffle size={iconSizes.sub} />
        {shuffle && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-blue-600 dark:bg-sky-400 rounded-full" />}
      </button>

      {/* Previous Button */}
      <button
        onClick={onPrevious}
        className="p-2 rounded-full text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 hover:bg-blue-50/70 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
        title="Предыдущий трек (P)"
      >
        <SkipBack size={iconSizes.main} />
      </button>

      {/* Play/Pause Button */}
      <button
        onClick={onTogglePlay}
        disabled={isBuffering}
        className={clsx(
          'rounded-full bg-gradient-to-tr from-blue-600 via-blue-500 to-indigo-600 hover:brightness-105 text-white flex items-center justify-center shadow-lg shadow-blue-500/25 dark:shadow-[0_0_20px_rgba(56,189,248,0.4)] hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer',
          iconSizes.playBtn
        )}
        title={isPlaying ? 'Пауза (Space)' : 'Воспроизвести (Space)'}
      >
        {isBuffering ? (
          <UniqueLoading size="sm" label="Буферизация трека" />
        ) : isPlaying ? (
          <Pause size={iconSizes.main} className="fill-white" />
        ) : (
          <Play size={iconSizes.main} className="fill-white ml-0.5" />
        )}
      </button>

      {/* Next Button */}
      <button
        onClick={onNext}
        className="p-2 rounded-full text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 hover:bg-blue-50/70 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
        title="Следующий трек (N)"
      >
        <SkipForward size={iconSizes.main} />
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
        title={`Повтор: ${repeatMode}`}
      >
        {renderRepeatIcon()}
        {repeatMode !== 'off' && (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-blue-600 dark:bg-sky-400 rounded-full" />
        )}
      </button>
    </div>
  );
};
