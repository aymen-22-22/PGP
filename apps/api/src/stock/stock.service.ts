import { Injectable } from '@nestjs/common';
import { Currency, MovementType, Prisma, TrackingMode } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  type Listed,
  type StockLevel as StockLevelDto,
} from '@phone-erp/shared-types';
import { BusinessError } from '../common/errors/business.error';
import { AuditService } from '../audit/audit.service';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustStockDto, QueryStockDto } from './dto/stock.dto';

/** The transaction client the callers already have open. */
type Tx = Prisma.TransactionClient;

export interface StockMove {
  productId: string;
  warehouseId: string;
  quantity: number;
  type: MovementType;
  performedById?: string;
  referenceType?: string;
  referenceId?: string;
  referenceNumber?: string;
  notes?: string;
}

/**
 * Quantity accounting for BULK products (spec §12, extended).
 *
 * Every change to a bulk quantity goes through here, so there is exactly one
 * place where a level can move and exactly one place that writes the ledger.
 * Callers pass their own transaction: a receipt that writes devices and
 * quantities must commit or roll back as one thing.
 *
 * The concurrency primitive is the same one the serialised flow uses — a
 * guarded conditional UPDATE whose affected-row count is checked — rather than
 * a read, a decision in JavaScript, and a write. Two tills selling the last
 * cable at the same instant both read "1 in stock"; only the one whose UPDATE
 * matches `quantity >= 1` gets it.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
    private readonly audit: AuditService,
  ) {}

  /** Adds stock and re-averages the unit cost. */
  async receive(
    tx: Tx,
    move: StockMove & { unitCost: Prisma.Decimal | string; currency: Currency },
  ): Promise<void> {
    if (move.quantity <= 0) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'Received quantity must be positive.');
    }
    const unitCost = new Prisma.Decimal(move.unitCost);

    const existing = await tx.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: move.productId, warehouseId: move.warehouseId } },
      select: { quantity: true, avgUnitCost: true },
    });

    // Weighted average: the cost of what is already on the shelf, plus the cost
    // of what is arriving, over the new total. Identical units cannot be told
    // apart, so this is the only figure that can honestly be quoted for one.
    const nextQuantity = (existing?.quantity ?? 0) + move.quantity;
    const nextAvg =
      existing && existing.quantity > 0
        ? existing.avgUnitCost
            .times(existing.quantity)
            .plus(unitCost.times(move.quantity))
            .dividedBy(nextQuantity)
            .toDecimalPlaces(4)
        : unitCost;

    await tx.stockLevel.upsert({
      where: { productId_warehouseId: { productId: move.productId, warehouseId: move.warehouseId } },
      create: {
        productId: move.productId,
        warehouseId: move.warehouseId,
        quantity: move.quantity,
        avgUnitCost: unitCost,
        currency: move.currency,
      },
      update: { quantity: nextQuantity, avgUnitCost: nextAvg },
    });

    await this.writeLedger(tx, move, move.quantity, unitCost, move.currency);
  }

  /**
   * Removes stock, refusing to go negative.
   *
   * Returns the unit cost the units left at, which is what the caller needs to
   * book cost of sale. Issuing does not move the average.
   */
  async issue(tx: Tx, move: StockMove): Promise<{ unitCost: Prisma.Decimal; currency: Currency }> {
    if (move.quantity <= 0) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'Issued quantity must be positive.');
    }

    const level = await tx.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: move.productId, warehouseId: move.warehouseId } },
      select: { avgUnitCost: true, currency: true, quantity: true },
    });

    // The guard is in the WHERE clause, not in an `if` above it. Checking the
    // level and then decrementing it would let two concurrent sales both pass
    // the check and drive the quantity below zero.
    const updated = await tx.stockLevel.updateMany({
      where: {
        productId: move.productId,
        warehouseId: move.warehouseId,
        quantity: { gte: move.quantity },
      },
      data: { quantity: { decrement: move.quantity } },
    });

    if (updated.count === 0) {
      const available = level?.quantity ?? 0;
      throw new BusinessError(
        ErrorCode.INSUFFICIENT_STOCK,
        `Only ${available} in stock at this warehouse — ${move.quantity} were requested.`,
        409,
        { productId: move.productId, warehouseId: move.warehouseId, available, requested: move.quantity },
      );
    }

    const unitCost = level?.avgUnitCost ?? new Prisma.Decimal(0);
    const currency = level?.currency ?? Currency.EUR;
    await this.writeLedger(tx, move, -move.quantity, unitCost, currency);
    return { unitCost, currency };
  }

  /**
   * Refuses a request that treats a product as the wrong kind of stock.
   *
   * Scanning an IMEI against a box of cables, or sending a quantity for a
   * phone, is a mistake worth naming rather than silently half-handling.
   */
  assertTracking(
    product: { id: string; name: string; tracking: TrackingMode },
    expected: TrackingMode,
  ): void {
    if (product.tracking === expected) return;
    throw new BusinessError(
      ErrorCode.TRACKING_MODE_MISMATCH,
      product.tracking === TrackingMode.SERIALIZED
        ? `${product.name} is tracked by IMEI — scan each unit rather than entering a quantity.`
        : `${product.name} is an accessory tracked by quantity — enter how many rather than scanning IMEIs.`,
      400,
      { productId: product.id, tracking: product.tracking },
    );
  }

  /** On-hand quantity, or 0 where the product has never been stocked here. */
  async available(productId: string, warehouseId: string): Promise<number> {
    const level = await this.prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
      select: { quantity: true },
    });
    return level?.quantity ?? 0;
  }

  /** On-hand accessory quantities, scoped to what the user may see. */
  async levels(user: RequestUser, query: QueryStockDto): Promise<Listed<StockLevelDto>> {
    const scope = this.access.filterFor<Prisma.StockLevelWhereInput>(
      user,
      'warehouseId',
      query.warehouseId,
    );

    const levels = await this.prisma.stockLevel.findMany({
      where: {
        ...scope,
        product: {
          tracking: TrackingMode.BULK,
          ...(query.search
            ? {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { sku: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      include: {
        product: { select: { id: true, name: true, sku: true, defaultSalePrice: true, currency: true } },
        warehouse: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ warehouse: { name: 'asc' } }, { product: { name: 'asc' } }],
    });

    const data = levels.map((l) => ({
      productId: l.product.id,
      productName: l.product.name,
      sku: l.product.sku,
      warehouseId: l.warehouse.id,
      warehouseName: l.warehouse.name,
      warehouseCode: l.warehouse.code,
      quantity: l.quantity,
      avgUnitCost: l.avgUnitCost.toDecimalPlaces(2).toFixed(2),
      salePrice: l.product.defaultSalePrice.toFixed(2),
      currency: l.currency,
      stockValue: l.avgUnitCost.times(l.quantity).toDecimalPlaces(2).toFixed(2),
    }));

    return { data, meta: { total: data.length } };
  }

  /**
   * Sets a counted quantity to what was physically found.
   *
   * Serialised stock never needs this — a phone that is not on the shelf is a
   * specific IMEI, and marking that one LOST says something true. A bulk
   * shortfall names no unit, so the only honest record is the size of the gap
   * and the reason given for it.
   */
  async adjust(user: RequestUser, dto: AdjustStockDto) {
    this.access.assertAccess(user, dto.warehouseId);

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, name: true, tracking: true },
    });
    if (!product) throw BusinessError.notFound('Product', dto.productId);
    this.assertTracking(product, TrackingMode.BULK);

    const result = await this.prisma.$transaction(async (tx) => {
      const level = await tx.stockLevel.findUnique({
        where: { productId_warehouseId: { productId: dto.productId, warehouseId: dto.warehouseId } },
        select: { quantity: true, avgUnitCost: true, currency: true },
      });
      const before = level?.quantity ?? 0;
      const delta = dto.countedQuantity - before;
      if (delta === 0) return { before, after: before, delta };

      await tx.stockLevel.upsert({
        where: { productId_warehouseId: { productId: dto.productId, warehouseId: dto.warehouseId } },
        create: {
          productId: dto.productId,
          warehouseId: dto.warehouseId,
          quantity: dto.countedQuantity,
          avgUnitCost: 0,
          currency: Currency.EUR,
        },
        update: { quantity: dto.countedQuantity },
      });

      // The ledger records the correction, never a silent overwrite: the
      // quantity can always be rebuilt from these entries.
      await this.writeLedger(
        tx,
        {
          productId: dto.productId,
          warehouseId: dto.warehouseId,
          quantity: Math.abs(delta),
          type: MovementType.ADJUSTMENT,
          performedById: user.id,
          referenceType: 'StockCount',
          notes: dto.reason,
        },
        delta,
        level?.avgUnitCost ?? new Prisma.Decimal(0),
        level?.currency ?? Currency.EUR,
      );

      return { before, after: dto.countedQuantity, delta };
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.ADJUST_STOCK,
      entityType: 'StockLevel',
      entityId: `${dto.productId}:${dto.warehouseId}`,
      metadata: { product: product.name, ...result, reason: dto.reason },
    });

    return { productId: dto.productId, warehouseId: dto.warehouseId, ...result };
  }

  private async writeLedger(
    tx: Tx,
    move: StockMove,
    signedQuantity: number,
    unitCost: Prisma.Decimal,
    currency: Currency,
  ): Promise<void> {
    await tx.stockMovement.create({
      data: {
        productId: move.productId,
        warehouseId: move.warehouseId,
        type: move.type,
        quantity: signedQuantity,
        unitCost,
        currency,
        referenceType: move.referenceType,
        referenceId: move.referenceId,
        referenceNumber: move.referenceNumber,
        performedById: move.performedById,
        notes: move.notes,
      },
    });
  }
}
