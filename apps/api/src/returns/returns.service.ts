import { Inject, Injectable } from '@nestjs/common';
import { DeviceStatus, MovementType, Prisma, ReturnStatus } from '@prisma/client';
import { AuditAction, ErrorCode } from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';
import { BusinessError } from '../common/errors/business.error';
import { normalizeImeiBatch } from '../common/pipes/imei.util';
import { DocumentNumberService } from '../common/services/document-number.service';
import { MovementService } from '../common/services/movement.service';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import { APP_CONFIG } from '../common/tokens';
import type { RequestUser } from '../common/types';
import { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReturnDto, QueryReturnsDto } from './dto/return.dto';

/**
 * Minimal returns (spec §40): a sold phone comes back, and either re-enters
 * sellable stock or is parked as damaged. Deliberately not an RMA platform.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
    private readonly numbers: DocumentNumberService,
    private readonly movements: MovementService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(user: RequestUser, query: QueryReturnsDto) {
    const where: Prisma.ReturnWhereInput = {
      ...this.access.filterFor<Prisma.ReturnWhereInput>(user, 'warehouseId', query.warehouseId),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.search ? { number: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        include: {
          customer: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.return.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(user: RequestUser, id: string) {
    const record = await this.prisma.return.findUnique({
      where: { id },
      include: {
        customer: true,
        warehouse: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    if (!record) throw BusinessError.notFound('Return', id);
    this.access.assertAccess(user, record.warehouseId);
    return record;
  }

  async create(user: RequestUser, dto: CreateReturnDto) {
    const warehouseId = this.access.resolveWarehouseId(user, dto.warehouseId);

    const imeis = normalizeImeiBatch(
      dto.lines.map((l) => l.imei),
      this.config.imei.enforceChecksum,
    );
    const outcomeByImei = new Map(
      dto.lines.map((l, index) => [imeis[index], l.outcome ?? ReturnStatus.RESTOCKED]),
    );

    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
      select: { id: true },
    });
    if (!customer) throw BusinessError.notFound('Customer', dto.customerId);

    const devices = await this.prisma.device.findMany({
      where: { imei: { in: imeis } },
      select: { id: true, imei: true, status: true, productId: true, saleId: true },
    });
    const found = new Map(devices.map((d) => [d.imei, d]));
    const unknown = imeis.filter((i) => !found.has(i));
    if (unknown.length > 0) {
      throw new BusinessError(ErrorCode.IMEI_NOT_FOUND, `${unknown.length} IMEI(s) are unknown.`, 404, {
        imeis: unknown.slice(0, 20),
      });
    }

    const notSold = devices.filter((d) => d.status !== DeviceStatus.SOLD);
    if (notSold.length > 0) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        `${notSold.length} phone(s) were never sold, so they cannot be returned.`,
        400,
        { imeis: notSold.slice(0, 20).map((d) => d.imei) },
      );
    }

    const now = new Date();
    const created = await this.prisma.$transaction(
      async (tx) => {
        const number = await this.numbers.next(
          tx,
          'RET',
          devices.map((d) => ({ productId: d.productId, quantity: 1 })),
        );
        const record = await tx.return.create({
          data: {
            number,
            customerId: dto.customerId,
            warehouseId,
            reason: dto.reason,
            status: ReturnStatus.RETURNED,
            createdById: user.id,
            items: {
              create: devices.map((d) => ({
                deviceId: d.id,
                productId: d.productId,
                imei: d.imei as string,
                outcome: outcomeByImei.get(d.imei ?? '') ?? ReturnStatus.RESTOCKED,
              })),
            },
          },
        });

        // Restocked phones become sellable again; damaged ones stay out of stock
        // but remain located in the warehouse so they are never "lost".
        for (const status of [DeviceStatus.IN_STOCK, DeviceStatus.DAMAGED] as const) {
          const ids = devices
            .filter((d) =>
              status === DeviceStatus.IN_STOCK
                ? (outcomeByImei.get(d.imei ?? '') ?? ReturnStatus.RESTOCKED) === ReturnStatus.RESTOCKED
                : (outcomeByImei.get(d.imei ?? '') ?? ReturnStatus.RESTOCKED) === ReturnStatus.DAMAGED,
            )
            .map((d) => d.id);
          if (ids.length === 0) continue;

          const claimed = await tx.device.updateMany({
            where: { id: { in: ids }, status: DeviceStatus.SOLD },
            data: { status, currentWarehouseId: warehouseId, saleId: null, saleItemId: null, soldAt: null },
          });
          if (claimed.count !== ids.length) {
            throw BusinessError.conflict(
              ErrorCode.CONCURRENT_MODIFICATION,
              'Some of these phones were already returned. Nothing has been changed.',
            );
          }
        }

        await this.movements.recordMany(
          tx,
          devices.map((d) => ({
            deviceId: d.id,
            type: MovementType.RETURN,
            fromWarehouseId: null,
            toWarehouseId: warehouseId,
            referenceType: 'Return',
            referenceId: record.id,
            referenceNumber: record.number,
            performedById: user.id,
            metadata: {
              imei: d.imei!,
              outcome: outcomeByImei.get(d.imei ?? '') ?? ReturnStatus.RESTOCKED,
              originalSaleId: d.saleId,
            },
          })),
        );

        return record;
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    await this.audit.log({
      userId: user.id,
      action: AuditAction.CREATE_RETURN,
      entityType: 'Return',
      entityId: created.id,
      metadata: { number: created.number, devices: devices.length, at: now.toISOString() },
    });
    return this.findOne(user, created.id);
  }
}
