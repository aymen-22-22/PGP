import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditAction, ErrorCode } from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';
import { BusinessError } from '../common/errors/business.error';
import type { RequestUser } from '../common/types';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, QueryUsersDto, UpdateUserDto } from './dto/user.dto';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  warehouse: { select: { id: true, name: true, code: true } },
  costCenter: { select: { id: true, name: true, code: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async list(query: QueryUsersDto) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role ? { role: query.role } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw BusinessError.notFound('User', id);
    return user;
  }

  async create(actor: RequestUser, dto: CreateUserDto) {
    this.assertWarehouseConsistency(dto.role, dto.warehouseId);
    await this.assertReferences(dto.warehouseId, dto.costCenterId);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash: await this.passwords.hash(dto.password),
        role: dto.role,
        warehouseId: dto.warehouseId ?? null,
        costCenterId: dto.costCenterId ?? null,
      },
      select: USER_SELECT,
    });

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CREATE_USER,
      entityType: 'User',
      entityId: user.id,
      metadata: { email: user.email, role: user.role, warehouseId: dto.warehouseId ?? null },
    });
    return user;
  }

  async update(actor: RequestUser, id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw BusinessError.notFound('User', id);

    const role = dto.role ?? existing.role;
    const warehouseId = dto.warehouseId !== undefined ? dto.warehouseId : existing.warehouseId;
    this.assertWarehouseConsistency(role, warehouseId);
    await this.assertReferences(dto.warehouseId, dto.costCenterId);

    if (actor.id === id && dto.isActive === false) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'You cannot deactivate your own account.');
    }
    if (actor.id === id && dto.role && dto.role !== existing.role) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'You cannot change your own role.');
    }

    // Any change to identity, access scope or credentials invalidates live tokens.
    const invalidatesSessions =
      dto.password !== undefined ||
      dto.isActive === false ||
      (dto.role !== undefined && dto.role !== existing.role) ||
      (dto.warehouseId !== undefined && dto.warehouseId !== existing.warehouseId);

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.warehouseId !== undefined ? { warehouseId: dto.warehouseId ?? null } : {}),
        ...(dto.costCenterId !== undefined ? { costCenterId: dto.costCenterId ?? null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.password !== undefined ? { passwordHash: await this.passwords.hash(dto.password) } : {}),
        ...(invalidatesSessions ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: USER_SELECT,
    });

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CHANGE_USER,
      entityType: 'User',
      entityId: id,
      metadata: {
        changed: Object.keys(dto).filter((k) => k !== 'password'),
        passwordReset: dto.password !== undefined,
      },
    });
    return user;
  }

  /**
   * Removes a user. Someone who never signed in is deleted outright; anyone
   * with history is archived instead — signed out, unable to sign in, gone
   * from the list, their email freed for reuse — so "received by Sara" on a
   * past transfer still says Sara.
   */
  async remove(actor: RequestUser, id: string): Promise<{ deleted: 'removed' | 'archived' }> {
    if (actor.id === id) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'You cannot delete your own account.');
    }
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw BusinessError.notFound('User', id);

    if (existing.role === Role.ADMIN) {
      const admins = await this.prisma.user.count({ where: { role: Role.ADMIN, isActive: true, deletedAt: null } });
      if (admins <= 1 && existing.isActive) {
        throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'This is the last administrator; it cannot be deleted.');
      }
    }

    const hasHistory =
      existing.lastLoginAt !== null || (await this.prisma.auditLog.count({ where: { userId: id } })) > 0;

    if (hasHistory) {
      await this.prisma.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          isActive: false,
          email: `deleted-${id}@deleted.invalid`,
          tokenVersion: { increment: 1 },
        },
      });
    } else {
      await this.prisma.user.delete({ where: { id } });
    }

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.DELETE_USER,
      entityType: 'User',
      entityId: id,
      metadata: { name: existing.name, email: existing.email, mode: hasHistory ? 'archived' : 'removed' },
    });
    return { deleted: hasHistory ? 'archived' : 'removed' };
  }

  /** A warehouse user without a warehouse could see nothing — and would be a silent bug. */
  private assertWarehouseConsistency(role: Role, warehouseId?: string | null): void {
    if (role === Role.WAREHOUSE_USER && !warehouseId) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'A warehouse user must be assigned to a warehouse.',
      );
    }
  }

  private async assertReferences(warehouseId?: string | null, costCenterId?: string | null): Promise<void> {
    if (warehouseId) {
      const found = await this.prisma.warehouse.findUnique({
        where: { id: warehouseId },
        select: { id: true },
      });
      if (!found) throw BusinessError.notFound('Warehouse', warehouseId);
    }
    if (costCenterId) {
      const found = await this.prisma.costCenter.findUnique({
        where: { id: costCenterId },
        select: { id: true },
      });
      if (!found) throw BusinessError.notFound('Cost centre', costCenterId);
    }
  }
}
