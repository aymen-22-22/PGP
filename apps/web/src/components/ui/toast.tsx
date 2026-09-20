import { CheckCircle2, X, XCircle, AlertTriangle } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'warning';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = React.createContext<{ push: (tone: ToastTone, message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(0);

  const push = React.useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, tone, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4000);
  }, []);

  const dismiss = (id: number) => setToasts((current) => current.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end">
        {toasts.map((toast) => {
          const Icon = { success: CheckCircle2, error: XCircle, warning: AlertTriangle }[toast.tone];
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                'pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border p-3 shadow-lg',
                toast.tone === 'success' && 'border-success/40 bg-success text-success-foreground',
                toast.tone === 'error' && 'border-destructive/40 bg-destructive text-destructive-foreground',
                toast.tone === 'warning' && 'border-warning/40 bg-warning text-warning-foreground',
              )}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <span className="flex-1 text-sm font-medium">{toast.message}</span>
              <button onClick={() => dismiss(toast.id)} aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
