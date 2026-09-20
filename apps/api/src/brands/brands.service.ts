import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  ErrorCode,
  type BrandSummary,
  type Listed,
} from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { BusinessError } from '../common/errors/business.error';
import { ImageStorageService } from '../common/services/image-storage.service';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBrandDto, QueryBrandsDto, UpdateBrandDto } from './dto/brand.dto';

/**
 * Makes: Apple, Samsung, Xiaomi.
 *
 * The brand is how the stock browser is organised, so it is worth being a
 * record rather than a word typed onto each product — which is how you end up
 * with "Apple", "apple" and "APPLE " sitting in three separate piles.
 */
@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly images: ImageStorageService,
  ) {}

  async list(query: QueryBrandsDto): Promise<Listed<BrandSummary>> {
    const brands = await this.prisma.brand.findMany({
      where: {
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
        ...(query.inUse ? { products: { some: {} } } : {}),
      },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        isActive: true,
        _count: { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });

    return {
      data: brands.map(({ _count, ...brand }) => ({ ...brand, products: _count.products })),
      meta: { total: brands.length },
    };
  }

  async create(actor: RequestUser, dto: CreateBrandDto) {
    // Checked by name rather than left to the unique index, so the message says
    // what happened instead of surfacing a constraint violation.
    const existing = await this.prisma.brand.findFirst({
      where: { name: { equals: dto.name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (existing) {
      throw BusinessError.conflict(
        ErrorCode.DUPLICATE_CODE,
        `${existing.name} already exists.`,
        { brandId: existing.id, name: existing.name },
      );
    }

    const brand = await this.prisma.brand.create({ data: { name: dto.name } });
    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CREATE_PRODUCT,
      entityType: 'Brand',
      entityId: brand.id,
      metadata: { name: brand.name },
    });
    return brand;
  }

  async update(actor: RequestUser, id: string, dto: UpdateBrandDto) {
    await this.mustExist(id);

    if (dto.name) {
      const clash = await this.prisma.brand.findFirst({
        where: { name: { equals: dto.name, mode: 'insensitive' }, NOT: { id } },
        select: { id: true },
      });
      if (clash) {
        throw BusinessError.conflict(ErrorCode.DUPLICATE_CODE, `${dto.name} already exists.`);
      }
    }

    const brand = await this.prisma.brand.update({ where: { id }, data: dto });
    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CHANGE_PRODUCT,
      entityType: 'Brand',
      entityId: id,
      metadata: { changed: Object.keys(dto) },
    });
    return brand;
  }

  async setImage(actor: RequestUser, id: string, data: Buffer) {
    const existing = await this.mustExist(id);
    const imageUrl = await this.images.store(data, 'brands');

    const brand = await this.prisma.brand.update({ where: { id }, data: { imageUrl } });
    await this.images.remove(existing.imageUrl);

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CHANGE_PRODUCT,
      entityType: 'Brand',
      entityId: id,
      metadata: { name: brand.name, imageUrl },
    });
    return brand;
  }

  async removeImage(actor: RequestUser, id: string) {
    const existing = await this.mustExist(id);
    if (!existing.imageUrl) return existing;

    const brand = await this.prisma.brand.update({ where: { id }, data: { imageUrl: null } });
    await this.images.remove(existing.imageUrl);

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CHANGE_PRODUCT,
      entityType: 'Brand',
      entityId: id,
      metadata: { name: brand.name, imageRemoved: true },
    });
    return brand;
  }

  /** Resolves a brand id, refusing one that does not exist. */
  async mustExist(id: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      select: { id: true, name: true, imageUrl: true },
    });
    if (!brand) throw BusinessError.notFound('Brand', id);
    return brand;
  }

}
