import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Search, Library } from 'lucide-react';
import { clsx } from 'clsx';
export const Sidebar: React.FC = () => {
  const displayName = 'Слушатель Oskolok';
  const avatarUrl: string | null = null;
  const initials = 'OS';

  const navItems = [
    { label: 'Главная', path: '/', icon: Home },
    { label: 'Поиск', path: '/search', icon: Search },
    { label: 'Коллекция', path: '/library', icon: Library },
  ];

  return (
    <aside
      className="w-60 bg-[#0f0f0f] flex flex-col h-full shrink-0 select-none"
      style={{
        borderRight: '1px solid',
        borderImageSource: 'linear-gradient(to bottom, transparent 56px, rgba(255,255,255,0.1) 56px)',
        borderImageSlice: 1,
      }}
    >

      {/* Brand Header — aligned with Header height (h-14 = 56px) */}
      <div className="h-14 px-6 flex items-center justify-between shrink-0">
        <NavLink to="/" className="flex items-center gap-3 group translate-y-1">
          <img
            src="/logo.png"
            alt="Oskolok Logo"
            className="w-8 h-8 object-contain drop-shadow-[0_0_12px_rgba(59,130,246,0.6)] group-hover:scale-105 transition-transform shrink-0"
          />
          <span className="text-xl font-bold tracking-wider text-white">
            OSKOLOK
          </span>
        </NavLink>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-4 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 group',
                isActive
                  ? 'bg-zinc-800/80 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/40'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={22}
                  strokeWidth={isActive ? 2.5 : 2}
                  className={clsx(
                    'shrink-0 transition-colors duration-200',
                    isActive ? 'text-white' : 'text-zinc-400 group-hover:text-white'
                  )}
                />
                <span className="truncate tracking-wide">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Profile Info Footer */}
      <div className="p-3 bg-[#0f0f0f] shrink-0">
        <div className="flex items-center gap-3 px-3 py-2 transition-colors cursor-pointer group">
          <div className="w-8 h-8 rounded-full bg-zinc-800 border border-white/10 overflow-hidden flex items-center justify-center text-xs font-bold text-zinc-300 group-hover:text-white shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1 truncate">
            <div className="text-sm font-semibold text-zinc-200 group-hover:text-white truncate transition-colors">
              {displayName}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              Локальная коллекция
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
