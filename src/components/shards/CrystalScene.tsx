import React from 'react';

export function CrystalScene({ variant = 'ambient' }: { variant?: 'ambient' | 'hero' | 'lyrics' }) {
  return <div className={`crystal-scene crystal-scene--${variant}`} aria-hidden="true">
    {variant === 'hero' && <div className="crystal-art" />}
    <div className="crystal-halo" />
    {[0,1,2,3,4,5].map(i => <div key={i} className={`glass-shard glass-shard-${i}`}><i /><b /></div>)}
  </div>;
}
