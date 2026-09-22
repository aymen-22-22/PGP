import { Inject, Injectable } from '@nestjs/common';
import {
  Currency,
  DeviceStatus,
  MovementType,
  Prisma,
  ShipmentStatus,
  TrackingMode,
  TransferStatus,
} from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  type Paginated,
  type TransferListItem,
} from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';
import { BusinessError } from '../common/errors/business.error';
import { normalizeScanCodes } from '../common/pipes/imei.util';
import { DocumentNumberService } from '../common/services/document-number.service';
import { MovementService } from '../common/services/movement.service';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import { APP_CONFIG } from '../common/tokens';
import type { RequestUser } from '../common/types';
import { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockService } from '../stock/stock.service';
import {
  CreateTransferDto,
  LoadDevicesDto,
  QueryTransfersDto,
  ReceiveTransferDto,
  ShipTransferDto,
} from './dto/transfer.dto';

/** Statuses in which a transfer may still be edited at the source. */
const EDITABLE: TransferStatus[] = [TransferStatus.DRAFT, TransferStatus.READY];

/**
 * Statuses in which a transfer still holds a claim on its devices.
 *
 * A device is only stamped with `Device.transferId` at dispatch, so between
 * loading and shipping the sole record of the claim is its `TransferDevice`
 * row. Anything that picks or reserves stock must consult it, or the same
 * handset ends up promised to two warehouses.
 */
