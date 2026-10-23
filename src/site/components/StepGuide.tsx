import React from 'react';
import { ArrowLeft, ArrowRight, ListChecks, Rows3, X, ZoomIn } from 'lucide-react';

export type GuideStep = { title: string; body: React.ReactNode; trouble?: { problem: string; fix: React.ReactNode }; figure?: { node: React.ReactNode; caption: string } };

function Lightbox({ figure, onClose }: { figure: NonNullable<GuideStep['figure']>; onClose: () => void }) {
  const close = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; previous?.focus(); };
  }, [onClose]);
  return <div className="s-lightbox" role="dialog" aria-modal="true" aria-label={figure.caption} onClick={onClose}>
    <button ref={close} className="s-lightbox-close" type="button" aria-label="Закрыть" onClick={onClose}><X size={20} /></button>
    <div className="s-lightbox-inner" onClick={e => e.stopPropagation()}>{figure.node}<p>{figure.caption}</p></div>
  </div>;
}

function Step({ step, index, total, onZoom }: { step: GuideStep; index: number; total: number; onZoom: (f: NonNullable<GuideStep['figure']>) => void }) {
  return <article className="s-glass s-step s-step-anim" aria-labelledby={`step-${index}`}>
    <div>
      <p className="s-step-num">Шаг {index + 1} из {total}</p>
      <h3 id={`step-${index}`}>{step.title}</h3>
      <div className="s-step-body">{step.body}</div>
      {step.trouble && <div className="s-step-trouble"><b>Если {step.trouble.problem}</b>{step.trouble.fix}</div>}
    </div>
    {step.figure && <button type="button" className="s-figure" onClick={() => onZoom(step.figure!)} aria-label={`Увеличить: ${step.figure.caption}`}>
      {step.figure.node}<span className="s-figcap"><ZoomIn size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} aria-hidden="true" />{step.figure.caption}</span>
    </button>}
  </article>;
}

/** Step-by-step mode with progress, or every step at once. Pictures open enlarged on tap. */
export function StepGuide({ steps, resetKey }: { steps: GuideStep[]; resetKey: string }) {
  const [index, setIndex] = React.useState(0);
  const [all, setAll] = React.useState(false);
  const [zoom, setZoom] = React.useState<GuideStep['figure'] | null>(null);
  const top = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { setIndex(0); }, [resetKey]);
  const go = (next: number) => {
    setIndex(Math.max(0, Math.min(steps.length - 1, next)));
    top.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  const closeZoom = React.useCallback(() => setZoom(null), []);
  return <div ref={top} style={{ scrollMarginTop: 90 }}>
    <div className="s-progress">
      <div className="s-progress-bar" role="progressbar" aria-label="Прогресс установки" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={all ? steps.length : index + 1}><i style={{ width: `${all ? 100 : ((index + 1) / steps.length) * 100}%` }} /></div>
      <span>{all ? `${steps.length} шагов` : `${index + 1} / ${steps.length}`}</span>
      <button className="s-btn s-btn-sm" type="button" onClick={() => setAll(a => !a)} aria-pressed={all}>{all ? <><ListChecks size={15} aria-hidden="true" />По шагам</> : <><Rows3 size={15} aria-hidden="true" />Все шаги</>}</button>
    </div>
    {all ? steps.map((s, i) => <Step key={i} step={s} index={i} total={steps.length} onZoom={setZoom} />)
      : <div aria-live="polite"><Step key={`${resetKey}-${index}`} step={steps[index]} index={index} total={steps.length} onZoom={setZoom} /></div>}
    {!all && <div className="s-step-nav">
      <button className="s-btn" type="button" onClick={() => go(index - 1)} disabled={index === 0}><ArrowLeft size={17} aria-hidden="true" />Назад</button>
      {index < steps.length - 1 ? <button className="s-btn s-btn-primary" type="button" onClick={() => go(index + 1)}>Следующий шаг<ArrowRight size={17} aria-hidden="true" /></button> : <span className="s-chip" data-tone="available" style={{ height: 48, padding: '0 18px', fontSize: 14 }}>Готово</span>}
    </div>}
    {zoom && <Lightbox figure={zoom} onClose={closeZoom} />}
  </div>;
}
