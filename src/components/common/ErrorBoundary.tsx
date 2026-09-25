import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled React Error in ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#070c14] text-slate-100 p-6 select-none">
          <div className="max-w-md w-full p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Произошла ошибка интерфейса</h2>
              <p className="text-xs text-slate-400 mt-1">
                {this.state.error?.message || 'Интерфейс временно недоступен'}
              </p>
            </div>
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer"
            >
              <RotateCcw size={14} />
              <span>Перезагрузить</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
