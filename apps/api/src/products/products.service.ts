import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  type Paginated,
  type Product as ProductDto,
} from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';
import { BusinessError } from '../common/errors/business.error';
import type { RequestUser } from '../common/types';
import { BrandsService } from '../brands/brands.service';
import { ImageStorageService } from '../common/services/image-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, QueryProductsDto, UpdateProductDto } from './dto/product.dto';


/** What every product read returns, so the brand always arrives with it. */
const WITH_BRAND = { brand: { select: { id: true, name: true, imageUrl: true } } } as const;

/**
 * A Prisma row as the API sends it.
 *
 * Money crosses as a decimal string with its places intact — `"12.50"`, not
 * `12.5`. Prisma's Decimal serialises as the latter, which is a different
 * number of pennies to anything parsing it, and was the one endpoint in this
 * API not following the rule.
 */
const toProduct = (row: Prisma.ProductGetPayload<{ include: typeof WITH_BRAND }>): ProductDto => ({
  id: row.id,
  name: row.name,
  sku: row.sku,
  barcode: row.barcode,
  brandId: row.brandId,
  brand: row.brand,
  model: row.model,
  storage: row.storage,
  color: row.color,
  category: row.category,
  imageUrl: row.imageUrl,
  tracking: row.tracking,
  purchasePrice: row.purchasePrice.toFixed(2),
  defaultSalePrice: row.defaultSalePrice.toFixed(2),
  currency: row.currency,
  isActive: row.isActive,
});

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly images: ImageStorageService,
    private readonly brands: BrandsService,
  ) {}

  async list(query: QueryProductsDto): Promise<Paginated<ProductDto>> {
    const where: Prisma.ProductWhereInput = {
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.brand ? { brand: { name: { equals: query.brand, mode: 'insensitive' } } } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.tracking ? { tracking: query.tracking } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { model: { contains: query.search, mode: 'insensitive' } },
              { brand: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: WITH_BRAND,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginate(data.map(toProduct), total, query);
  }

  async findOne(id: string): Promise<ProductDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: WITH_BRAND,
    });
    if (!product) throw BusinessError.notFound('Product', id);
    return toProduct(product);
  }

  async create(actor: RequestUser, dto: CreateProductDto): Promise<ProductDto> {
    // Refused here rather than as a foreign-key violation, so an unknown brand
    // reads as a missing brand.
    await this.brands.mustExist(dto.brandId);

    const product = await this.prisma.product.create({ data: dto, include: WITH_BRAND });
    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CREATE_PRODUCT,
      entityType: 'Product',
      entityId: product.id,
      metadata: { sku: product.sku },
    });
    return toProduct(product);
  }

  /** Replaces a product's photo, discarding the one it had. */
  async setImage(actor: RequestUser, id: string, data: Buffer): Promise<ProductDto> {
    const existing = await this.findOne(id);
    const imageUrl = await this.images.store(data, 'products');

    const product = await this.prisma.product.update({
      where: { id },
      data: { imageUrl },
      include: WITH_BRAND,
    });
    // Only once the row points at the new file, so a failed write never leaves
    // the product showing a picture that is no longer there.
    await this.images.remove(existing.imageUrl);

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CHANGE_PRODUCT,
      entityType: 'Product',
      entityId: id,
      metadata: { sku: product.sku, imageUrl },
    });
    return toProduct(product);
  }

  async removeImage(actor: RequestUser, id: string): Promise<ProductDto> {
    const existing = await this.findOne(id);
    if (!existing.imageUrl) return existing;

    const product = await this.prisma.product.update({
      where: { id },
      data: { imageUrl: null },
      include: WITH_BRAND,
    });
    await this.images.remove(existing.imageUrl);

    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CHANGE_PRODUCT,
      entityType: 'Product',
      entityId: id,
      metadata: { sku: product.sku, imageRemoved: true },
    });
    return toProduct(product);
  }

  async update(actor: RequestUser, id: string, dto: UpdateProductDto): Promise<ProductDto> {
    const existing = await this.findOne(id);

    // Switching how a product is counted, once it has been counted, cannot be
    // done coherently: the phones already recorded as Device rows have no
    // quantity to become, and a quantity has no IMEIs to become. Refuse while
    // stock exists rather than silently orphaning it.
    if (dto.tracking && dto.tracking !== existing.tracking) {
      const [devices, level] = await Promise.all([
        this.prisma.device.count({ where: { productId: id } }),
        this.prisma.stockLevel.findFirst({ where: { productId: id, quantity: { not: 0 } } }),
      ]);
      if (devices > 0 || level) {
        throw new BusinessError(
          ErrorCode.TRACKING_MODE_MISMATCH,
          'This product already has stock recorded, so how it is tracked can no longer be changed. Create a new product instead.',
          409,
          { productId: id, devices, hasBulkStock: Boolean(level) },
        );
      }
    }
    if (dto.brandId) await this.brands.mustExist(dto.brandId);

    const product = await this.prisma.product.update({ where: { id }, data: dto, include: WITH_BRAND });
    await this.audit.log({
      userId: actor.id,
      action: AuditAction.CHANGE_PRODUCT,
      entityType: 'Product',
      entityId: id,
      metadata: { changed: Object.keys(dto) },
    });
    return toProduct(product);
  }
}
