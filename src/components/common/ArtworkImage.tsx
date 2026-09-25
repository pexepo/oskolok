import React, { useState } from 'react';
import { Music } from 'lucide-react';
import { clsx } from 'clsx';

interface ArtworkImageProps {
  src?: string;
  alt: string;
  className?: string;
  iconSize?: number;
}

export const ArtworkImage: React.FC<ArtworkImageProps> = ({
  src,
  alt,
  className = 'w-12 h-12 rounded-md',
  iconSize = 24,
}) => {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  React.useEffect(()=>{setHasError(false);setIsLoaded(false);},[src]);

  if (!src || hasError) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center bg-white/80 dark:bg-slate-900/80 border border-blue-100/90 dark:border-slate-800 text-[#7188a3] dark:text-sky-400/70 shrink-0 select-none',
          className
        )}
        aria-label={alt}
      >
        <Music size={iconSize} />
      </div>
    );
  }

  return (
    <div className={clsx('relative overflow-hidden bg-blue-50/50 dark:bg-slate-900/50 shrink-0', className)}>
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-50/40 dark:bg-slate-900/40 animate-pulse">
          <Music size={iconSize} className="text-[#7188a3] dark:text-sky-400/50 opacity-50" />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
        className={clsx(
          'w-full h-full object-cover transition-opacity duration-300',
          isLoaded ? 'opacity-100' : 'opacity-0'
        )}
      />
    </div>
  );
};
