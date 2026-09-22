import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from '@/i18n/provider';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/toast';
import { AppErrorBoundary } from '@/app/error-boundary';
import { AppRouter } from '@/app/router';
import { RealtimeSync } from '@/lib/realtime';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Warehouse data changes constantly; a stale count is worse than a refetch.
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      // Background polling is the fallback half of live data: server-sent
      // events refresh the moment something changes, this catches anything
      // that slips through while the screen is open and nobody is watching it.
      refetchInterval: 30_000,
      // Only while the screen is actually being looked at. Polling hidden tabs
      // too meant every forgotten tab kept spending requests for as long as it
      // stayed open, which is what pushed a busy shop into rate limiting.
      refetchIntervalInBackground: false,
      retry: (failureCount, error) => {
        // Never retry a refusal — it will be refused again.
        if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

// Restore the session before the first render decides what to show.
void useAuth.getState().refresh();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      {/* Outermost of the app providers: an error message shown by anything
          inside should already be in the reader's language. */}
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <RealtimeSync />
          <ToastProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <AppRouter />
            </BrowserRouter>
          </ToastProvider>
        </QueryClientProvider>
      </I18nProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
