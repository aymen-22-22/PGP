import { Injectable } from '@nestjs/common';
import { DeviceStatus, PurchaseStatus, Role, TransferStatus } from '@prisma/client';
import { ErrorCode, canSendBetween } from '@phone-erp/shared-types';
import { BusinessError } from '../common/errors/business.error';
import { DeviceScanService } from '../common/services/device-scan.service';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { PurchasesService } from '../purchases/purchases.service';
import { TransfersService } from '../transfers/transfers.service';

type ProductCard = { id: string; name: string; imageUrl: string | null };

/**
 * What a scanned code means *for this warehouse, right now*, and the one
 * thing to do about it. The warehouse user never has to know whether a phone
 * came on a purchase order or a transfer — the system does.
 */
export type ScanOutcome =
  | { status: 'INCOMING'; code: string; product: ProductCard; remaining: number; source: 'PURCHASE' | 'TRANSFER' }
  | {
      status: 'AVAILABLE';
      code: string;
      product: ProductCard;
      warehouse: string;
      destinations: { id: string; name: string; code: string }[];
    }
  | { status: 'ALREADY_RECEIVED' | 'PENDING_CHECK' | 'IN_TRANSIT' | 'SOLD' | 'UNAVAILABLE'; code: string; product: ProductCard; where: string | null }
  | { status: 'OTHER_WAREHOUSE'; code: string; product: ProductCard; where: string | null }
  | { status: 'NOT_FOUND'; code: string };

const OPEN_PURCHASE = [PurchaseStatus.ORDERED, PurchaseStatus.PARTIALLY_RECEIVED];

