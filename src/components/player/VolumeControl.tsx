import React, { useRef, useState } from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';

interface VolumeControlProps {
  volume: number;
  isMuted: boolean;
  onVolumeChange: (val: number) => void;
  onToggleMute: () => void;
}

export const VolumeControl: React.FC<VolumeControlProps> = ({
  volume,
  isMuted,
  onVolumeChange,
  onToggleMute,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragVolume, setDragVolume] = useState<number | null>(null);

  const effectiveVolume = isMuted ? 0 : volume;
  const currentVal = isDragging && dragVolume !== null ? dragVolume : effectiveVolume;

  const calcVolume = (clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const clickX = clientX - rect.left;
    return Math.max(0, Math.min(1, clickX / rect.width));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    const val = calcVolume(e.clientX);
    setDragVolume(val);
    onVolumeChange(val);

    const onPointerMove = (ev: PointerEvent) => {
      const v = calcVolume(ev.clientX);
      setDragVolume(v);
      onVolumeChange(v);
    };

    const onPointerUp = (ev: PointerEvent) => {
      const v = calcVolume(ev.clientX);
      setIsDragging(false);
      setDragVolume(null);
      onVolumeChange(v);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const getIcon = () => {
    if (isMuted || volume === 0) return <VolumeX size={18} />;
    if (volume < 0.5) return <Volume1 size={18} />;
    return <Volume2 size={18} />;
  };

  return (
    <div className="flex items-center gap-2 select-none group">
      <button
        onClick={onToggleMute}
        className="p-1 rounded-lg text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-slate-100 hover:bg-blue-50/70 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
        title={isMuted ? 'Включить звук' : 'Выключить звук'}
      >
        {getIcon()}
      </button>

      <div
        ref={barRef}
        onPointerDown={handlePointerDown}
        tabIndex={0}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(currentVal * 100)}
        className={`relative w-20 ${
          isDragging ? 'h-2' : 'h-1.5 hover:h-2'
        } bg-slate-200/60 dark:bg-slate-700/60 rounded-full cursor-pointer transition-all duration-150`}
      >
        <div
          style={{ width: `${currentVal * 100}%` }}
          className={`h-full bg-gradient-to-r from-blue-500 to-sky-400 dark:from-sky-400 dark:to-cyan-300 group-hover:from-blue-600 group-hover:to-sky-500 rounded-full relative shadow-[0_0_6px_rgba(59,130,246,0.2)] dark:shadow-[0_0_10px_rgba(56,189,248,0.5)] ${
            isDragging ? 'transition-none' : 'transition-all duration-100'
          }`}
        >
          <div
            className={`absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-blue-500 dark:bg-sky-400 rounded-full shadow-sm transition-transform ${
              isDragging ? 'scale-100' : 'scale-0 group-hover:scale-100'
            }`}
          />
        </div>
      </div>
    </div>
  );
};
