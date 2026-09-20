import { Injectable, type MessageEvent } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Observable } from 'rxjs';

/**
 * A change made by one user, to be broadcast to every open screen.
 *
 * `scopes` are the query-key prefixes a client should refresh: the resource the
 * mutation touched plus any derived reads (a sale also moves inventory, so a
 * receipt validation also changes `/inventory` and `/reports`).
 */
export interface RealtimeEvent {
  /** The API path that was changed, e.g. `/purchases/2f49/complete`. */
  path: string;
  /** Query-key prefixes to invalidate, starting with `/`. */
  scopes: string[];
}

const EVENTS_CHANNEL = 'app:changed';

/**
 * The in-process announcement bus behind every live screen.
 *
 * Nothing durable and nothing heavy: a server-sent event is a nudge to refetch,
 * not a payload. The database stays the source of truth, which is why a dropped
 * SSE connection costs nothing — the polling fallback on the client covers it.
 */
@Injectable()
export class RealtimeService {
  private readonly bus = new EventEmitter();

  private static readonly HEARTBEAT_MS = 20_000;

  /** Broadcast a change to every connected screen. */
  emit(event: RealtimeEvent): void {
    this.bus.emit(EVENTS_CHANNEL, {
      type: 'change',
      at: new Date().toISOString(),
      ...event,
    });
  }

  /** How many browsers are listening — used by tests to await deliveries. */
  listenerCount(): number {
    return this.bus.listenerCount(EVENTS_CHANNEL);
  }

  /**
   * The event stream for one browser.
   *
   * Ends when the browser disconnects or the observable is torn down; nothing
   * leaks across requests.
   */
  subscribe(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((observer) => {
      const deliver = (event: unknown): void => {
        observer.next({ data: JSON.stringify(event) } as MessageEvent);
      };

      this.bus.on(EVENTS_CHANNEL, deliver);

      // Confirms the stream is live without waiting for the first change.
      observer.next({
        data: JSON.stringify({ type: 'ready', scopes: [] }),
      } as MessageEvent);

      // Proxies and mobile networks close idle HTTP bodies; a blank data line
      // every twenty seconds is enough to keep the connection open.
      const heartbeat = setInterval(() => {
        observer.next({ data: '' } as MessageEvent);
      }, RealtimeService.HEARTBEAT_MS);

      return () => {
        clearInterval(heartbeat);
        this.bus.off(EVENTS_CHANNEL, deliver);
      };
    });
  }
}