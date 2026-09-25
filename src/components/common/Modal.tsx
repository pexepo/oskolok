import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="frost-surface relative w-full max-w-md bg-white/95 dark:bg-[#0c1320]/95 backdrop-blur-xl border border-blue-100/80 dark:border-slate-800 rounded-2xl shadow-[0_16px_40px_rgba(22,43,80,0.12)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.8)] p-6 overflow-hidden z-10 text-[#162b50] dark:text-slate-100"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-[#162b50] dark:text-slate-100">{title}</h3>
              <button
                onClick={onClose}
                className="p-1.5 rounded-xl text-[#5a6e85] dark:text-slate-400 hover:text-[#162b50] dark:hover:text-white hover:bg-blue-50/80 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            <div>{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
