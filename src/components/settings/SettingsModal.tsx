import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sun, Moon, Volume2, Sliders, Check } from 'lucide-react';
import { useThemeStore } from '../../stores/useThemeStore.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { theme, isDark, setTheme } = useThemeStore();

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/50 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 16 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className={`frost-surface relative w-full max-w-lg rounded-2xl p-6 sm:p-7 shadow-2xl border transition-colors duration-300 z-10 overflow-hidden ${
            isDark
              ? 'bg-[#0b121e]/95 border-slate-700/80 text-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.8)]'
              : 'bg-white/95 border-blue-100 text-[#162b50] shadow-[0_20px_50px_rgba(37,99,235,0.15)]'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-blue-500/10 mb-6">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                  isDark
                    ? 'bg-blue-500/15 text-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.25)]'
                    : 'bg-blue-50 text-blue-600'
                }`}
              >
                <Sliders size={18} strokeWidth={2.2} />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Настройки</h2>
                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-[#7188a3]'}`}>
                  Персонализация плеера Осколок
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className={`p-2 rounded-full transition-colors cursor-pointer ${
                isDark
                  ? 'text-slate-400 hover:text-white hover:bg-slate-800/80'
                  : 'text-[#7188a3] hover:text-[#162b50] hover:bg-slate-100'
              }`}
              title="Закрыть"
            >
              <X size={18} />
            </button>
          </div>

          {/* Section: Theme Selection */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold tracking-wide">Тема оформления</h3>
                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-[#7188a3]'}`}>
                  Выберите стиль отображения осколков и интерфейса
                </p>
              </div>
              <span
                className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
                  isDark
                    ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                    : 'bg-blue-50 text-blue-700 border border-blue-200/60'
                }`}
              >
                {isDark ? 'Тёмная (Неон)' : 'Светлая (Лёд)'}
              </span>
            </div>

            {/* Theme Cards Grid */}
            <div className="grid grid-cols-2 gap-3.5 pt-1">
              {/* Light Theme Card */}
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`relative flex flex-col p-3.5 rounded-xl border-2 transition-all text-left cursor-pointer group ${
                  theme === 'light'
                    ? 'border-blue-600 bg-blue-50/40 shadow-[0_0_16px_rgba(37,99,235,0.18)]'
                    : isDark
                    ? 'border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-800/50'
                    : 'border-slate-200 bg-slate-50/60 hover:border-blue-300 hover:bg-white'
                }`}
              >
                {/* Visual Preview Box */}
                <div className="w-full h-20 rounded-lg bg-[#eef4fb] border border-blue-200/60 mb-3 relative overflow-hidden flex items-center justify-center p-2">
                  <div className="absolute top-1 left-2 w-3 h-3 rounded-full bg-blue-500/60" />
                  <div className="absolute top-2 left-6 w-8 h-1 rounded-full bg-blue-300/60" />
                  <div className="w-8 h-10 bg-white/90 rounded-xs shadow-xs rotate-12 border border-blue-100" />
                  <div className="absolute bottom-1 right-2 w-6 h-6 bg-white/90 rounded-xs shadow-xs -rotate-6 border border-blue-100" />
                  <div className="absolute bottom-1 left-2 flex items-center gap-0.5">
                    <div className="w-0.5 h-2 bg-blue-500 rounded-full" />
                    <div className="w-0.5 h-3 bg-blue-500 rounded-full" />
                    <div className="w-0.5 h-1.5 bg-blue-500 rounded-full" />
                  </div>
                </div>

                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-1.5">
                    <Sun size={15} className={theme === 'light' ? 'text-blue-600' : isDark ? 'text-slate-400' : 'text-[#7188a3]'} />
                    <span className="text-xs font-semibold">Светлая</span>
                  </div>
                  {theme === 'light' && (
                    <div className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  )}
                </div>
                <span className={`text-[10px] mt-1 ${isDark ? 'text-slate-400' : 'text-[#7188a3]'}`}>
                  Ледяной воздушный стиль
                </span>
              </button>

              {/* Dark Theme Card (Matching Reference Screenshot) */}
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`relative flex flex-col p-3.5 rounded-xl border-2 transition-all text-left cursor-pointer group ${
                  theme === 'dark'
                    ? 'border-sky-400 bg-sky-950/30 shadow-[0_0_20px_rgba(56,189,248,0.25)]'
                    : isDark
                    ? 'border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-800/50'
                    : 'border-slate-200 bg-slate-50/60 hover:border-blue-300 hover:bg-white'
                }`}
              >
                {/* Visual Preview Box */}
                <div className="w-full h-20 rounded-lg bg-[#060b14] border border-blue-500/30 mb-3 relative overflow-hidden flex items-center justify-center p-2 shadow-inner">
                  {/* Glowing ambient center */}
                  <div className="absolute inset-0 bg-blue-600/15 blur-sm" />
                  <div className="absolute top-1 left-2 w-3 h-3 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
                  <div className="absolute top-2 left-6 w-8 h-1 rounded-full bg-blue-500/60" />
                  <div className="w-8 h-10 bg-slate-100/90 rounded-xs shadow-[0_0_12px_rgba(56,189,248,0.9)] rotate-12 border border-sky-300" />
                  <div className="absolute bottom-1 right-2 w-6 h-6 bg-slate-100/90 rounded-xs shadow-[0_0_10px_rgba(56,189,248,0.8)] -rotate-6 border border-sky-300" />
                  <div className="absolute bottom-1 left-2 flex items-center gap-0.5">
                    <div className="w-0.5 h-2 bg-sky-400 rounded-full shadow-[0_0_4px_rgba(56,189,248,0.8)]" />
                    <div className="w-0.5 h-3 bg-sky-400 rounded-full shadow-[0_0_4px_rgba(56,189,248,0.8)]" />
                    <div className="w-0.5 h-1.5 bg-sky-400 rounded-full shadow-[0_0_4px_rgba(56,189,248,0.8)]" />
                  </div>
                </div>

                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-1.5">
                    <Moon size={15} className={theme === 'dark' ? 'text-sky-400' : isDark ? 'text-slate-400' : 'text-[#7188a3]'} />
                    <span className="text-xs font-semibold">Тёмная</span>
                  </div>
                  {theme === 'dark' && (
                    <div className="w-4 h-4 rounded-full bg-sky-400 text-slate-950 flex items-center justify-center">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  )}
                </div>
                <span className={`text-[10px] mt-1 ${isDark ? 'text-slate-400' : 'text-[#7188a3]'}`}>
                  Обсидиан и неоновые кристаллы
                </span>
              </button>
            </div>
          </div>

          {/* Section: Additional Features */}
          <div className="mt-6 pt-5 border-t border-blue-500/10 space-y-3.5">
            {/* Audio Quality */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Volume2 size={16} className={isDark ? 'text-sky-400' : 'text-blue-600'} />
                <div>
                  <div className="text-xs font-medium">Качество звука</div>
                  <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-[#7188a3]'}`}>
                    Зависит от доступного источника
                  </div>
                </div>
              </div>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-[#162b50]'}`}>
                Авто
              </span>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="mt-7 pt-4 border-t border-blue-500/10 flex items-center justify-between">
            <div className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-[#7188a3]'}`}>
              Осколок Player v1.0.0
            </div>
            <button
              type="button"
              onClick={onClose}
              className={`px-5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-xs ${
                isDark
                  ? 'bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-[0_0_15px_rgba(56,189,248,0.3)]'
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-[0_2px_10px_rgba(37,99,235,0.25)]'
              }`}
            >
              Готово
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
