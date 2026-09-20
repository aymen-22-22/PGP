import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DeviceStatus, MovementType, Prisma, PurchaseStatus, TrackingMode } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  add,
  multiply,
  type Paginated,
  type PurchaseListItem,
} from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';
import { BusinessError } from '../common/errors/business.error';
import { normalizeImeiBatch, normalizeSerialBatch } from '../common/pipes/imei.util';
import { DocumentNumberService } from '../common/services/document-number.service';
import { MovementService } from '../common/services/movement.service';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import { APP_CONFIG } from '../common/tokens';
import type { RequestUser } from '../common/types';
import { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockService } from '../stock/stock.service';
import { CreatePurchaseDto, QueryPurchasesDto, ReceivePurchaseDto } from './dto/purchase.dto';

@Injectable()
export class PurchasesService {
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

  async list(user: RequestUser, query: QueryPurchasesDto): Promise<Paginated<PurchaseListItem<Date>>> {
    const where: Prisma.PurchaseWhereInput = {
      ...this.access.filterFor<Prisma.PurchaseWhereInput>(user, 'warehouseId', query.warehouseId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.from || query.to
        ? {
            purchaseDate: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchase.findMany({
        where,
        orderBy: { purchaseDate: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        select: {
          id: true,
          number: true,
          purchaseDate: true,
          status: true,
          currency: true,
          totalAmount: true,
          supplier: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          // Aggregated in SQL so the list never loads item rows (avoids N+1).
          items: { select: { quantity: true, receivedQuantity: true } },
        },
      }),
      this.prisma.purchase.count({ where }),
    ]);

    const data = rows.map(({ items, ...p }) => ({
      ...p,
      totalAmount: p.totalAmount.toFixed(2),
      expectedQuantity: items.reduce((s, i) => s + i.quantity, 0),
      receivedQuantity: items.reduce((s, i) => s + i.receivedQuantity, 0),
    }));
    return paginate(data, total, query);
  }

  async findOne(user: RequestUser, id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        supplier: true,
        warehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true } },
        items: {
          include: { product: { select: { id: true, name: true, sku: true, tracking: true } } },
          orderBy: { id: 'asc' },
        },
        receipts: {
          select: {
            id: true,
            number: true,
            status: true,
            scannedCount: true,
            createdAt: true,
            createdBy: { select: { id: true, name: true } },
            validatedBy: { select: { id: true, name: true } },
            validatedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!purchase) throw BusinessError.notFound('Purchase', id);
    this.access.assertAccess(user, purchase.warehouseId);

    return {
      ...purchase,
      totalAmount: purchase.totalAmount.toFixed(2),
      items: purchase.items.map((i) => ({
        ...i,
        unitPrice: i.unitPrice.toFixed(2),
        totalPrice: i.totalPrice.toFixed(2),
        remainingQuantity: i.quantity - i.receivedQuantity,
      })),
    };
  }

  async create(user: RequestUser, dto: CreatePurchaseDto) {
    const warehouseId = this.access.resolveWarehouseId(user, dto.warehouseId);

    const productIds = dto.items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'The same product appears twice — merge the lines into one.',
      );
    }

