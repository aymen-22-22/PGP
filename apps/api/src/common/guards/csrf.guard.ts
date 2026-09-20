import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@phone-erp/shared-types';
import type { Request } from 'express';
import { AppConfig } from '../../config/configuration';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { BusinessError } from '../errors/business.error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection, required only because the browser client
 * authenticates with an HTTP-only cookie. Requests that present a Bearer token
 * instead (server-to-server, tests) cannot be forged by a third-party site and
 * are exempt.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    // Public endpoints act for nobody, so there is no authority to forge. Login
    // is the important case: a first-time visitor holds no CSRF cookie and is
    // exempt anyway, so enforcing the check here would protect nothing while
    // permanently locking out anyone left holding a stale session cookie — the
    // cookie is HttpOnly, so the page cannot clear it and reloading will not help.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const usesCookieAuth = Boolean(req.cookies?.[this.config.cookie.name]);
    const hasBearer = (req.headers.authorization ?? '').startsWith('Bearer ');
    if (!usesCookieAuth || hasBearer) return true;

    const cookieToken = req.cookies?.[this.config.cookie.csrfName];
    const headerToken = req.headers['x-csrf-token'];

    if (!cookieToken || typeof headerToken !== 'string' || headerToken !== cookieToken) {
      throw new BusinessError(
        ErrorCode.FORBIDDEN,
        'Invalid or missing CSRF token. Please reload the page.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
