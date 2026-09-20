import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RealtimeService } from './realtime.service';

/**
 * Server-sent events for live screens.
 *
 * Sampled as a GET, so it rides the same cookie session as every other request
 * and needs no token plumbing. One long-lived connection per open browser;
 * mutations are announced through it and the database is re-queried on receipt.
 */
@Controller('events')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Sse()
  stream(): Observable<MessageEvent> {
    return this.realtime.subscribe();
  }
}