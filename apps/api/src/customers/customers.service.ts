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
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: QueryPartyDto) {
    const where: Prisma.CustomerWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw BusinessError.notFound('Customer', id);
    return customer;
  }

  async create(actor: RequestUser, dto: CreatePartyDto) {
    const customer = await this.prisma.customer.create({ data: dto });
    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CREATE_CUSTOMER,
      entityType: 'Customer',
      entityId: customer.id,
      metadata: { name: customer.name },
    });
    return customer;
  }

  async update(id: string, dto: UpdatePartyDto) {
    await this.findOne(id);
    return this.prisma.customer.update({ where: { id }, data: dto });
  }
}
