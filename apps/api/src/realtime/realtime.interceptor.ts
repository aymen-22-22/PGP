import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { tap } from 'rxjs';
import type { Request } from 'express';
import { RealtimeService } from './realtime.service';

/**
 * Every successful write becomes a broadcast.
 *
 * Read models are derived from the same tables, so a change to one resource is
 * usually visible in several others: completing a sale moves money, stock and
 * reports at once. The extra scopes below mirror what the web app itself would
 * invalidate after such a mutation, but for every browser, not just the one
 * that acted.
 *
 * Only working responses are announced — a refused request changes nothing.
 */
@Injectable()
export class RealtimeInterceptor implements NestInterceptor {
  private static readonly MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

  /** Counting, costing and money are read together; refresh them together. */
  private static readonly DERIVED: Record<string, string[]> = {
    '/sales': ['/inventory', '/stock', '/reports'],
    '/pos': ['/inventory', '/stock', '/reports', '/sales'],
    '/returns': ['/inventory', '/stock', '/reports', '/sales'],
    '/receipts': ['/inventory', '/stock', '/reports', '/stock-explorer'],
    '/purchases': ['/inventory', '/reports', '/stock-explorer'],
    '/transfers': ['/inventory', '/stock', '/reports'],
    '/stock': ['/inventory', '/reports', '/stock-explorer'],
    '/costs': ['/inventory', '/reports'],
    '/cost-centers': ['/inventory'],
    '/warehouses': ['/inventory', '/stock'],
    '/products': ['/pricing', '/stock-explorer', '/stock'],
    '/brands': ['/products'],
    '/suppliers': ['/purchases'],
    '/customers': ['/sales'],
    '/users': [],
    '/imeis': ['/stock', '/inventory'],
    '/notifications': [],
  };

  constructor(private readonly realtime: RealtimeService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    if (!RealtimeInterceptor.MUTATING.has(req.method)) return next.handle();

    const path = (req.originalUrl ?? '').split('?')[0];
    const root = RealtimeInterceptor.resourceRoot(path);
    if (!root || root === '/events' || root === '/auth') return next.handle();

    const scopes = [root, ...(RealtimeInterceptor.DERIVED[root] ?? [])];
    return next.handle().pipe(
      tap(() => {
        this.realtime.emit({ path, scopes });
      }),
    );
  }

  /** `/api/v1/sales/2f/complete` → `/sales` (tolerates any `/api/<version>` prefix). */
  private static resourceRoot(path: string): string | null {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const first = parts[0] === 'api' ? 2 : 0;
    const segment = parts[first];
    if (!segment) return null;
    return `/${segment}`;
  }
}