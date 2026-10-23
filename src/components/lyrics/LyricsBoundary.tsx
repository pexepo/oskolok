import { Component, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { useLanguageStore } from '../../stores/useLanguageStore.js';

const t = (ru: string, en: string) => useLanguageStore.getState().language === 'en' ? en : ru;

/** Lyrics sit beside the player, not inside it: a fault while drawing them must leave the controls, queue and
 * the rest of the interface alone instead of falling through to the full-screen error page. */
export class LyricsBoundary extends Component<{ resetKey?: unknown; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('[lyrics] the lyrics view crashed', error); }
  componentDidUpdate(previous: { resetKey?: unknown }) { if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="lyrics-crashed" role="alert">
      <p>{t('Не удалось показать текст песни.', 'Could not show the lyrics.')}</p>
      <button type="button" className="text-button" onClick={() => this.setState({ failed: false })}><RotateCcw size={14} />{t('Повторить', 'Try again')}</button>
    </div>;
  }
}
