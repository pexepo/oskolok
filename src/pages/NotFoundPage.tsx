import React from 'react';
import { NavLink } from 'react-router-dom';
import { Disc3, Home } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 select-none">
      <div className="w-24 h-24 rounded-full bg-blue-50 dark:bg-slate-900/80 text-blue-600 dark:text-sky-400 border border-blue-100/80 dark:border-slate-800 flex items-center justify-center mb-6 animate-pulse shadow-sm">
        <Disc3 size={48} />
      </div>
      <h1 className="text-4xl font-extrabold text-[#162b50] dark:text-slate-100 tracking-tight mb-2">404</h1>
      <h2 className="text-xl font-bold text-[#162b50] dark:text-slate-100 mb-2">Страница не найдена</h2>
      <p className="text-sm text-[#7188a3] dark:text-slate-400 max-w-sm mb-8">
        Запрошенная страница не существует или была перемещена.
      </p>

      <NavLink
        to="/"
        className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 font-extrabold text-sm shadow-lg shadow-blue-600/20 dark:shadow-[0_0_15px_rgba(56,189,248,0.4)] hover:scale-105 active:scale-95 transition-all"
      >
        <Home size={18} />
        <span>На главную</span>
      </NavLink>
    </div>
  );
};
