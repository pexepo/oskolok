import React from 'react';

export interface UniqueLoadingProps {
  variant?: 'morph';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

export default function UniqueLoading({ size = 'md', className = '', label = 'Загрузка' }: UniqueLoadingProps) {
  return <span className={`morph-loading morph-loading-${size} ${className}`} role="status" aria-label={label}>
    <span className="morph-loading-shapes" aria-hidden="true">
      {[0, 1, 2, 3].map(index => <span key={index} className={`morph-loading-shape morph-loading-shape-${index}`} />)}
    </span>
  </span>;
}
