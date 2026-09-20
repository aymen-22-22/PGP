import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BusinessError } from '../errors/business.error';
import type { RequestUser } from '../types';

/**
 * Central authority on "which warehouses may this user touch".
 *
 * Every service that reads or writes warehouse-scoped data goes through here.
 * Hiding a page in the frontend is not authorisation; this is.
 */
@Injectable()
export class WarehouseAccessService {
  isAdmin(user: RequestUser): boolean {
    return user.role === Role.ADMIN;
  }

  /** Warehouse ids the user may read. `null` means "no restriction" (admin). */
  allowedWarehouseIds(user: RequestUser): string[] | null {
    if (this.isAdmin(user)) return null;
    return user.warehouseId ? [user.warehouseId] : [];
  }

  canAccess(user: RequestUser, warehouseId: string | null | undefined): boolean {
    if (this.isAdmin(user)) return true;
    if (!warehouseId) return false;
    return user.warehouseId === warehouseId;
  }

  /** Throws unless the user may act on `warehouseId`. */
  assertAccess(user: RequestUser, warehouseId: string | null | undefined): void {
    if (!this.canAccess(user, warehouseId)) {
      throw BusinessError.forbiddenWarehouse(warehouseId ?? undefined);
    }
  }

  /**
   * Resolves the warehouse a write should target. A warehouse user may only ever
   * operate on their own warehouse, even if they post a different id.
   */
  resolveWarehouseId(user: RequestUser, requested?: string | null): string {
    if (this.isAdmin(user)) {
      if (!requested) {
        throw new BusinessError('VALIDATION_FAILED', 'warehouseId is required for administrators.');
      }
      return requested;
    }
    if (!user.warehouseId) {
      throw BusinessError.forbiddenWarehouse();
    }
    if (requested && requested !== user.warehouseId) {
      throw BusinessError.forbiddenWarehouse(requested);
    }
    return user.warehouseId;
  }

  /**
   * A Prisma filter restricting a single warehouse column to what the user may see.
   * Returns `{}` for admins so the query stays unfiltered.
   */
  filterFor<W extends object>(user: RequestUser, field: string, requested?: string | null): W {
    const allowed = this.allowedWarehouseIds(user);
    if (allowed === null) {
      return (requested ? { [field]: requested } : {}) as W;
    }
    if (requested) {
      if (!allowed.includes(requested)) throw BusinessError.forbiddenWarehouse(requested);
      return { [field]: requested } as W;
    }
    return { [field]: { in: allowed } } as W;
  }

  /**
   * Filter for rows visible to a warehouse when they may be linked through either
   * of two warehouse columns (transfers: source OR destination).
   */
  filterForEither<W extends object>(
    user: RequestUser,
    fieldA: string,
    fieldB: string,
    requested?: string | null,
  ): W {
    const allowed = this.allowedWarehouseIds(user);
    if (allowed === null) {
      return (requested ? { OR: [{ [fieldA]: requested }, { [fieldB]: requested }] } : {}) as W;
    }
    if (requested && !allowed.includes(requested)) throw BusinessError.forbiddenWarehouse(requested);
    const ids = requested ? [requested] : allowed;
    return { OR: [{ [fieldA]: { in: ids } }, { [fieldB]: { in: ids } }] } as W;
  }
}
