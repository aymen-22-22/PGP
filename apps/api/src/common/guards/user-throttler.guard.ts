import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { RequestUser } from '../types';

/**
 * Rate limiting keyed on the account, not the address.
 *
 * A warehouse is one internet connection. Keyed on IP, every picker, the
 * office and the till share a single bucket, so one busy scanning session
 * locks out everybody else in the building — and behind the host's reverse
 * proxy an untrusted `X-Forwarded-For` collapses all of them onto the proxy's
 * own address besides.
 *
 * `JwtAuthGuard` runs before this one (see app.module), so an authenticated
 * request already knows who it is. Anonymous traffic — chiefly the login
 * endpoint, which has its own far stricter bucket — still falls back to the
 * address, because that is all there is to go on and brute-force protection
 * depends on it.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as RequestUser | undefined;
    if (user?.id) return `user:${user.id}`;
    return super.getTracker(req);
  }
}
