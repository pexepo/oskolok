import React from 'react';

import { tr } from '../../stores/useLanguageStore.js';
export interface LumaSpinProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

export function Component({ size = 'md', className = '', label }: LumaSpinProps) {
  return <span className={`luma-spin luma-spin-${size} ${className}`} role="status" aria-label={label ?? tr('Загрузка', 'Loading')}>
    <span className="luma-spin-outline" aria-hidden="true" />
    <span className="luma-spin-outline luma-spin-outline-delayed" aria-hidden="true" />
  </span>;
}

export default Component;
