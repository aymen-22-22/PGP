import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { useAuth } from './auth';

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

interface ChangeMessage {
  /** `ready` opens a connection; `change` announces a mutation. */
  type: 'change' | 'ready';
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
    // Whether this is the stream's first `ready`, or a later one after the
    // browser silently reconnected.
    let opened = false;

    source.onmessage = (event) => {
      if (cancelled) return;
      let message: ChangeMessage;
      try {
        message = JSON.parse(event.data) as ChangeMessage;
      } catch {
        return; // heartbeat or non-JSON line
      }

      // The server sends `ready` on every connection, so a second one means
      // the browser reconnected. EventSource does that silently and the stream
      // replays nothing, so every change announced while it was down is simply
      // gone — and the screen keeps showing what it had until the polling
      // fallback comes round, up to half a minute later. Refetching everything
      // on reconnect closes that window. A proxy with a short idle timeout
      // turns this from an edge case into the normal path.
      if (message?.type === 'ready') {
        if (opened) void queryClient.invalidateQueries();
        opened = true;
        return;
      }

      if (message?.type !== 'change' || !Array.isArray(message.scopes)) return;

      for (const scope of message.scopes) {
        void queryClient.invalidateQueries({
          predicate: (query) => String(query.queryKey[0] ?? '').startsWith(scope),
        });
      }
    };

    // The browser reconnects on its own; what it cannot do is tell us what was
    // missed, which is what the `ready` above is for.
    source.onerror = () => {};

    return () => {
      cancelled = true;
      source.close();
    };
  }, [status, queryClient]);

  return null;
}