@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
    private readonly scans: DeviceScanService,
    private readonly purchases: PurchasesService,
    private readonly transfers: TransfersService,
  ) {}

  /** The warehouse the operation is for: a warehouse user's own; an admin must say. */
  warehouseFor(user: RequestUser, requested?: string): string {
    if (user.role !== Role.ADMIN) {
      if (!user.warehouseId) throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'Your account has no warehouse.');
      return user.warehouseId;
    }
    if (!requested) throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'Choose a warehouse first.');
    return requested;
  }

  /**
   * Products on their way to this warehouse, whatever brings them — an open
   * purchase order or a shipped transfer — summed per product.
   */
  async incoming(user: RequestUser, requested?: string) {
    const warehouseId = this.warehouseFor(user, requested);
    this.access.assertAccess(user, warehouseId);

    const [poLines, inTransit, bulkLines] = await Promise.all([
      this.prisma.purchaseItem.findMany({
        where: { purchase: { warehouseId, status: { in: OPEN_PURCHASE } } },
        select: {
          quantity: true,
          receivedQuantity: true,
          purchaseId: true,
          product: { select: { id: true, name: true, imageUrl: true } },
        },
      }),
      this.prisma.transferDevice.findMany({
        where: { receivedAt: null, transfer: { destinationWarehouseId: warehouseId, status: TransferStatus.IN_TRANSIT } },
        select: { device: { select: { product: { select: { id: true, name: true, imageUrl: true } } } } },
      }),
      this.prisma.transferItem.findMany({
        where: {
          transfer: { destinationWarehouseId: warehouseId, status: TransferStatus.IN_TRANSIT },
          product: { tracking: 'BULK' },
        },
        select: { shippedQuantity: true, receivedQuantity: true, product: { select: { id: true, name: true, imageUrl: true } } },
      }),
    ]);

    const byProduct = new Map<
      string,
      { product: ProductCard; toReceive: number; fromPurchases: number; fromTransfers: number; purchaseIds: string[] }
    >();
    const entry = (p: ProductCard) => {
      let e = byProduct.get(p.id);
      if (!e) byProduct.set(p.id, (e = { product: p, toReceive: 0, fromPurchases: 0, fromTransfers: 0, purchaseIds: [] }));
      return e;
    };
    for (const l of poLines) {
      const open = l.quantity - l.receivedQuantity;
      if (open <= 0) continue;
      const e = entry(l.product);
      e.toReceive += open;
      e.fromPurchases += open;
      if (!e.purchaseIds.includes(l.purchaseId)) e.purchaseIds.push(l.purchaseId);
    }
    for (const d of inTransit) {
      const e = entry(d.device.product);
      e.toReceive += 1;
      e.fromTransfers += 1;
    }
    for (const b of bulkLines) {
      const open = b.shippedQuantity - b.receivedQuantity;
      if (open <= 0) continue;
      const e = entry(b.product);
      e.toReceive += open;
      e.fromTransfers += open;
    }
    const items = [...byProduct.values()].sort((a, b) => b.toReceive - a.toReceive);
    return { warehouseId, total: items.reduce((s, i) => s + i.toReceive, 0), items };
  }

  /** Reads a code and says what it is here, and what can be done. Never changes anything. */
  async scan(user: RequestUser, code: string, requested?: string): Promise<ScanOutcome & { ref?: { kind: 'PURCHASE' | 'TRANSFER'; id: string } }> {
    const warehouseId = this.warehouseFor(user, requested);
    this.access.assertAccess(user, warehouseId);
    const clean = code.trim();

    // A label printed for a purchase order but not scanned in yet.
    const label = await this.prisma.purchaseUnitLabel.findUnique({
      where: { code: clean },
      select: {
        deviceId: true,
        purchaseItem: {
          select: {
            productId: true,
            purchase: { select: { id: true, warehouseId: true, status: true, warehouse: { select: { name: true } } } },
            product: { select: { id: true, name: true, imageUrl: true } },
          },
        },
      },
    });
    if (label && !label.deviceId) {
      const purchase = label.purchaseItem.purchase;
      const product = label.purchaseItem.product;
      if (purchase.warehouseId !== warehouseId) {
        return { status: 'OTHER_WAREHOUSE', code: clean, product, where: purchase.warehouse.name };
      }
      if (!OPEN_PURCHASE.includes(purchase.status as (typeof OPEN_PURCHASE)[number])) {
        return { status: 'UNAVAILABLE', code: clean, product, where: null };
      }
      const remaining = await this.remainingFor(warehouseId, product.id);
      return { status: 'INCOMING', code: clean, product, remaining, source: 'PURCHASE', ref: { kind: 'PURCHASE', id: purchase.id } };
    }

    const found = await this.scans.resolveOne(clean);
    if (!found) return { status: 'NOT_FOUND', code: clean };

    const device = await this.prisma.device.findUnique({
      where: { id: found.device.id },
      select: {
        status: true,
        transferId: true,
        currentWarehouseId: true,
        currentWarehouse: { select: { name: true } },
        product: { select: { id: true, name: true, imageUrl: true } },
        transfer: { select: { id: true, status: true, destinationWarehouseId: true, destinationWarehouse: { select: { name: true } } } },
      },
    });
    if (!device) return { status: 'NOT_FOUND', code: clean };
    const product = device.product;

    if (device.status === DeviceStatus.IN_TRANSFER && device.transfer) {
      if (device.transfer.destinationWarehouseId === warehouseId && device.transfer.status === TransferStatus.IN_TRANSIT) {
        const remaining = await this.remainingFor(warehouseId, product.id);
        return { status: 'INCOMING', code: found.code, product, remaining, source: 'TRANSFER', ref: { kind: 'TRANSFER', id: device.transfer.id } };
      }
      return { status: 'IN_TRANSIT', code: found.code, product, where: device.transfer.destinationWarehouse.name };
    }
    if (device.currentWarehouseId !== warehouseId) {
      if (device.status === DeviceStatus.SOLD) return { status: 'SOLD', code: found.code, product, where: null };
      return { status: 'OTHER_WAREHOUSE', code: found.code, product, where: device.currentWarehouse?.name ?? null };
    }
    if (device.status === DeviceStatus.IN_STOCK) {
      const [here, others] = await Promise.all([
        this.prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { code: true, countryRef: { select: { code: true } } } }),
        this.prisma.warehouse.findMany({
          where: { isActive: true, id: { not: warehouseId } },
          select: { id: true, name: true, code: true, countryRef: { select: { code: true } } },
          orderBy: { name: 'asc' },
        }),
      ]);
      // Only where this warehouse is allowed to send (France → Spain → Algeria).
      const destinations = here
        ? others.filter((w) => canSendBetween(here, w)).map(({ id, name, code }) => ({ id, name, code }))
        : [];
      return { status: 'AVAILABLE', code: found.code, product, warehouse: device.currentWarehouse?.name ?? '', destinations };
    }
    if (device.status === DeviceStatus.SOLD) return { status: 'SOLD', code: found.code, product, where: null };
    if (device.status === DeviceStatus.RECEIVED || device.status === DeviceStatus.PENDING_IDENTIFICATION) {
      return { status: 'PENDING_CHECK', code: found.code, product, where: device.currentWarehouse?.name ?? null };
    }
    return { status: 'UNAVAILABLE', code: found.code, product, where: device.currentWarehouse?.name ?? null };
  }

  /** "Recevoir": books in the scanned unit, whether it came on a purchase or a transfer. */
  async receive(user: RequestUser, code: string, requested?: string) {
    const outcome = await this.scan(user, code, requested);
    if (outcome.status !== 'INCOMING' || !outcome.ref) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'This code is not waiting to be received here.', 400, {
        status: outcome.status,
      });
    }
    if (outcome.ref.kind === 'PURCHASE') {
      await this.purchases.receiveByLabel(user, outcome.ref.id, { code: outcome.code });
    } else {
      await this.transfers.receive(user, outcome.ref.id, { imeis: [outcome.code], allowPartial: true });
    }
    const warehouseId = this.warehouseFor(user, requested);
    return {
      code: outcome.code,
      product: outcome.product,
      remaining: await this.remainingFor(warehouseId, outcome.product.id),
    };
  }

  /** "Envoyer": one transfer for everything scanned, created and shipped in one go. */
  async send(user: RequestUser, codes: string[], destinationWarehouseId: string, requested?: string) {
    const warehouseId = this.warehouseFor(user, requested);
    this.access.assertAccess(user, warehouseId);
    if (destinationWarehouseId === warehouseId) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'Choose another warehouse to send to.');
    }
    const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
    const { resolved, missing } = await this.scans.resolve(unique);
    if (missing.length > 0) {
      throw new BusinessError(ErrorCode.IMEI_NOT_FOUND, `${missing.length} code(s) are unknown.`, 404, { codes: missing });
    }
    const notHere = resolved.filter((r) => r.device.status !== DeviceStatus.IN_STOCK || r.device.currentWarehouseId !== warehouseId);
    if (notHere.length > 0) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, `${notHere.length} phone(s) are not available in this warehouse.`, 400, {
        codes: notHere.map((r) => r.code),
      });
    }
    const perProduct = new Map<string, number>();
    for (const r of resolved) perProduct.set(r.device.productId, (perProduct.get(r.device.productId) ?? 0) + 1);

    const created = await this.transfers.create(user, {
      sourceWarehouseId: warehouseId,
      destinationWarehouseId,
      items: [...perProduct].map(([productId, quantity]) => ({ productId, quantity })),
      imeis: resolved.map((r) => r.code),
    });
    await this.transfers.ship(user, created.id, {});
    return { transferId: created.id, number: created.number, count: resolved.length };
  }

  /** What happened in this warehouse lately, one line per step (not per phone). */
  async activity(user: RequestUser, requested?: string) {
    const warehouseId = this.warehouseFor(user, requested);
    this.access.assertAccess(user, warehouseId);
    const rows = await this.prisma.deviceMovement.findMany({
      where: { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] },
      orderBy: { createdAt: 'desc' },
      take: 400,
      select: {
        type: true,
        createdAt: true,
        referenceId: true,
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
        performedBy: { select: { name: true } },
        device: { select: { product: { select: { id: true, name: true, imageUrl: true } } } },
      },
    });
    const steps = new Map<
      string,
      { type: string; at: string; product: ProductCard; count: number; from: string | null; to: string | null; by: string | null }
    >();
    for (const m of rows) {
      const key = [m.type, m.referenceId ?? m.createdAt.toISOString(), m.device.product.id].join('|');
      const step = steps.get(key);
      if (step) step.count += 1;
      else
        steps.set(key, {
          type: m.type,
          at: m.createdAt.toISOString(),
          product: m.device.product,
          count: 1,
          from: m.fromWarehouse?.name ?? null,
          to: m.toWarehouse?.name ?? null,
          by: m.performedBy?.name ?? null,
        });
    }
    return { data: [...steps.values()].slice(0, 40) };
  }

  /** Units of one product still to arrive here — the number the scanner counts down. */
  private async remainingFor(warehouseId: string, productId: string): Promise<number> {
    const [po, transit] = await Promise.all([
      this.prisma.purchaseItem.findMany({
        where: { productId, purchase: { warehouseId, status: { in: OPEN_PURCHASE } } },
        select: { quantity: true, receivedQuantity: true },
      }),
      this.prisma.transferDevice.count({
        where: {
          receivedAt: null,
          device: { productId },
          transfer: { destinationWarehouseId: warehouseId, status: TransferStatus.IN_TRANSIT },
        },
      }),
    ]);
    return po.reduce((s, l) => s + Math.max(0, l.quantity - l.receivedQuantity), 0) + transit;
  }
}