    const [supplier, warehouse, products] = await Promise.all([
      this.prisma.supplier.findUnique({
        where: { id: dto.supplierId },
        select: { id: true, isActive: true },
      }),
      this.prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, isActive: true } }),
      this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true } }),
    ]);
    if (!supplier) throw BusinessError.notFound('Supplier', dto.supplierId);
    if (!warehouse) throw BusinessError.notFound('Warehouse', warehouseId);
    if (products.length !== productIds.length) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'One or more products do not exist.');
    }

    const items = dto.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      totalPrice: multiply(i.unitPrice, i.quantity),
    }));
    const totalAmount = items.reduce((sum, i) => add(sum, i.totalPrice), '0.00');

    const purchase = await this.prisma.$transaction(async (tx) => {
      const number = await this.numbers.next(tx, 'PO');
      return tx.purchase.create({
        data: {
          number,
          supplierId: dto.supplierId,
          warehouseId,
          purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : new Date(),
          currency: dto.currency,
          notes: dto.notes,
          status: PurchaseStatus.ORDERED,
          totalAmount,
          createdById: user.id,
          items: { create: items },
        },
        include: { items: true },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.CREATE_PURCHASE,
      entityType: 'Purchase',
      entityId: purchase.id,
      metadata: { number: purchase.number, totalAmount, lines: items.length },
    });
    return this.findOne(user, purchase.id);
  }

  /**
   * Goods-in for a purchase. Creates one Device per scanned IMEI and the matching
   * ledger rows, all inside a single transaction: either every device of this
   * receipt exists or none does (spec §27).
   */
  async receive(user: RequestUser, purchaseId: string, dto: ReceivePurchaseDto) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true, tracking: true } } } },
        // For the notification: who sent the goods, and where they landed.
        supplier: { select: { name: true } },
        warehouse: { select: { name: true } },
      },
    });
    if (!purchase) throw BusinessError.notFound('Purchase', purchaseId);
    this.access.assertAccess(user, purchase.warehouseId);

    if (purchase.status === PurchaseStatus.CANCELLED) {
      throw new BusinessError(ErrorCode.INVALID_STATUS_TRANSITION, 'This purchase has been cancelled.');
    }
    if (purchase.status === PurchaseStatus.RECEIVED) {
      throw new BusinessError(ErrorCode.ALREADY_RECEIVED, 'This purchase has already been fully received.');
    }

    // --- Validate the scan payload against the ordered lines -----------------
    const itemById = new Map(purchase.items.map((i) => [i.id, i]));
    const allImeis: string[] = [];
    const allSerials: string[] = [];
    const perLine: {
      itemId: string;
      productId: string;
      productName: string;
      tracking: TrackingMode;
      unitPrice: Prisma.Decimal;
      imeis: string[];
      /** Serial-only units on this line, received pending their IMEI. */
      serials: string[];
      /** Units on this line: IMEIs + serials for phones, the entered figure for accessories. */
      quantity: number;
    }[] = [];

    for (const line of dto.lines) {
      const item = itemById.get(line.purchaseItemId);
      if (!item) {
        throw new BusinessError(
          ErrorCode.VALIDATION_FAILED,
          'A scanned line does not belong to this purchase.',
          400,
          {
            purchaseItemId: line.purchaseItemId,
          },
        );
      }

      // A line is either scanned or counted, and which one is not the
      // receiver's choice — it follows from the product.
      const bulk = item.product.tracking === TrackingMode.BULK;
      if (bulk && (line.imeis?.length || line.serials?.length)) this.stock.assertTracking(item.product, TrackingMode.SERIALIZED);
      if (!bulk && line.quantity !== undefined) this.stock.assertTracking(item.product, TrackingMode.BULK);

      const imeis = bulk ? [] : normalizeImeiBatch(line.imeis ?? [], this.config.imei.enforceChecksum);
      const serials = bulk ? [] : normalizeSerialBatch(line.serials ?? []);
      const quantity = bulk ? (line.quantity ?? 0) : imeis.length + serials.length;
      if (quantity <= 0) {
        throw new BusinessError(
          ErrorCode.VALIDATION_FAILED,
          bulk
            ? `Enter how many ${item.product.name} arrived.`
            : `No IMEIs or serials were scanned for ${item.product.name}.`,
          400,
          { purchaseItemId: item.id },
        );
      }

      const remaining = item.quantity - item.receivedQuantity;
      if (quantity > remaining) {
        throw new BusinessError(
          ErrorCode.QUANTITY_EXCEEDED,
          bulk
            ? `You entered ${quantity} but only ${remaining} are still expected on this line.`
            : `You scanned ${quantity} phones but only ${remaining} are still expected on this line.`,
          400,
          { purchaseItemId: item.id, scanned: quantity, remaining },
        );
      }
      allImeis.push(...imeis);
      allSerials.push(...serials);
      perLine.push({
        itemId: item.id,
        productId: item.productId,
        productName: item.product.name,
        tracking: item.product.tracking,
        unitPrice: item.unitPrice,
        imeis,
        serials,
        quantity,
      });
    }

    // A code repeated across two lines of the same request.
    if (new Set(allImeis).size !== allImeis.length) {
      throw new BusinessError(
        ErrorCode.IMEI_DUPLICATE_IN_REQUEST,
        'The same IMEI was scanned on more than one line.',
      );
    }
    if (new Set(allSerials).size !== allSerials.length) {
      throw new BusinessError(
        ErrorCode.SERIAL_DUPLICATE_IN_REQUEST,
        'The same serial number was scanned on more than one line.',
      );
    }

    const expectedTotal = purchase.items.reduce((s, i) => s + (i.quantity - i.receivedQuantity), 0);
    const receivedTotal = perLine.reduce((s, l) => s + l.quantity, 0);
    const isPartial = receivedTotal < expectedTotal;
    if (isPartial) {
      const partialAllowed = (dto.allowPartial ?? false) && this.config.receiving.allowPartial;
      if (!partialAllowed) {
        throw new BusinessError(
          ErrorCode.PARTIAL_RECEIPT_NOT_ALLOWED,
          `Expected ${expectedTotal} units but ${receivedTotal} were received — ${expectedTotal - receivedTotal} missing.`,
          400,
          { expected: expectedTotal, scanned: receivedTotal, missing: expectedTotal - receivedTotal },
        );
      }
    }

    // Reject codes the system already knows about before opening the transaction,
    // so the common mistake produces a precise message rather than a raw conflict.
    const known = await this.prisma.device.findMany({
      where: { OR: [{ imei: { in: allImeis } }, { serialNumber: { in: allSerials } }] },
      select: { imei: true, serialNumber: true },
    });
    if (known.length > 0) {
      const dupImes = known.filter((d) => d.imei !== null).map((d) => d.imei as string).slice(0, 20);
      const dupSerials = known.filter((d) => d.serialNumber !== null).map((d) => d.serialNumber as string).slice(0, 20);
      throw BusinessError.conflict(
        ErrorCode.IMEI_ALREADY_EXISTS,
        `${known.length} code(s) already exist in the system.`,
        { imeis: dupImes, serials: dupSerials },
      );
    }

    const requiresValidation = this.config.receiving.requireValidation;
    const deviceStatus = requiresValidation ? DeviceStatus.RECEIVED : DeviceStatus.IN_STOCK;
    const now = new Date();

    // Ids are generated here rather than by the database so that devices,
    // movements and receipt lines can each be written with one bulk INSERT.
    // A 1,000-unit receipt is a normal day's work and must not crawl.
    //
    // Serial-only units get no IMEI and status PENDING_IDENTIFICATION: they are
    // on the books, but not sellable until their IMEI is recorded (see the
    // identify endpoint), which flips them straight to IN_STOCK.
    const deviceRows = perLine.flatMap((line) => {
      const labelRows = line.imeis.map((imei) => ({
        imei,
        serialNumber: null,
        status: deviceStatus,
      }));
      const serialRows = line.serials.map((serial) => ({
        imei: null as string | null,
        serialNumber: serial,
        status: DeviceStatus.PENDING_IDENTIFICATION,
      }));
      return [...labelRows, ...serialRows].map((unit) => ({
        id: randomUUID(),
        ...unit,
        productId: line.productId,
        purchaseItemId: line.itemId,
        currentWarehouseId: purchase.warehouseId,
        purchaseId: purchase.id,
        purchaseCost: line.unitPrice,
        // Landed cost starts at the purchase price and grows as handling,
        // freight and customs are posted against this unit.
        landedCost: line.unitPrice,
        costCurrency: purchase.currency,
        receivedAt: now,
      }));
    });

    const result = await this.prisma.$transaction(
      async (tx) => {
        const receiptNumber = await this.numbers.next(tx, 'RCP');

        // One lot per product received in this batch. The lot is the handle a
        // later freight or customs bill is pointed at, and it carries the price
        // actually paid — a different price next month is a new lot, never an
        // edit to this one.
        const lotByItem = new Map<string, string>();
        for (const line of perLine) {
          if (line.quantity === 0) continue;
          const lotNumber = await this.numbers.next(tx, 'LOT');
          const lot = await tx.lot.create({
            data: {
              number: lotNumber,
              productId: line.productId,
              purchaseId: purchase.id,
              purchaseItemId: line.itemId,
              warehouseId: purchase.warehouseId,
              quantity: line.quantity,
              unitPurchaseCost: line.unitPrice,
              currency: purchase.currency,
              receivedAt: now,
            },
            select: { id: true },
          });
          lotByItem.set(line.itemId, lot.id);
        }

        await tx.device.createMany({
          data: deviceRows.map((d) => ({ ...d, lotId: lotByItem.get(d.purchaseItemId) ?? null })),
        });
        const createdDevices = deviceRows;

        // Accessories have no rows to create — the arrival is a quantity and a
        // price, which the stock ledger records and re-averages.
        for (const line of perLine) {
          if (line.tracking !== TrackingMode.BULK) continue;
          await this.stock.receive(tx, {
            productId: line.productId,
            warehouseId: purchase.warehouseId,
            quantity: line.quantity,
            unitCost: line.unitPrice,
            currency: purchase.currency,
            type: MovementType.PURCHASE_RECEIPT,
            performedById: user.id,
            referenceType: 'Purchase',
            referenceId: purchase.id,
            referenceNumber: purchase.number,
            notes: receiptNumber,
          });
        }

        for (const line of perLine) {
          await tx.purchaseItem.update({
            where: { id: line.itemId },
            data: { receivedQuantity: { increment: line.quantity } },
          });
        }

        await this.movements.recordMany(
          tx,
          createdDevices.map((d) => ({
            deviceId: d.id,
            type: MovementType.PURCHASE_RECEIPT,
            fromWarehouseId: null,
            toWarehouseId: purchase.warehouseId,
            referenceType: 'Purchase',
            referenceId: purchase.id,
            referenceNumber: purchase.number,
            performedById: user.id,
            metadata: { receiptNumber, imei: d.imei },
          })),
        );

        const receipt = await tx.receipt.create({
          data: {
            number: receiptNumber,
            source: 'PURCHASE',
            purchaseId: purchase.id,
            warehouseId: purchase.warehouseId,
            status: requiresValidation ? 'PENDING_VALIDATION' : 'VALIDATED',
            expectedCount: expectedTotal,
            scannedCount: receivedTotal,
            createdById: user.id,
            validatedById: requiresValidation ? null : user.id,
            validatedAt: requiresValidation ? null : now,
          },
        });
        await tx.receiptLine.createMany({
          data: createdDevices.map((d) => ({ receiptId: receipt.id, deviceId: d.id, imei: d.imei })),
        });

        // Re-read the lines inside the transaction to decide the new purchase status.
        const refreshed = await tx.purchaseItem.findMany({
          where: { purchaseId: purchase.id },
          select: { quantity: true, receivedQuantity: true },
        });
        const fullyReceived = refreshed.every((i) => i.receivedQuantity >= i.quantity);
        const anyReceived = refreshed.some((i) => i.receivedQuantity > 0);

        await tx.purchase.update({
          where: { id: purchase.id },
          data: {
            status: fullyReceived
              ? PurchaseStatus.RECEIVED
              : anyReceived
                ? PurchaseStatus.PARTIALLY_RECEIVED
                : purchase.status,
          },
        });

        return {
          receipt,
          created: receivedTotal,
          fullyReceived,
          lotIds: [...lotByItem.values()],
        };
      },
      // A large goods-in is a handful of bulk statements, but on modest shared
      // hosting they still need more than Prisma's 5s default.
      { timeout: 120_000, maxWait: 20_000 },
    );

    // Announced after the transaction, so a mail failure cannot un-receive
    // goods that are physically on the shelf.
    const missing = expectedTotal - receivedTotal;
    const warehouseName = purchase.warehouse.name;
    const supplierName = purchase.supplier.name;
    const productSkus = new Map(purchase.items.map((i) => [i.productId, i.product.sku]));
    await this.notifications.notify({
      event: missing > 0 ? 'SHORT_DELIVERY' : 'PURCHASE_RECEIVED',
      reference: result.receipt.number,
      warehouseName: warehouseName,
      destinationWarehouseId: purchase.warehouseId,
      referenceType: 'Purchase',
      referenceId: purchase.id,
      facts: {
        headline: missing > 0 ? 'Goods received short' : 'Goods received',
        facts: [
          { label: 'Purchase', value: purchase.number },
          { label: 'Supplier', value: supplierName },
          { label: 'Warehouse', value: warehouseName },
          { label: 'Received by', value: user.name },
          { label: 'Received at', value: now.toLocaleString('en-GB') },
          { label: 'Expected', value: `${expectedTotal} units` },
          { label: 'Received', value: `${receivedTotal} units` },
          ...(requiresValidation
            ? [{ label: 'Status', value: 'Awaiting validation before it can be sold' }]
            : []),
        ],
        alert:
          missing > 0
            ? `${missing} unit${missing === 1 ? '' : 's'} short of what was ordered. The rest of the line stays open.`
            : null,
        lines: perLine.map((line) => ({
          product: line.productName,
          sku: productSkus.get(line.productId) ?? '',
          quantity: line.quantity,
          detail:
            line.imeis.length === 1
              ? line.imeis[0]
              : line.imeis.length > 1
                ? `${line.imeis.length} IMEIs scanned`
                : 'counted by quantity',
        })),
        link: `${this.config.frontendUrl}/purchases/${purchase.id}`,
        linkLabel: 'Open this purchase',
      },
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.RECEIVE_PURCHASE,
      entityType: 'Purchase',
      entityId: purchase.id,
      metadata: {
        purchaseNumber: purchase.number,
        receiptNumber: result.receipt.number,
        received: result.created,
        expected: expectedTotal,
        partial: isPartial,
        pendingValidation: requiresValidation,
      },
    });

    return {
      receiptId: result.receipt.id,
      receiptNumber: result.receipt.number,
      expected: expectedTotal,
      scanned: result.created,
      missing: Math.max(0, expectedTotal - result.created),
      purchaseStatus: result.fullyReceived ? PurchaseStatus.RECEIVED : PurchaseStatus.PARTIALLY_RECEIVED,
      pendingValidation: requiresValidation,
      deviceStatus,
      lotIds: result.lotIds,
    };
  }

  async cancel(user: RequestUser, id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      select: { id: true, number: true, status: true, warehouseId: true },
    });
    if (!purchase) throw BusinessError.notFound('Purchase', id);
    this.access.assertAccess(user, purchase.warehouseId);

    if (purchase.status !== PurchaseStatus.DRAFT && purchase.status !== PurchaseStatus.ORDERED) {
      throw new BusinessError(
        ErrorCode.INVALID_STATUS_TRANSITION,
        'Only a purchase with nothing received yet can be cancelled.',
      );
    }
    return this.prisma.purchase.update({ where: { id }, data: { status: PurchaseStatus.CANCELLED } });
  }
}
