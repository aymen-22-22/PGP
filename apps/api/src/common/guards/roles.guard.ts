import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ErrorCode } from '@phone-erp/shared-types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { BusinessError } from '../errors/business.error';
import type { RequestUser } from '../types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as RequestUser | undefined;
    if (!user) {
      throw new BusinessError(ErrorCode.UNAUTHENTICATED, 'Authentication required.', HttpStatus.UNAUTHORIZED);
    }
    if (!required.includes(user.role)) {
      throw new BusinessError(
        ErrorCode.FORBIDDEN,
        'You do not have permission to perform this action.',
        HttpStatus.FORBIDDEN,
        { requiredRole: required },
      );
    }
    return true;
  }
}
