import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction } from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { CreatePartyDto, QueryPartyDto, UpdatePartyDto } from '../common/dto/party.dto';
import { paginate } from '../common/dto/pagination.dto';
import { BusinessError } from '../common/errors/business.error';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: QueryPartyDto) {
    const where: Prisma.SupplierWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw BusinessError.notFound('Supplier', id);
    return supplier;
  }

  async create(actor: RequestUser, dto: CreatePartyDto) {
    const supplier = await this.prisma.supplier.create({ data: dto });
    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CREATE_SUPPLIER,
      entityType: 'Supplier',
      entityId: supplier.id,
      metadata: { name: supplier.name },
    });
    return supplier;
  }

  async update(id: string, dto: UpdatePartyDto) {
    await this.findOne(id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }
}
