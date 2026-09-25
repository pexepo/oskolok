import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Activity } from 'lucide-react';
import { apiClient } from '../../api/apiClient.js';
import { HealthStatus } from '../../types/index.js';

export const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const qParam = params.get('q') || '';
    setQuery(qParam);
  }, [location.search]);

  useEffect(() => {
    apiClient.getHealth().then(setHealth).catch(() => {});
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <header
      style={{ WebkitAppRegion: 'drag' } as any}
      className="h-14 px-6 border-b border-white/10 bg-[#0f0f0f] flex items-center justify-center relative sticky top-0 z-30 select-none pr-36"
    >
      {/* Search Input Centered */}
      <form
        onSubmit={handleSearchSubmit}
        style={{ WebkitAppRegion: 'no-drag' } as any}
        className="max-w-md w-full relative"
      >
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Трек, исполнитель или альбом"
          className="w-full bg-[#181818] border border-white/10 rounded-full pl-10 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all"
        />
      </form>
    </header>
  );
};
