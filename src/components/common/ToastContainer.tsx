import React from 'react';
import { useToastStore } from '../../stores/useToastStore.js';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="text-emerald-400 shrink-0" size={18} />;
      case 'error':
      case 'warning':
        return <AlertCircle className="text-amber-400 shrink-0" size={18} />;
      default:
        return <Info className="text-brand-purple shrink-0" size={18} />;
    }
  };

  return (
    <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full px-4">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 bg-white/95 dark:bg-[#0c1320]/95 backdrop-blur-md border border-blue-100 dark:border-slate-800 text-[#162b50] dark:text-slate-100 rounded-xl shadow-xl text-sm font-medium"
          >
            <div className="flex items-center gap-3">
              {getIcon(toast.type)}
              <span>{toast.message}</span>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-[#7188a3] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              aria-label="Close toast"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
