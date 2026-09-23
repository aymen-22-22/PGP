import { Inject, Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma, ReceiptStatus } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  type Paginated,
  type ReceiptListItem,
} from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';
import { BusinessError } from '../common/errors/business.error';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';
import { APP_CONFIG } from '../common/tokens';
import type { AppConfig } from '../config/configuration';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryReceiptsDto } from './dto/receipt.dto';

/**
 * Optional second pair of eyes on goods-in (spec §15).
 *
 * With REQUIRE_RECEIPT_VALIDATION=true, received devices sit in status RECEIVED —
 * traceable, but not yet sellable or transferable — until an administrator
 * validates the receipt and they become IN_STOCK.
 */
@Injectable()
export class ReceivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(user: RequestUser, query: QueryReceiptsDto): Promise<Paginated<ReceiptListItem<Date>>> {
    const where: Prisma.ReceiptWhereInput = {
      ...this.access.filterFor<Prisma.ReceiptWhereInput>(user, 'warehouseId', query.warehouseId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.search ? { number: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.receipt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        select: {
          id: true,
          number: true,
          source: true,
          status: true,
          expectedCount: true,
          scannedCount: true,
          createdAt: true,
          validatedAt: true,
          warehouse: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          validatedBy: { select: { id: true, name: true } },
          purchase: { select: { id: true, number: true } },
          transfer: { select: { id: true, number: true } },
        },
      }),
      this.prisma.receipt.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(user: RequestUser, id: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        validatedBy: { select: { id: true, name: true } },
        purchase: { select: { id: true, number: true } },
        transfer: { select: { id: true, number: true } },
        lines: {
          select: {
            id: true,
            imei: true,
            device: {
              select: { id: true, status: true, product: { select: { id: true, name: true, sku: true } } },
            },
          },
          take: 1000,
        },
      },
    });
    if (!receipt) throw BusinessError.notFound('Receipt', id);
    this.access.assertAccess(user, receipt.warehouseId);
    return receipt;
  }

  /** Releases a pending receipt: its devices become sellable stock. */
  async validate(user: RequestUser, id: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        status: true,
        warehouseId: true,
        scannedCount: true,
        expectedCount: true,
        warehouse: { select: { name: true, code: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!receipt) throw BusinessError.notFound('Receipt', id);
    this.access.assertAccess(user, receipt.warehouseId);

    if (receipt.status === ReceiptStatus.VALIDATED) {
      throw new BusinessError(ErrorCode.INVALID_STATUS_TRANSITION, 'This receipt is already validated.');
    }

    const released = await this.prisma.$transaction(async (tx) => {
      // Guarding on status inside the update makes a second concurrent
      // validation a no-op rather than a double release.
      const claim = await tx.receipt.updateMany({
        where: { id, status: ReceiptStatus.PENDING_VALIDATION },
        data: { status: ReceiptStatus.VALIDATED, validatedById: user.id, validatedAt: new Date() },
      });
      if (claim.count === 0) {
        throw BusinessError.conflict(
          ErrorCode.CONCURRENT_MODIFICATION,
          'This receipt was validated by someone else a moment ago.',
        );
      }

      const lines = await tx.receiptLine.findMany({ where: { receiptId: id }, select: { deviceId: true } });
      const deviceIds = lines.map((l) => l.deviceId);
      const updated = await tx.device.updateMany({
        where: { id: { in: deviceIds }, status: DeviceStatus.RECEIVED },
        data: { status: DeviceStatus.IN_STOCK },
      });
      return updated.count;
    });

    // Which products were released, summarised — a thousand IMEIs is not a list
    // anybody reads, and the lines are what tells you what you now hold.
    const byProduct = await this.prisma.device.groupBy({
      by: ['productId'],
      where: { receiptLines: { some: { receiptId: id } } },
      _count: { _all: true },
    });
    const products = await this.prisma.product.findMany({
      where: { id: { in: byProduct.map((g) => g.productId) } },
      select: { id: true, name: true, sku: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    await this.notifications.notify({
      event: 'RECEIPT_VALIDATED',
      reference: receipt.number,
      warehouseName: receipt.warehouse.name,
      destinationWarehouseId: receipt.warehouseId,
      referenceType: 'Receipt',
      referenceId: id,
      facts: {
        headline: `${released} phone${released === 1 ? '' : 's'} ready to sell in ${receipt.warehouse.name}`,
        journey: {
          area: 'buying',
          steps: [
            { label: 'Arrived', state: 'done', note: receipt.createdBy?.name ?? null },
            { label: 'Checked', state: 'done', note: user.name },
            { label: 'In stock', state: 'done', note: receipt.warehouse.name },
          ],
        },
        facts: [
          { label: 'Receipt', value: receipt.number },
          { label: 'Warehouse', value: receipt.warehouse.name },
          ...(receipt.createdBy ? [{ label: 'Received by', value: receipt.createdBy.name }] : []),
          { label: 'Validated by', value: user.name },
          { label: 'Validated at', value: new Date().toLocaleString('en-GB') },
          { label: 'Units released', value: `${released}` },
        ],
        lines: byProduct.flatMap((group) => {
          const product = productById.get(group.productId);
          return product
            ? [{ product: product.name, sku: product.sku, quantity: group._count._all }]
            : [];
        }),
        link: `${this.config.frontendUrl}/receipts`,
        linkLabel: 'Open receipts',
      },
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.VALIDATE_RECEIPT,
      entityType: 'Receipt',
      entityId: id,
      metadata: { number: receipt.number, devicesReleased: released },
    });

    return { id, status: ReceiptStatus.VALIDATED, devicesReleased: released };
  }
}
