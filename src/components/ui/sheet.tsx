import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {createPortal} from 'react-dom';
import {AnimatePresence, motion, useReducedMotion} from 'framer-motion';
import {X} from 'lucide-react';
import {clsx} from 'clsx';

type SheetSide = 'right' | 'left' | 'top' | 'bottom' | 'center';
type SheetVariant = 'default' | 'inset';

type SheetContextValue = {
  open: boolean;
  setOpen: (next: boolean) => void;
  titleId: string;
  descriptionId: string;
};

const SheetContext = createContext<SheetContextValue | null>(null);

function useSheet() {
  const ctx = useContext(SheetContext);
  if (!ctx) throw new Error('Sheet components must be used inside <Sheet>.');
  return ctx;
}

type SheetProps = {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function Sheet({children, open, defaultOpen = false, onOpenChange}: SheetProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const resolved = isControlled ? open : uncontrolled;
  const titleId = useId();
  const descriptionId = useId();
  const setOpen = useCallback((next: boolean) => {
    if (!isControlled) setUncontrolled(next);
    onOpenChange?.(next);
  }, [isControlled, onOpenChange]);
  const value = useMemo(() => ({open: resolved, setOpen, titleId, descriptionId}), [resolved, setOpen, titleId, descriptionId]);
  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>;
}

type Clickable = {onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void; className?: string};

function mergeClick(render: React.ReactElement, handler: (event: React.MouseEvent<HTMLButtonElement>) => void) {
  const element = render as React.ReactElement<Clickable>;
  return React.cloneElement(element, {
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      element.props.onClick?.(event);
      handler(event);
    },
  });
}

type TriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  render?: React.ReactElement;
};

export function SheetTrigger({render, children, onClick, type, ...props}: TriggerProps) {
  const {setOpen} = useSheet();
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) setOpen(true);
  };
  if (render) return mergeClick(render, handleClick);
  return <button type={type ?? 'button'} onClick={handleClick} {...props}>{children}</button>;
}

type CloseProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  render?: React.ReactElement;
};

export function SheetClose({render, children, onClick, type, ...props}: CloseProps) {
  const {setOpen} = useSheet();
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) setOpen(false);
  };
  if (render) return mergeClick(render, handleClick);
  return <button type={type ?? 'button'} onClick={handleClick} {...props}>{children}</button>;
}

export function SheetBackdrop({className}: {className?: string}) {
  const {setOpen} = useSheet();
  return (
    <motion.div
      initial={{opacity: 0}}
      animate={{opacity: 1}}
      exit={{opacity: 0}}
      transition={{duration: 0.2}}
      className={clsx('oskolok-sheet-backdrop', className)}
      onClick={() => setOpen(false)}
    />
  );
}
export const SheetOverlay = SheetBackdrop;

type PopupProps = {
  children: React.ReactNode;
  side?: SheetSide;
  variant?: SheetVariant;
  showCloseButton?: boolean;
  closeProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  portalProps?: {keepMounted?: boolean; container?: HTMLElement | null};
  className?: string;
};

const motionBySide: Record<SheetSide, {initial: Record<string, number | string>; animate: Record<string, number | string>; exit: Record<string, number | string>}> = {
  right: {initial: {x: '100%'}, animate: {x: 0}, exit: {x: '100%'}},
  left: {initial: {x: '-100%'}, animate: {x: 0}, exit: {x: '-100%'}},
  top: {initial: {y: '-100%'}, animate: {y: 0}, exit: {y: '-100%'}},
  bottom: {initial: {y: '100%'}, animate: {y: 0}, exit: {y: '100%'}},
  center: {initial: {opacity: 0, scale: 0.96, y: 12}, animate: {opacity: 1, scale: 1, y: 0}, exit: {opacity: 0, scale: 0.96, y: 12}},
};

function trapFocus(root: HTMLElement, event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const focusable = [...root.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
  )].filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
  if (!focusable.length) {
    event.preventDefault();
    root.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function SheetPopup({
  children,
  side = 'right',
  variant = 'default',
  showCloseButton = true,
  closeProps,
  portalProps,
  className,
}: PopupProps) {
  const {open, setOpen, titleId, descriptionId} = useSheet();
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusFirst = () => {
      const first = panel?.querySelector<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
      (first ?? panel)?.focus();
    };
    const frame = requestAnimationFrame(focusFirst);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (panel) trapFocus(panel, event);
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus?.();
    };
  }, [open, setOpen]);

  if (!mounted && !portalProps?.keepMounted) return null;
  const host = portalProps?.container ?? (mounted ? document.body : null);
  if (!host) return null;

  const panelMotion = reduceMotion ? motionBySide.center : motionBySide[side];

  const node = (
    <AnimatePresence>
      {open && (
        <motion.div
          className={clsx('oskolok-sheet-portal', `oskolok-sheet-side-${side}`, variant === 'inset' && 'oskolok-sheet-inset')}
          data-side={side}
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          exit={{opacity: 0}}
          transition={{duration: reduceMotion ? 0.12 : 0.2}}
        >
          <SheetBackdrop />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
            className={clsx('oskolok-sheet-popup frost-surface', className)}
            initial={panelMotion.initial}
            animate={panelMotion.animate}
            exit={panelMotion.exit}
            transition={{duration: reduceMotion ? 0.12 : 0.24, ease: [0.22, 1, 0.36, 1]}}
          >
            {showCloseButton && (
              <button
                type="button"
                className="oskolok-sheet-close"
                aria-label="Закрыть"
                {...closeProps}
                onClick={event => {
                  closeProps?.onClick?.(event);
                  if (!event.defaultPrevented) setOpen(false);
                }}
              >
                <X size={18} />
              </button>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(node, host);
}

export const SheetContent = SheetPopup;

type SlotProps = React.HTMLAttributes<HTMLDivElement> & {
  render?: React.ReactElement;
};

function Slot({render, children, className, ...props}: SlotProps) {
  if (render) {
    const element = render as React.ReactElement<{className?: string; children?: React.ReactNode}>;
    return React.cloneElement(element, {
      className: clsx(className, element.props.className),
      ...props,
      children: children ?? element.props.children,
    });
  }
  return <div className={className} {...props}>{children}</div>;
}

export function SheetHeader({className, ...props}: SlotProps) {
  return <Slot className={clsx('oskolok-sheet-header', className)} {...props} />;
}

export function SheetFooter({className, variant = 'default', ...props}: SlotProps & {variant?: 'default' | 'bare'}) {
  return <Slot className={clsx('oskolok-sheet-footer', variant === 'bare' && 'oskolok-sheet-footer-bare', className)} {...props} />;
}

export function SheetPanel({className, scrollFade = true, ...props}: SlotProps & {scrollFade?: boolean}) {
  return <Slot className={clsx('oskolok-sheet-panel custom-scrollbar', scrollFade && 'oskolok-sheet-panel-fade', className)} {...props} />;
}

export function SheetTitle({className, children, ...props}: React.HTMLAttributes<HTMLHeadingElement>) {
  const {titleId} = useSheet();
  return <h2 id={titleId} className={clsx('oskolok-sheet-title', className)} {...props}>{children}</h2>;
}

export function SheetDescription({className, children, ...props}: React.HTMLAttributes<HTMLParagraphElement>) {
  const {descriptionId} = useSheet();
  return <p id={descriptionId} className={clsx('oskolok-sheet-description', className)} {...props}>{children}</p>;
}

export const SheetPortal = ({children}: {children: React.ReactNode}) => <>{children}</>;
