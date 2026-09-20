import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction } from '@phone-erp/shared-types';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  action: AuditAction | string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Keys that must never reach the audit table. */
const REDACTED = new Set(['password', 'currentPassword', 'newPassword', 'passwordHash', 'token', 'secret']);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an audit row. Auditing must never break the business operation it
   * describes, so failures are logged rather than thrown.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          metadata: sanitize(entry.metadata),
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent?.slice(0, 250) ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log for ${entry.action}`, error as Error);
    }
  }
}

function sanitize(value: Prisma.InputJsonValue | undefined): Prisma.InputJsonValue {
  if (value === undefined || value === null) return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  if (Array.isArray(value)) return value.map((v) => sanitize(v as Prisma.InputJsonValue));
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED.has(key) ? '[redacted]' : sanitize(val as Prisma.InputJsonValue);
    }
    return out;
  }
  return value;
}