const CLAIMING: TransferStatus[] = [TransferStatus.DRAFT, TransferStatus.READY, TransferStatus.IN_TRANSIT];

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
    private readonly numbers: DocumentNumberService,
    private readonly movements: MovementService,
    private readonly stock: StockService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(user: RequestUser, query: QueryTransfersDto): Promise<Paginated<TransferListItem<Date>>> {
    const scope = query.incoming
      ? this.access.filterFor<Prisma.TransferWhereInput>(user, 'destinationWarehouseId', query.warehouseId)
      : query.outgoing
        ? this.access.filterFor<Prisma.TransferWhereInput>(user, 'sourceWarehouseId', query.warehouseId)
        : this.access.filterForEither<Prisma.TransferWhereInput>(
            user,
            'sourceWarehouseId',
            'destinationWarehouseId',
            query.warehouseId,
          );

    const where: Prisma.TransferWhereInput = {
      ...scope,
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search ? { number: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transfer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        select: {
          id: true,
          number: true,
          status: true,
          createdAt: true,
          sourceWarehouse: { select: { id: true, name: true } },
          destinationWarehouse: { select: { id: true, name: true } },
          shipment: { select: { number: true, status: true, shippedAt: true } },
          items: { select: { quantity: true } },
          _count: { select: { devices: true } },
        },
      }),
      this.prisma.transfer.count({ where }),
    ]);

    // One extra grouped query instead of one query per row.
    const ids = rows.map((r) => r.id);
    const receivedCounts = ids.length
      ? await this.prisma.transferDevice.groupBy({
          by: ['transferId'],
          where: { transferId: { in: ids }, receivedAt: { not: null } },
          _count: { _all: true },
        })
      : [];
    const receivedByTransfer = new Map(receivedCounts.map((c) => [c.transferId, c._count._all]));

    const data = rows.map(({ items, _count, ...t }) => ({
      ...t,
      plannedQuantity: items.reduce((s, i) => s + i.quantity, 0),
      loadedQuantity: _count.devices,
      receivedQuantity: receivedByTransfer.get(t.id) ?? 0,
      shipmentNumber: t.shipment?.number ?? null,
      shipmentStatus: t.shipment?.status ?? null,
    }));
    return paginate(data, total, query);
  }

  async findOne(user: RequestUser, id: string) {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id },
      include: {
        sourceWarehouse: { select: { id: true, name: true, code: true } },
        destinationWarehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true } },
        shipment: {
          include: {
            shippedBy: { select: { id: true, name: true } },
            receivedBy: { select: { id: true, name: true } },
          },
        },
        items: { include: { product: { select: { id: true, name: true, sku: true, tracking: true } } } },
      },
    });
    if (!transfer) throw BusinessError.notFound('Transfer', id);
    this.assertInvolved(user, transfer.sourceWarehouseId, transfer.destinationWarehouseId);

    // The payload is capped for response size, but the quantities must report
    // the truth for a transfer of any size — they drive "pick list" screens.
    const [devices, loadedQuantity, receivedQuantity] = await Promise.all([
      this.prisma.transferDevice.findMany({
        where: { transferId: id },
        orderBy: { createdAt: 'asc' },
        take: 2000,
        select: {
          id: true,
          imei: true,
          receivedAt: true,
          device: {
            select: { id: true, status: true, product: { select: { id: true, name: true, sku: true } } },
          },
        },
      }),
      this.prisma.transferDevice.count({ where: { transferId: id } }),
      this.prisma.transferDevice.count({ where: { transferId: id, receivedAt: { not: null } } }),
    ]);

    return {
      ...transfer,
      devices,
      plannedQuantity: transfer.items.reduce((s, i) => s + i.quantity, 0),
      loadedQuantity,
      receivedQuantity,
    };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(user: RequestUser, dto: CreateTransferDto) {
    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'The source and destination warehouses must be different.',
      );
    }
    // Only the warehouse giving the stock away may create the transfer.
    this.access.assertAccess(user, dto.sourceWarehouseId);

    const [source, destination] = await Promise.all([
      this.prisma.warehouse.findUnique({ where: { id: dto.sourceWarehouseId }, select: { id: true } }),
      this.prisma.warehouse.findUnique({ where: { id: dto.destinationWarehouseId }, select: { id: true } }),
    ]);
    if (!source) throw BusinessError.notFound('Source warehouse', dto.sourceWarehouseId);
    if (!destination) throw BusinessError.notFound('Destination warehouse', dto.destinationWarehouseId);

    const productIds = dto.items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'The same product appears on two lines.');
    }

    const transfer = await this.prisma.$transaction(async (tx) => {
      const number = await this.numbers.next(tx, 'TR');
      const shipmentNumber = await this.numbers.next(tx, 'SHP');
      return tx.transfer.create({
        data: {
          number,
          sourceWarehouseId: dto.sourceWarehouseId,
          destinationWarehouseId: dto.destinationWarehouseId,
          status: TransferStatus.DRAFT,
          notes: dto.notes,
          createdById: user.id,
          items: { create: dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })) },
          // The shipment is the physical counterpart of the transfer and is
          // created with it, so there is never a transfer without one.
          shipment: { create: { number: shipmentNumber, status: ShipmentStatus.PREPARING } },
        },
      });
    });

    if (dto.imeis?.length) {
      await this.loadDevices(user, transfer.id, { imeis: dto.imeis });
    } else if (dto.autoFill) {
      await this.autoFill(user, transfer.id);
    }

    await this.audit.log({
      userId: user.id,
      action: AuditAction.CREATE_TRANSFER,
      entityType: 'Transfer',
      entityId: transfer.id,
      metadata: {
        number: transfer.number,
        from: dto.sourceWarehouseId,
        to: dto.destinationWarehouseId,
        planned: dto.items.reduce((s, i) => s + i.quantity, 0),
      },
    });
    return this.findOne(user, transfer.id);
  }

  /**
   * Resolves scanned codes to devices, trying each as an IMEI first (legacy
   * stock, still supported) and falling back to a printed unit label's code —
   * the only thing goods received through the label-first workflow ever
   * carries, since that path never asks for an IMEI. Returns each resolved
   * device paired with the exact code that found it, since that is what gets
   * stored and scanned again at receive time — not the device's own IMEI,
   * which may not exist.
   */
  private async resolveDevicesByScanCode(codes: string[]): Promise<{
    resolved: { device: { id: string; imei: string | null; status: DeviceStatus; currentWarehouseId: string | null; productId: string }; code: string }[];
    missing: string[];
  }> {
    if (codes.length === 0) return { resolved: [], missing: [] };

    const byImei = await this.prisma.device.findMany({
      where: { imei: { in: codes } },
      select: { id: true, imei: true, status: true, currentWarehouseId: true, productId: true },
    });
    const matchedCodes = new Set(byImei.map((d) => d.imei as string));
    const remaining = codes.filter((c) => !matchedCodes.has(c));

    const resolved = byImei.map((device) => ({ device, code: device.imei as string }));

    if (remaining.length > 0) {
      const labels = await this.prisma.purchaseUnitLabel.findMany({
        where: { code: { in: remaining }, deviceId: { not: null } },
        select: {
          code: true,
          device: { select: { id: true, imei: true, status: true, currentWarehouseId: true, productId: true } },
        },
      });
      for (const label of labels) {
        if (label.device) resolved.push({ device: label.device, code: label.code });
      }
    }

    const resolvedCodes = new Set(resolved.map((r) => r.code));
    const missing = codes.filter((c) => !resolvedCodes.has(c));
    return { resolved, missing };
  }

  /** Attaches specific scanned devices to an open transfer. */
  async loadDevices(user: RequestUser, transferId: string, dto: LoadDevicesDto) {
    const transfer = await this.mustBeEditable(user, transferId);
    const codes = normalizeScanCodes(dto.imeis ?? []);

    const { resolved, missing } = await this.resolveDevicesByScanCode(codes);
    if (missing.length > 0) {
      throw new BusinessError(ErrorCode.IMEI_NOT_FOUND, `${missing.length} code(s) are unknown.`, 404, {
        imeis: missing.slice(0, 20),
      });
    }
    const devices = resolved.map((r) => r.device);
    const codeByDeviceId = new Map(resolved.map((r) => [r.device.id, r.code]));

    const wrongWarehouse = devices.filter((d) => d.currentWarehouseId !== transfer.sourceWarehouseId);
    if (wrongWarehouse.length > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_WRONG_WAREHOUSE,
        `${wrongWarehouse.length} phone(s) are not in the source warehouse.`,
        400,
        { imeis: wrongWarehouse.slice(0, 20).map((d) => codeByDeviceId.get(d.id)) },
      );
    }

    const notAvailable = devices.filter((d) => d.status !== DeviceStatus.IN_STOCK);
    if (notAvailable.length > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_NOT_AVAILABLE,
        `${notAvailable.length} phone(s) are not available (already sold, in transfer, or awaiting validation).`,
        400,
        {
          imeis: notAvailable
            .slice(0, 20)
            .map((d) => ({ imei: codeByDeviceId.get(d.id), status: d.status })),
        },
      );
    }

    // A device already packed for another warehouse must not be loaded again.
    // Without this the clash only surfaces at dispatch, by which time both
    // transfers have been physically prepared.
    const claimedElsewhere = await this.prisma.transferDevice.findMany({
      where: {
        deviceId: { in: devices.map((d) => d.id) },
        transferId: { not: transferId },
        transfer: { status: { in: CLAIMING } },
      },
      select: { imei: true, transfer: { select: { number: true } } },
    });
    if (claimedElsewhere.length > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_NOT_AVAILABLE,
        `${claimedElsewhere.length} phone(s) are already loaded on another transfer.`,
        400,
        {
          imeis: claimedElsewhere
            .slice(0, 20)
            .map((l) => ({ imei: l.imei, transfer: l.transfer.number })),
        },
      );
    }

    // Planned quantities are a ceiling: you cannot load more than was agreed.
    const plan = await this.prisma.transferItem.findMany({
      where: { transferId },
      select: { productId: true, quantity: true },
    });
    const planByProduct = new Map(plan.map((p) => [p.productId, p.quantity]));
    const alreadyLoaded = await this.prisma.transferDevice.findMany({
      where: { transferId },
      select: { device: { select: { productId: true } } },
    });
    const loadedByProduct = new Map<string, number>();
    for (const l of alreadyLoaded) {
      loadedByProduct.set(l.device.productId, (loadedByProduct.get(l.device.productId) ?? 0) + 1);
    }
    for (const device of devices) {
      const planned = planByProduct.get(device.productId);
      if (planned === undefined) {
        throw new BusinessError(
          ErrorCode.IMEI_WRONG_PRODUCT,
          'This phone is not one of the products planned for this transfer.',
          400,
          { imei: codeByDeviceId.get(device.id) },
        );
      }
      const next = (loadedByProduct.get(device.productId) ?? 0) + 1;
      if (next > planned) {
        throw new BusinessError(
          ErrorCode.QUANTITY_EXCEEDED,
          `The transfer plans ${planned} unit(s) of this product and they are already loaded.`,
          400,
          { imei: codeByDeviceId.get(device.id), productId: device.productId, planned },
        );
      }
      loadedByProduct.set(device.productId, next);
    }

    const added = await this.prisma.$transaction(async (tx) => {
      const result = await tx.transferDevice.createMany({
        // The code that resolved this device — its IMEI if it has one, else
        // the label it was received under — is what gets scanned again at
        // receive time, so it is what gets stored here.
        data: devices.map((d) => ({ transferId, deviceId: d.id, imei: codeByDeviceId.get(d.id)! })),
        // A device already on this transfer is a harmless re-scan, not an error.
        skipDuplicates: true,
      });
      await tx.transfer.update({ where: { id: transferId }, data: { status: TransferStatus.READY } });
      return result.count;
    });

    return { transferId, added, alreadyOnTransfer: devices.length - added };
  }

  /**
   * Picks the oldest available devices in the source warehouse to satisfy the
   * planned quantities. Scanning 500 phones twice — once to send, once to
   * receive — is not something a warehouse will do, so the send side may pick.
   */
  async autoFill(user: RequestUser, transferId: string) {
    const transfer = await this.mustBeEditable(user, transferId);
    const plan = await this.prisma.transferItem.findMany({
      where: { transferId },
      include: { product: { select: { id: true, tracking: true } } },
    });

    const picked: { id: string; code: string }[] = [];
    const shortfalls: { productId: string; requested: number; available: number }[] = [];

    for (const line of plan) {
      // An accessory is shipped by quantity, never picked — there are no units
      // to choose between. Auto-fill on a bulk-only transfer is a no-op, not a
      // failure: the quantity on the line is what goes on the lorry.
      if (line.product.tracking === TrackingMode.BULK) continue;
      const alreadyLoaded = await this.prisma.transferDevice.count({
        where: { transferId, device: { productId: line.productId } },
      });
      const needed = line.quantity - alreadyLoaded;
      if (needed <= 0) continue;

      const candidates = await this.prisma.device.findMany({
        where: {
          productId: line.productId,
          currentWarehouseId: transfer.sourceWarehouseId,
          status: DeviceStatus.IN_STOCK,
          transferId: null,
          // Skip anything already promised to a transfer — including this one,
          // or auto-fill would keep re-picking what it has already loaded.
          NOT: { transferLines: { some: { transfer: { status: { in: CLAIMING } } } } },
        },
        orderBy: { receivedAt: 'asc' },
        take: needed,
        // A device auto-picked here may have arrived through the label-first
        // workflow and carry no IMEI at all — its label is the fallback
        // identifier, the same code that will be scanned again at receive time.
        select: { id: true, imei: true, label: { select: { code: true } } },
      });
      if (candidates.length < needed) {
        shortfalls.push({ productId: line.productId, requested: needed, available: candidates.length });
      }
      picked.push(...candidates.map((c) => ({ id: c.id, code: (c.imei ?? c.label?.code) as string })));
    }

    // Nothing to load — every plan line was accessories, or was already loaded.
    // That is an empty pick, not an unavailable one.
    if (picked.length === 0 && shortfalls.length > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_NOT_AVAILABLE,
        'No available stock in the source warehouse matches this transfer.',
        400,
        { shortfalls },
      );
    }

    let added = 0;
    if (picked.length > 0) {
      const result = await this.prisma.$transaction(async (tx) => {
        const loaded = await tx.transferDevice.createMany({
          data: picked.map((d) => ({ transferId, deviceId: d.id, imei: d.code })),
          skipDuplicates: true,
        });
        await tx.transfer.update({ where: { id: transferId }, data: { status: TransferStatus.READY } });
        return loaded.count;
      });
      added = result;
    }

    return { transferId, added, shortfalls };
  }

  async unloadDevice(user: RequestUser, transferId: string, imei: string) {
    await this.mustBeEditable(user, transferId);
    const deleted = await this.prisma.transferDevice.deleteMany({ where: { transferId, imei } });
    if (deleted.count === 0) {
      throw new BusinessError(
        ErrorCode.IMEI_NOT_IN_TRANSFER,
        'This IMEI is not loaded on this transfer.',
        404,
      );
    }
    return { transferId, imei, removed: true };
  }

  /**
   * Dispatch. Devices leave the source warehouse's available stock and become
   * IN_TRANSFER; the location stays the source until the destination confirms,
   * so no phone is ever in two places or in none.
   */
  async ship(user: RequestUser, transferId: string, dto: ShipTransferDto) {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id: transferId },
      include: {
        shipment: true,
        _count: { select: { devices: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, tracking: true } } } },
        // Named, not just identified: the despatch note says where it is going.
        sourceWarehouse: { select: { name: true } },
        destinationWarehouse: { select: { name: true } },
      },
    });
    if (!transfer) throw BusinessError.notFound('Transfer', transferId);

    // Only the source warehouse ships (spec §44).
    this.access.assertAccess(user, transfer.sourceWarehouseId);

    if (!EDITABLE.includes(transfer.status)) {
      throw new BusinessError(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `A transfer with status ${transfer.status} cannot be shipped.`,
      );
    }
    // Accessories are never "loaded" — there are no units to pick between, so
    // the ordered quantity is what goes on the lorry.
    const bulkItems = transfer.items.filter(
      (i) => i.product.tracking === TrackingMode.BULK && i.quantity > i.shippedQuantity,
    );
    if (transfer._count.devices === 0 && bulkItems.length === 0) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'Load at least one phone, or add an accessory line, before shipping.',
      );
    }

    const now = new Date();
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Claim the transfer. A concurrent ship finds count 0 and aborts.
        const claim = await tx.transfer.updateMany({
          where: { id: transferId, status: { in: EDITABLE } },
          data: { status: TransferStatus.IN_TRANSIT },
        });
        if (claim.count === 0) {
          throw BusinessError.conflict(
            ErrorCode.CONCURRENT_MODIFICATION,
            'This transfer was shipped by someone else a moment ago.',
          );
        }

        const lines = await tx.transferDevice.findMany({
          where: { transferId },
          select: { deviceId: true, imei: true },
        });
        const deviceIds = lines.map((l) => l.deviceId);

        // Status-guarded update: a device sold in the meantime is simply not moved,
        // and the count mismatch rolls the whole shipment back.
        const moved = await tx.device.updateMany({
          where: {
            id: { in: deviceIds },
            status: DeviceStatus.IN_STOCK,
            currentWarehouseId: transfer.sourceWarehouseId,
          },
          data: { status: DeviceStatus.IN_TRANSFER, transferId },
        });
        if (moved.count !== deviceIds.length) {
          throw BusinessError.conflict(
            ErrorCode.IMEI_NOT_AVAILABLE,
            `${deviceIds.length - moved.count} phone(s) on this transfer are no longer available. Reload the transfer.`,
            { expected: deviceIds.length, moved: moved.count },
          );
        }

        await this.movements.recordMany(
          tx,
          lines.map((l) => ({
            deviceId: l.deviceId,
            type: MovementType.TRANSFER_OUT,
            fromWarehouseId: transfer.sourceWarehouseId,
            toWarehouseId: transfer.destinationWarehouseId,
            referenceType: 'Transfer',
            referenceId: transferId,
            referenceNumber: transfer.number,
            performedById: user.id,
            metadata: { imei: l.imei },
          })),
        );

        // Accessory lines leave the source now. The quantity sits in neither
        // warehouse until it is booked in, which is exactly what in-transit
        // means and matches how IN_TRANSFER works for phones.
        let bulkShipped = 0;
        for (const item of bulkItems) {
          const outstanding = item.quantity - item.shippedQuantity;
          await this.stock.issue(tx, {
            productId: item.productId,
            warehouseId: transfer.sourceWarehouseId,
            quantity: outstanding,
            type: MovementType.TRANSFER_OUT,
            performedById: user.id,
            referenceType: 'Transfer',
            referenceId: transferId,
            referenceNumber: transfer.number,
          });
          await tx.transferItem.update({
            where: { id: item.id },
            data: { shippedQuantity: { increment: outstanding } },
          });
          bulkShipped += outstanding;
        }

        const shipment = await tx.shipment.update({
          where: { transferId },
          data: {
            status: ShipmentStatus.IN_TRANSIT,
            shippedAt: now,
            shippedById: user.id,
            carrier: dto.carrier,
            trackingRef: dto.trackingRef,
          },
        });

        return { shipment, shipped: moved.count + bulkShipped };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    await this.notifications.notify({
      event: 'TRANSFER_SHIPPED',
      reference: result.shipment.number,
      warehouseName: transfer.destinationWarehouse.name,
      sourceWarehouseId: transfer.sourceWarehouseId,
      destinationWarehouseId: transfer.destinationWarehouseId,
      referenceType: 'Transfer',
      referenceId: transferId,
      facts: {
        headline: `On its way to ${transfer.destinationWarehouse.name}`,
        facts: [
          { label: 'Transfer', value: transfer.number },
          { label: 'From', value: transfer.sourceWarehouse.name },
          { label: 'To', value: transfer.destinationWarehouse.name },
          { label: 'Sent by', value: user.name },
          { label: 'Sent at', value: now.toLocaleString('en-GB') },
          ...(dto.carrier ? [{ label: 'Carrier', value: dto.carrier }] : []),
          ...(dto.trackingRef ? [{ label: 'Tracking', value: dto.trackingRef }] : []),
          { label: 'Units', value: `${result.shipped}` },
        ],
        lines: transfer.items.map((item) => ({
          product: item.product.name,
          sku: item.product.sku,
          quantity: item.quantity,
          detail: item.product.tracking === TrackingMode.BULK ? 'counted by quantity' : null,
        })),
        link: `${this.config.frontendUrl}/transfers/${transferId}`,
        linkLabel: 'Open this transfer',
      },
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.SHIP_TRANSFER,
      entityType: 'Transfer',
      entityId: transferId,
      metadata: { number: transfer.number, shipment: result.shipment.number, devices: result.shipped },
    });

    return {
      transferId,
      status: TransferStatus.IN_TRANSIT,
      shipmentNumber: result.shipment.number,
      shippedDevices: result.shipped,
    };
  }

  /**
   * Goods-in at the destination. Each scanned IMEI must belong to this transfer;
   * the receiving user and timestamp are recorded per device (spec §14).
   */
  async receive(user: RequestUser, transferId: string, dto: ReceiveTransferDto) {
    const transfer = await this.prisma.transfer.findUnique({
      where: { id: transferId },
      include: {
        shipment: true,
        items: { include: { product: { select: { id: true, name: true, sku: true, tracking: true } } } },
        sourceWarehouse: { select: { name: true } },
        destinationWarehouse: { select: { name: true } },
      },
    });
    if (!transfer) throw BusinessError.notFound('Transfer', transferId);

    // Only the destination warehouse receives (spec §44).
    this.access.assertAccess(user, transfer.destinationWarehouseId);

    if (transfer.status === TransferStatus.RECEIVED) {
      throw new BusinessError(ErrorCode.ALREADY_RECEIVED, 'This transfer has already been received.');
    }
    if (transfer.status !== TransferStatus.IN_TRANSIT) {
      throw new BusinessError(ErrorCode.INVALID_STATUS_TRANSITION, 'This transfer has not been shipped yet.');
    }

    const imeis = normalizeScanCodes(dto.imeis ?? []);

    const onTransfer = await this.prisma.transferDevice.findMany({
      where: { transferId },
      select: { id: true, deviceId: true, imei: true, receivedAt: true },
    });
    const byImei = new Map(onTransfer.map((l) => [l.imei, l]));

    const notOnTransfer = imeis.filter((i) => !byImei.has(i));
    if (notOnTransfer.length > 0) {
      throw new BusinessError(
        ErrorCode.IMEI_NOT_IN_TRANSFER,
        `${notOnTransfer.length} scanned IMEI(s) are not part of this shipment.`,
        400,
        { imeis: notOnTransfer.slice(0, 20) },
      );
    }

    const toReceive = imeis.map((i) => byImei.get(i)!).filter((l) => l.receivedAt === null);
    const expected = onTransfer.filter((l) => l.receivedAt === null).length;
    const missing = expected - toReceive.length;

    if (missing > 0 && !dto.allowPartial) {
      throw new BusinessError(
        ErrorCode.PARTIAL_RECEIPT_NOT_ALLOWED,
        `Expected ${expected} phones but ${toReceive.length} were scanned — ${missing} missing.`,
        400,
        { expected, scanned: toReceive.length, missing },
      );
    }
    const bulkItems = transfer.items.filter(
      (i) => i.product.tracking === TrackingMode.BULK && i.shippedQuantity > i.receivedQuantity,
    );
    if (toReceive.length === 0 && bulkItems.length === 0) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'All scanned phones have already been received.');
    }

    const requiresValidation = this.config.receiving.requireValidation;
    const newStatus = requiresValidation ? DeviceStatus.RECEIVED : DeviceStatus.IN_STOCK;
    const now = new Date();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const deviceIds = toReceive.map((l) => l.deviceId);

        const updated = await tx.device.updateMany({
          where: { id: { in: deviceIds }, status: DeviceStatus.IN_TRANSFER, transferId },
          data: {
            status: newStatus,
            currentWarehouseId: transfer.destinationWarehouseId,
            transferId: null,
            receivedAt: now,
          },
        });
        if (updated.count !== deviceIds.length) {
          throw BusinessError.conflict(
            ErrorCode.CONCURRENT_MODIFICATION,
            'These phones were received by someone else a moment ago. Refresh and try again.',
            { expected: deviceIds.length, received: updated.count },
          );
        }

        await tx.transferDevice.updateMany({
          where: { id: { in: toReceive.map((l) => l.id) } },
          data: { receivedAt: now },
        });

        // Book the accessories in at the cost they left the source at, read
        // back from the ledger entry the despatch wrote. Re-pricing them at the
        // destination's current average would invent margin out of a lorry
        // journey.
        for (const item of bulkItems) {
          const outstanding = item.shippedQuantity - item.receivedQuantity;
          const despatch = await tx.stockMovement.findFirst({
            where: {
              referenceType: 'Transfer',
              referenceId: transferId,
              productId: item.productId,
              type: MovementType.TRANSFER_OUT,
            },
            orderBy: { createdAt: 'desc' },
            select: { unitCost: true, currency: true },
          });
          await this.stock.receive(tx, {
            productId: item.productId,
            warehouseId: transfer.destinationWarehouseId,
            quantity: outstanding,
            unitCost: despatch?.unitCost ?? new Prisma.Decimal(0),
            currency: despatch?.currency ?? Currency.EUR,
            type: MovementType.TRANSFER_IN,
            performedById: user.id,
            referenceType: 'Transfer',
            referenceId: transferId,
            referenceNumber: transfer.number,
          });
          await tx.transferItem.update({
            where: { id: item.id },
            data: { receivedQuantity: { increment: outstanding } },
          });
        }

        await this.movements.recordMany(
          tx,
          toReceive.map((l) => ({
            deviceId: l.deviceId,
            type: MovementType.TRANSFER_IN,
            fromWarehouseId: transfer.sourceWarehouseId,
            toWarehouseId: transfer.destinationWarehouseId,
            referenceType: 'Transfer',
            referenceId: transferId,
            referenceNumber: transfer.number,
            performedById: user.id,
            metadata: { imei: l.imei, receivedBy: user.name },
          })),
        );

        const receiptNumber = await this.numbers.next(tx, 'RCP');
        const receipt = await tx.receipt.create({
          data: {
            number: receiptNumber,
            source: 'TRANSFER',
            transferId,
            warehouseId: transfer.destinationWarehouseId,
            status: requiresValidation ? 'PENDING_VALIDATION' : 'VALIDATED',
            expectedCount: expected,
            scannedCount: toReceive.length,
            createdById: user.id,
            validatedById: requiresValidation ? null : user.id,
            validatedAt: requiresValidation ? null : now,
          },
        });
        // One bulk insert: a 500-line receipt must not be 500 round trips.
        await tx.receiptLine.createMany({
          data: toReceive.map((l) => ({ receiptId: receipt.id, deviceId: l.deviceId, imei: l.imei })),
        });

        const stillOutstanding = await tx.transferDevice.count({ where: { transferId, receivedAt: null } });
        const bulkOutstanding = await tx.transferItem.count({
          where: { transferId, shippedQuantity: { gt: tx.transferItem.fields.receivedQuantity } },
        });
        const complete = stillOutstanding === 0 && bulkOutstanding === 0;

        if (complete) {
          await tx.transfer.update({ where: { id: transferId }, data: { status: TransferStatus.RECEIVED } });
          await tx.shipment.update({
            where: { transferId },
            data: { status: ShipmentStatus.RECEIVED, receivedAt: now, receivedById: user.id },
          });
        } else {
          await tx.shipment.update({ where: { transferId }, data: { status: ShipmentStatus.DELIVERED } });
        }

        return { receipt, received: toReceive.length, outstanding: stillOutstanding, complete };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    const shortBy = expected - result.received;
    await this.notifications.notify({
      event: 'TRANSFER_RECEIVED',
      reference: result.receipt.number,
      warehouseName: transfer.destinationWarehouse.name,
      // Both ends: the sender wants confirmation, the receiver wants the record.
      sourceWarehouseId: transfer.sourceWarehouseId,
      destinationWarehouseId: transfer.destinationWarehouseId,
      referenceType: 'Transfer',
      referenceId: transferId,
      facts: {
        headline: result.complete
          ? `Arrived at ${transfer.destinationWarehouse.name}`
          : `Part-arrived at ${transfer.destinationWarehouse.name}`,
        facts: [
          { label: 'Transfer', value: transfer.number },
          { label: 'From', value: transfer.sourceWarehouse.name },
          { label: 'To', value: transfer.destinationWarehouse.name },
          { label: 'Received by', value: user.name },
          { label: 'Received at', value: now.toLocaleString('en-GB') },
          { label: 'Expected', value: `${expected} units` },
          { label: 'Received', value: `${result.received} units` },
          ...(requiresValidation
            ? [{ label: 'Status', value: 'Awaiting validation before it can be sold' }]
            : []),
        ],
        alert:
          shortBy > 0
            ? `${shortBy} unit${shortBy === 1 ? '' : 's'} on this shipment have not arrived. The transfer stays open.`
            : null,
        lines: transfer.items.map((item) => ({
          product: item.product.name,
          sku: item.product.sku,
          quantity: item.quantity,
          detail: item.product.tracking === TrackingMode.BULK ? 'counted by quantity' : null,
        })),
        link: `${this.config.frontendUrl}/transfers/${transferId}`,
        linkLabel: 'Open this transfer',
      },
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.RECEIVE_TRANSFER,
      entityType: 'Transfer',
      entityId: transferId,
      metadata: {
        number: transfer.number,
        receiptNumber: result.receipt.number,
        received: result.received,
        expected,
        missing: result.outstanding,
      },
    });

    return {
      transferId,
      receiptId: result.receipt.id,
      receiptNumber: result.receipt.number,
      expected,
      scanned: result.received,
      missing: result.outstanding,
      status: result.complete ? TransferStatus.RECEIVED : TransferStatus.IN_TRANSIT,
      pendingValidation: requiresValidation,
      receivedBy: user.name,
      receivedAt: now.toISOString(),
    };
  }

  async cancel(user: RequestUser, transferId: string) {
    const transfer = await this.prisma.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw BusinessError.notFound('Transfer', transferId);
    this.access.assertAccess(user, transfer.sourceWarehouseId);

    if (!EDITABLE.includes(transfer.status)) {
      throw new BusinessError(
        ErrorCode.INVALID_STATUS_TRANSITION,
        'Only a transfer that has not been shipped can be cancelled.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Claim the transfer before touching its devices: a concurrent ship that
      // just flipped it to IN_TRANSIT must not lose its rows to a stale window.
      const claim = await tx.transfer.updateMany({
        where: { id: transferId, status: { in: EDITABLE } },
        data: { status: TransferStatus.CANCELLED },
      });
      if (claim.count === 0) {
        throw BusinessError.conflict(
          ErrorCode.CONCURRENT_MODIFICATION,
          'This transfer was shipped or cancelled by someone else a moment ago.',
        );
      }
      await tx.transferDevice.deleteMany({ where: { transferId } });
    });
    return { transferId, status: TransferStatus.CANCELLED };
  }

  // -------------------------------------------------------------------------

  private assertInvolved(user: RequestUser, sourceId: string, destinationId: string): void {
    if (this.access.isAdmin(user)) return;
    if (user.warehouseId === sourceId || user.warehouseId === destinationId) return;
    throw BusinessError.forbiddenWarehouse();
  }

  private async mustBeEditable(user: RequestUser, transferId: string) {
    const transfer = await this.prisma.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw BusinessError.notFound('Transfer', transferId);
    this.access.assertAccess(user, transfer.sourceWarehouseId);
    if (!EDITABLE.includes(transfer.status)) {
      throw new BusinessError(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `A transfer with status ${transfer.status} can no longer be changed.`,
      );
    }
    return transfer;
  }
}
