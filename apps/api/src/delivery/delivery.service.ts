import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction, ErrorCode } from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';
import { BusinessError } from '../common/errors/business.error';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateDeliveryCompanyDto,
  CreateDriverDto,
  QueryDeliveryDto,
  UpdateDeliveryCompanyDto,
  UpdateDriverDto,
} from './dto/delivery.dto';

/**
 * Who carries stock between warehouses.
 *
 * Neither a company nor a driver is ever deleted once it has carried
 * something — a shipment has to keep saying who moved it, and a hard delete
 * would either orphan that or rewrite history. Retiring hides it from every
 * picker's list while leaving the record intact; a row that has never been
 * used has nothing to preserve and can go.
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- companies -----------------------------------------------------------

  async listCompanies(query: QueryDeliveryDto) {
    const where: Prisma.DeliveryCompanyWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.deliveryCompany.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.pageSize,
        include: { _count: { select: { drivers: true, shipments: true } } },
      }),
      this.prisma.deliveryCompany.count({ where }),
    ]);

    const data = rows.map(({ _count, ...company }) => ({
      ...company,
      drivers: _count.drivers,
      shipments: _count.shipments,
    }));
    return paginate(data, total, query);
  }

  async createCompany(user: RequestUser, dto: CreateDeliveryCompanyDto) {
    const name = dto.name.trim();
    await this.assertCompanyNameFree(name);

    const company = await this.prisma.deliveryCompany.create({ data: { ...dto, name } });
    await this.audit.log({
      userId: user.id,
      action: AuditAction.CREATE_DELIVERY_COMPANY,
      entityType: 'DeliveryCompany',
      entityId: company.id,
      metadata: { name: company.name },
    });
    return company;
  }

  async updateCompany(user: RequestUser, id: string, dto: UpdateDeliveryCompanyDto) {
    const existing = await this.prisma.deliveryCompany.findUnique({ where: { id } });
    if (!existing) throw BusinessError.notFound('Delivery company', id);

    const name = dto.name?.trim();
    if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertCompanyNameFree(name);
    }

    const company = await this.prisma.deliveryCompany.update({
      where: { id },
      data: { ...dto, ...(name ? { name } : {}) },
    });
    await this.audit.log({
      userId: user.id,
      action: AuditAction.UPDATE_DELIVERY_COMPANY,
      entityType: 'DeliveryCompany',
      entityId: id,
      metadata: { name: company.name, isActive: company.isActive },
    });
    return company;
  }

  async removeCompany(user: RequestUser, id: string) {
    const company = await this.prisma.deliveryCompany.findUnique({
      where: { id },
      include: { _count: { select: { shipments: true, drivers: true } } },
    });
    if (!company) throw BusinessError.notFound('Delivery company', id);

    // Anything it has carried, or anyone driving for it, makes the record
    // worth keeping. Retiring is the honest operation there.
    if (company._count.shipments > 0 || company._count.drivers > 0) {
      throw BusinessError.conflict(
        ErrorCode.VALIDATION_FAILED,
        'This company has shipments or drivers against it. Deactivate it instead of deleting.',
        { shipments: company._count.shipments, drivers: company._count.drivers },
      );
    }

    await this.prisma.deliveryCompany.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: AuditAction.DELETE_DELIVERY_COMPANY,
      entityType: 'DeliveryCompany',
      entityId: id,
      metadata: { name: company.name },
    });
    return { deleted: true };
  }

  // --- drivers -------------------------------------------------------------

  async listDrivers(query: QueryDeliveryDto) {
    const where: Prisma.DriverWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.driver.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.pageSize,
        include: {
          company: { select: { id: true, name: true } },
          _count: { select: { shipments: true } },
        },
      }),
      this.prisma.driver.count({ where }),
    ]);

    const data = rows.map(({ _count, ...driver }) => ({ ...driver, shipments: _count.shipments }));
    return paginate(data, total, query);
  }

  async createDriver(user: RequestUser, dto: CreateDriverDto) {
    const name = dto.name.trim();
    if (dto.companyId) await this.assertCompanyExists(dto.companyId);

    const driver = await this.prisma.driver.create({
      data: { ...dto, name },
      include: { company: { select: { id: true, name: true } } },
    });
    await this.audit.log({
      userId: user.id,
      action: AuditAction.CREATE_DRIVER,
      entityType: 'Driver',
      entityId: driver.id,
      metadata: { name: driver.name, companyId: driver.companyId },
    });
    return driver;
  }

  async updateDriver(user: RequestUser, id: string, dto: UpdateDriverDto) {
    const existing = await this.prisma.driver.findUnique({ where: { id } });
    if (!existing) throw BusinessError.notFound('Driver', id);
    if (dto.companyId) await this.assertCompanyExists(dto.companyId);

    const driver = await this.prisma.driver.update({
      where: { id },
      data: { ...dto, ...(dto.name ? { name: dto.name.trim() } : {}) },
      include: { company: { select: { id: true, name: true } } },
    });
    await this.audit.log({
      userId: user.id,
      action: AuditAction.UPDATE_DRIVER,
      entityType: 'Driver',
      entityId: id,
      metadata: { name: driver.name, isActive: driver.isActive },
    });
    return driver;
  }

  async removeDriver(user: RequestUser, id: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id },
      include: { _count: { select: { shipments: true } } },
    });
    if (!driver) throw BusinessError.notFound('Driver', id);

    if (driver._count.shipments > 0) {
      throw BusinessError.conflict(
        ErrorCode.VALIDATION_FAILED,
        'This driver has carried shipments. Deactivate them instead of deleting.',
        { shipments: driver._count.shipments },
      );
    }

    await this.prisma.driver.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: AuditAction.DELETE_DRIVER,
      entityType: 'Driver',
      entityId: id,
      metadata: { name: driver.name },
    });
    return { deleted: true };
  }

  // --- guards --------------------------------------------------------------

  private async assertCompanyNameFree(name: string): Promise<void> {
    // Case-insensitive: "XYZ Transport" and "xyz transport" are one firm, and
    // two spellings in a dropdown is how a list becomes useless.
    const clash = await this.prisma.deliveryCompany.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { name: true },
    });
    if (clash) {
      throw BusinessError.conflict(
        ErrorCode.VALIDATION_FAILED,
        `"${clash.name}" already exists.`,
        { name: clash.name },
      );
    }
  }

  private async assertCompanyExists(id: string): Promise<void> {
    const company = await this.prisma.deliveryCompany.findUnique({ where: { id }, select: { id: true } });
    if (!company) throw BusinessError.notFound('Delivery company', id);
  }
}
