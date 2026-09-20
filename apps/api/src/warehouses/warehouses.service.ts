import { Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { AuditAction } from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { BusinessError } from '../common/errors/business.error';
import { WarehouseAccessService } from '../common/services/warehouse-access.service';
import type { RequestUser } from '../common/types';
import { ImageStorageService } from '../common/services/image-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCostCenterDto,
  CreateWarehouseDto,
  QueryWarehousesDto,
  UpdateCostCenterDto,
  UpdateWarehouseDto,
} from './dto/warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WarehouseAccessService,
    private readonly audit: AuditService,
    private readonly images: ImageStorageService,
  ) {}

  /**
   * Warehouse users still need the list of warehouses to read a transfer's
   * counterpart name, so the list is not restricted — but it exposes only
   * identifying fields, never stock.
   */
  async list(user: RequestUser, query: QueryWarehousesDto) {
    return this.prisma.warehouse.findMany({
      where: {
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        name: true,
        code: true,
        country: true,
        countryId: true,
        imageUrl: true,
        countryRef: { select: { id: true, code: true, name: true, currency: true } },
        isActive: true,
        _count: this.access.isAdmin(user) ? { select: { users: true } } : undefined,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(user: RequestUser, id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id },
      include: { costCenters: { select: { id: true, name: true, code: true, isActive: true } } },
    });
    if (!warehouse) throw BusinessError.notFound('Warehouse', id);

    // Stock counts are warehouse-confidential.
    if (!this.access.canAccess(user, id)) {
      const { id: wid, name, code, country, isActive } = warehouse;
      return { id: wid, name, code, country, isActive, costCenters: [], stock: null };
    }

    const grouped = await this.prisma.device.groupBy({
      by: ['status'],
      where: { currentWarehouseId: id },
      _count: { _all: true },
    });
    const stock = Object.fromEntries(
      Object.values(DeviceStatus).map((s) => [s, grouped.find((g) => g.status === s)?._count._all ?? 0]),
    );
    return { ...warehouse, stock };
  }

  async create(actor: RequestUser, dto: CreateWarehouseDto) {
    const warehouse = await this.prisma.warehouse.create({ data: dto });
    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CREATE_WAREHOUSE,
      entityType: 'Warehouse',
      entityId: warehouse.id,
      metadata: { code: warehouse.code },
    });
    return warehouse;
  }

  /** Replaces the warehouse photo, discarding whatever it had. */
  async setImage(actor: RequestUser, id: string, data: Buffer) {
    const existing = await this.mustExist(id);
    const imageUrl = await this.images.store(data, 'warehouses');

    const warehouse = await this.prisma.warehouse.update({ where: { id }, data: { imageUrl } });
    // Only after the row points at the new file, so a failed write never leaves
    // a warehouse showing a picture that is no longer there.
    await this.images.remove(existing.imageUrl);

    await this.audit.log({
      userId: actor.id,
      action: 'CHANGE_WAREHOUSE',
      entityType: 'Warehouse',
      entityId: id,
      metadata: { code: warehouse.code, imageUrl },
    });
    return warehouse;
  }

  async removeImage(actor: RequestUser, id: string) {
    const existing = await this.mustExist(id);
    if (!existing.imageUrl) return existing;

    const warehouse = await this.prisma.warehouse.update({ where: { id }, data: { imageUrl: null } });
    await this.images.remove(existing.imageUrl);

    await this.audit.log({
      userId: actor.id,
      action: 'CHANGE_WAREHOUSE',
      entityType: 'Warehouse',
      entityId: id,
      metadata: { code: warehouse.code, imageRemoved: true },
    });
    return warehouse;
  }

  async update(actor: RequestUser, id: string, dto: UpdateWarehouseDto) {
    await this.mustExist(id);
    const warehouse = await this.prisma.warehouse.update({ where: { id }, data: dto });
    await this.audit.log({
      userId: actor.id,
      action: 'CHANGE_WAREHOUSE',
      entityType: 'Warehouse',
      entityId: id,
      metadata: { changed: Object.keys(dto) },
    });
    return warehouse;
  }

  /** Countries are reference data every client needs to resolve prices. */
  listCountries() {
    return this.prisma.country.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        _count: { select: { warehouses: true } },
      },
    });
  }

  listCostCenters(warehouseId?: string) {
    const where: Prisma.CostCenterWhereInput = warehouseId ? { warehouseId } : {};
    return this.prisma.costCenter.findMany({
      where,
      include: { warehouse: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createCostCenter(dto: CreateCostCenterDto) {
    if (dto.warehouseId) await this.mustExist(dto.warehouseId);
    return this.prisma.costCenter.create({ data: { ...dto, warehouseId: dto.warehouseId ?? null } });
  }

  async updateCostCenter(id: string, dto: UpdateCostCenterDto) {
    const existing = await this.prisma.costCenter.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw BusinessError.notFound('Cost centre', id);
    return this.prisma.costCenter.update({ where: { id }, data: dto });
  }

  /** Returns the row, so a caller replacing the photo knows which file to drop. */
  private async mustExist(id: string) {
    const found = await this.prisma.warehouse.findUnique({
      where: { id },
      select: { id: true, code: true, imageUrl: true },
    });
    if (!found) throw BusinessError.notFound('Warehouse', id);
    return found;
  }
}
