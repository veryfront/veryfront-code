'use client';

import { useEffect, useState } from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastListener: ((toast: Toast) => void) | null = null;

export function showToast(message: string, type: Toast['type'] = 'info'): void {
  toastListener?.({
    id: Math.random().toString(36),
    message,
    type,
  });
}

function CheckCircleIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertCircleIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function getToastClasses(type: Toast['type']): string {
  const base =
    'pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg backdrop-blur-md border transition-all animate-in slide-in-from-right-full fade-in duration-300 max-w-sm w-full';

  if (type === 'success') {
    return `${base} bg-white/90 dark:bg-slate-800/90 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200`;
  }

  if (type === 'error') {
    return `${base} bg-white/90 dark:bg-slate-800/90 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200`;
  }

  return `${base} bg-white/90 dark:bg-slate-800/90 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200`;
}

function ToastIcon({ type }: { type: Toast['type'] }): React.JSX.Element {
  if (type === 'success') return <CheckCircleIcon className="w-5 h-5" />;
  if (type === 'error') return <AlertCircleIcon className="w-5 h-5" />;
  return <InfoIcon className="w-5 h-5" />;
}

export function Toaster(): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    toastListener = (toast: Toast) => {
      setToasts((prev) => [...prev, toast]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 4000);
    };

    return () => {
      toastListener = null;
    };
  }, []);

  function removeToast(id: string): void {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-3 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className={getToastClasses(toast.type)}>
          <div className="flex-shrink-0 mt-0.5">
            <ToastIcon type={toast.type} />
          </div>

          <div className="flex-1 text-sm font-medium">{toast.message}</div>

          <button
            onClick={() => removeToast(toast.id)}
            className="flex-shrink-0 text-current opacity-60 hover:opacity-100 transition-opacity"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
