import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PrinterConnectionType } from '@prisma/client';
import { AuditAction, ErrorCode, type AuthUser } from '@phone-erp/shared-types';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { BusinessError } from '../common/errors/business.error';
import { APP_CONFIG } from '../common/tokens';
import type { JwtPayload, RequestUser } from '../common/types';
import { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';

export interface LoginResult {
  user: AuthUser;
  accessToken: string;
  csrfToken: string;
}

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(email: string, password: string, ctx: RequestContext): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        warehouse: {
          select: {
            id: true,
            name: true,
            countryRef: { select: { id: true, code: true, currency: true } },
          },
        },
        costCenter: { select: { id: true, name: true } },
      },
    });

    // Verify against a dummy hash when the user is unknown so that the response
    // time does not reveal whether the address exists.
    const valid = user
      ? await this.passwords.verify(user.passwordHash, password)
      : await this.passwords.verify(DUMMY_HASH, password);

    if (!user || !valid) {
      await this.audit.log({
        userId: user?.id ?? null,
        action: AuditAction.LOGIN_FAILED,
        entityType: 'User',
        entityId: user?.id,
        metadata: { email },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new BusinessError(
        ErrorCode.INVALID_CREDENTIALS,
        'Incorrect email or password.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!user.isActive) {
      await this.audit.log({
        userId: user.id,
        action: AuditAction.LOGIN_FAILED,
        entityType: 'User',
        entityId: user.id,
        metadata: { reason: 'inactive' },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new BusinessError(
        ErrorCode.ACCOUNT_INACTIVE,
        'This account has been deactivated. Contact an administrator.',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      wid: user.warehouseId,
      tv: user.tokenVersion,
    };

    await this.audit.log({
      userId: user.id,
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        warehouseId: user.warehouseId,
        warehouseName: user.warehouse?.name ?? null,
        costCenterId: user.costCenterId,
        costCenterName: user.costCenter?.name ?? null,
        countryId: user.warehouse?.countryRef?.id ?? null,
        countryCode: user.warehouse?.countryRef?.code ?? null,
        countryCurrency: user.warehouse?.countryRef?.currency ?? null,
        notifyByEmail: user.notifyByEmail,
        printerConnectionType: user.printerConnectionType,
        printerAddress: user.printerAddress,
        printerLabelSize: user.printerLabelSize,
      },
      accessToken: this.jwt.sign(payload, { expiresIn: this.config.jwt.expiresIn }),
      csrfToken: randomBytes(24).toString('hex'),
    };
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        warehouse: {
          select: {
            id: true,
            name: true,
            countryRef: { select: { id: true, code: true, currency: true } },
          },
        },
        costCenter: { select: { id: true, name: true } },
      },
    });
    if (!user) throw BusinessError.notFound('User', userId);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      warehouseId: user.warehouseId,
      warehouseName: user.warehouse?.name ?? null,
      costCenterId: user.costCenterId,
      costCenterName: user.costCenter?.name ?? null,
      countryId: user.warehouse?.countryRef?.id ?? null,
      countryCode: user.warehouse?.countryRef?.code ?? null,
      countryCurrency: user.warehouse?.countryRef?.currency ?? null,
      notifyByEmail: user.notifyByEmail,
      printerConnectionType: user.printerConnectionType,
      printerAddress: user.printerAddress,
      printerLabelSize: user.printerLabelSize,
    };
  }

  async changePassword(
    user: RequestUser,
    currentPassword: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<void> {
    const record = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!record) throw BusinessError.notFound('User', user.id);

    if (!(await this.passwords.verify(record.passwordHash, currentPassword))) {
      throw new BusinessError(
        ErrorCode.INVALID_CREDENTIALS,
        'Your current password is incorrect.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (currentPassword === newPassword) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'The new password must be different from the current one.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      // Bumping tokenVersion signs out every other session immediately.
      data: { passwordHash: await this.passwords.hash(newPassword), tokenVersion: { increment: 1 } },
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.CHANGE_PASSWORD,
      entityType: 'User',
      entityId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  async logout(user: RequestUser, ctx: RequestContext): Promise<void> {
    await this.audit.log({
      userId: user.id,
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }
  /**
   * Someone changing their own settings.
   *
   * Deliberately not routed through the admin user endpoint: a person turning
   * off their own email should not need the permission to edit everyone.
   */
  async updatePreferences(
    user: RequestUser,
    dto: {
      notifyByEmail?: boolean;
      printerConnectionType?: PrinterConnectionType;
      printerAddress?: string;
      printerLabelSize?: string;
    },
  ) {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(dto.notifyByEmail !== undefined ? { notifyByEmail: dto.notifyByEmail } : {}),
        ...(dto.printerConnectionType !== undefined ? { printerConnectionType: dto.printerConnectionType } : {}),
        // An empty string clears the address (switching back to BROWSER, say).
        ...(dto.printerAddress !== undefined ? { printerAddress: dto.printerAddress || null } : {}),
        ...(dto.printerLabelSize !== undefined ? { printerLabelSize: dto.printerLabelSize } : {}),
      },
      select: {
        id: true,
        notifyByEmail: true,
        printerConnectionType: true,
        printerAddress: true,
        printerLabelSize: true,
      },
    });
    return updated;
  }

}

/** A real argon2id hash of a random string, used only for timing equalisation. */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZXg$Zr6Yc0Q1gWvJ1m1bLQxLZ0nFhRq2f3vE1oQhZ0k9r2A';
