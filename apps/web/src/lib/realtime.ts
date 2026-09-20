import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { useAuth } from './auth';

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

interface ChangeMessage {
  type: 'change';
  /** Query-key prefixes to refetch, starting with `/`. */
  scopes: string[];
  at?: string;
}

/**
 * One long-lived server-sent connection per open browser.
 *
 * Every successful write anywhere in the system is announced here, and the
 * affected queries are invalidated immediately — refreshing that user's stock,
 * receipts and reports while another user is mid-operation at the counter.
 *
 * The connection costs nothing when idle, and if it drops the browser's
 * EventSource reconnects by itself. The global `refetchInterval` remains as a
 * belt-and-braces fallback for anything that never fires an event.
 */
export function RealtimeSync() {
  const status = useAuth((store) => store.status);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (status !== 'authenticated') return;

    const source = new EventSource(`${BASE}/events`, { withCredentials: true });
    let cancelled = false;

    source.onmessage = (event) => {
      if (cancelled) return;
      let change: ChangeMessage;
      try {
        change = JSON.parse(event.data) as ChangeMessage;
      } catch {
        return; // heartbeat or non-JSON line
      }
      if (change?.type !== 'change' || !Array.isArray(change.scopes)) return;

      for (const scope of change.scopes) {
        void queryClient.invalidateQueries({
          predicate: (query) => String(query.queryKey[0] ?? '').startsWith(scope),
        });
      }
    };

    // EventSource reconnects automatically; the open stream is its own
    // keep-alive, so there is nothing to recover here.
    source.onerror = () => {};

    return () => {
      cancelled = true;
      source.close();
    };
  }, [status, queryClient]);

  return null;
}