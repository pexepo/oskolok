import React, { useRef, useState } from 'react';
import { formatTime } from '../../utils/formatters.js';

interface ProgressBarProps {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  showTimeLabels?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  currentTime,
  duration,
  onSeek,
  showTimeLabels = true,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  const currentRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const displayRatio = isDragging && dragRatio !== null ? dragRatio : currentRatio;
  const displayTime = isDragging && dragRatio !== null ? dragRatio * duration : currentTime;
  const percent = displayRatio * 100;

  const calcRatio = (clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const clickX = clientX - rect.left;
    return Math.max(0, Math.min(1, clickX / rect.width));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || duration <= 0) return;
    e.preventDefault();
    setIsDragging(true);
    const r = calcRatio(e.clientX);
    setDragRatio(r);

    const onPointerMove = (ev: PointerEvent) => {
      const ratio = calcRatio(ev.clientX);
      setDragRatio(ratio);
    };

    const onPointerUp = (ev: PointerEvent) => {
      const ratio = calcRatio(ev.clientX);
      setIsDragging(false);
      setDragRatio(null);
      onSeek(ratio * duration);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      onSeek(Math.max(0, currentTime - 5));
    } else if (e.key === 'ArrowRight') {
      onSeek(Math.min(duration, currentTime + 5));
    }
  };

  return (
    <div className="flex items-center gap-3 w-full font-mono text-xs text-[#7188a3] dark:text-slate-400 select-none">
      {showTimeLabels && <span className="w-10 text-right font-medium">{formatTime(displayTime)}</span>}

      <div
        ref={barRef}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="slider"
        aria-label="Progress timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration || 0)}
        aria-valuenow={Math.round(displayTime || 0)}
        className={`relative flex-1 ${
          isDragging ? 'h-2' : 'h-1.5 hover:h-2'
        } bg-slate-200/60 dark:bg-slate-700/60 rounded-full cursor-pointer group transition-all duration-150`}
      >
        <div
          style={{ width: `${percent}%` }}
          className={`h-full bg-gradient-to-r from-blue-500 to-sky-400 dark:from-sky-400 dark:to-cyan-300 group-hover:from-blue-600 group-hover:to-sky-500 rounded-full relative shadow-[0_0_6px_rgba(59,130,246,0.25)] dark:shadow-[0_0_10px_rgba(56,189,248,0.5)] ${
            isDragging ? 'transition-none' : 'transition-all duration-100'
          }`}
        >
          <div
            className={`absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-blue-500 dark:bg-sky-400 rounded-full shadow-sm transition-transform ${
              isDragging ? 'scale-100' : 'scale-0 group-hover:scale-100'
            }`}
          />
        </div>
      </div>

      {showTimeLabels && <span className="w-10 font-medium">{formatTime(duration)}</span>}
    </div>
  );
};
