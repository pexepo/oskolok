import UniqueLoading from '../ui/morph-loading.js';

export function LoadingState({ label, className = '', size = 'lg' }: { label?: string; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  return <div className={`morph-loading-state ${className}`}>
    <UniqueLoading size={size} label={label || 'Загрузка'} />
    {label && <span className="morph-loading-caption">{label}</span>}
  </div>;
}
