import React, {useEffect, useId, useRef} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {motion, AnimatePresence, useReducedMotion} from 'framer-motion';
import {useTranslation} from '../../stores/useLanguageStore.js';
interface ModalProps {isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode; className?: string}
const modalStack: string[] = [];
export const Modal: React.FC<ModalProps> = ({isOpen, onClose, title, children, className = 'max-w-md'}) => {
  const id = useId(), panel = useRef<HTMLDivElement>(null), close = useRef(onClose);
  const t = useTranslation(), reduced = useReducedMotion();
  close.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    modalStack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => panel.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== id) return;
      if (event.key === 'Escape') {event.preventDefault(); event.stopImmediatePropagation(); close.current();}
      if (event.key === 'Tab') {
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter(element => element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (!first) {event.preventDefault(); panel.current?.focus();}
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {event.preventDefault(); last?.focus();}
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {event.preventDefault(); first.focus();}
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      cancelAnimationFrame(frame); document.removeEventListener('keydown', handleKeyDown, true);
      const index = modalStack.indexOf(id); if (index >= 0) modalStack.splice(index, 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [id, isOpen]);
  return createPortal(<AnimatePresence>{isOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose} className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"/>
    <motion.div ref={panel} tabIndex={-1} initial={{opacity:0,scale:reduced?1:.95,y:reduced?0:10}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:reduced?1:.95,y:reduced?0:10}} role="dialog" aria-modal="true" aria-labelledby={id} className={`frost-surface content-modal relative w-full ${className} backdrop-blur-xl border rounded-2xl p-6 max-h-[85dvh] overflow-y-auto overscroll-contain z-10 text-[#162b50] dark:text-slate-100 outline-none`}>
      <div className="flex items-center justify-between gap-3 mb-4"><h3 id={id} className="text-xl font-bold">{title}</h3><button type="button" aria-label={t('Закрыть','Close')} onClick={onClose} className="p-1.5 rounded-xl hover:bg-blue-50/80 dark:hover:bg-slate-800 transition-colors"><X size={20}/></button></div>
      <div>{children}</div>
    </motion.div>
  </div>}</AnimatePresence>, document.body);
};
