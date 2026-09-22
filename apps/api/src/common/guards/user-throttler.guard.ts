import { ExecutionContext, Injectable } from '@nestjs/common';
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
  /**
   * A signed-in account is never rate limited.
   *
   * Throttling authenticated traffic was costing more than it bought: a
   * picker working a pallet, or several staff on one connection, hit the
   * ceiling doing their job and the site simply stopped answering them.
   * Whoever is signed in already passed authentication and is scoped to
   * their own warehouse, so the protection this offered was slight.
   *
   * Login is another matter and keeps its own strict bucket — that one
   * guards a password, and anyone can knock on it.
   */
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const { req } = this.getRequestResponse(context);
    const user = (req as Record<string, unknown>).user as RequestUser | undefined;
    if (user?.id) return true;
    return super.shouldSkip(context);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as RequestUser | undefined;
    if (user?.id) return `user:${user.id}`;
    return super.getTracker(req);
  }
}
