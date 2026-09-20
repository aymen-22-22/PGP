import { Injectable } from '@nestjs/common';
import { Currency, Prisma } from '@prisma/client';
import { ErrorCode } from '@phone-erp/shared-types';
import { AuditService } from '../audit/audit.service';
import { BusinessError } from '../common/errors/business.error';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { SetPriceDto } from './dto/price.dto';

/**
 * Selling prices, kept as dated history.
 *
 * A price is never edited. Setting a new one closes the previous row and opens
 * another, so the price a sale was made at is always recoverable — the selling
 * side changes far more often than the buying side, and the two are unrelated.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The price in force for a product in a country at a moment in time.
   *
   * Falls back from a country price, to a price with no country (one price
   * everywhere), to the product's list price — so a product always has a price
   * even before anyone has set one.
   */
  async priceFor(
    productId: string,
    countryId: string | null,
    at: Date = new Date(),
  ): Promise<{ price: string; currency: Currency; source: 'COUNTRY' | 'GLOBAL' | 'PRODUCT_DEFAULT'; priceId: string | null }> {
    const window: Prisma.ProductPriceWhereInput = {
      productId,
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    };

    if (countryId) {
      const forCountry = await this.prisma.productPrice.findFirst({
        where: { ...window, countryId },
        orderBy: { validFrom: 'desc' },
      });
      if (forCountry) {
        return {
          price: forCountry.price.toFixed(2),
          currency: forCountry.currency,
          source: 'COUNTRY',
          priceId: forCountry.id,
        };
      }
    }

    const global = await this.prisma.productPrice.findFirst({
      where: { ...window, countryId: null },
      orderBy: { validFrom: 'desc' },
    });
    if (global) {
      return { price: global.price.toFixed(2), currency: global.currency, source: 'GLOBAL', priceId: global.id };
    }

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { defaultSalePrice: true, currency: true },
    });
    if (!product) throw BusinessError.notFound('Product', productId);
    return {
      price: product.defaultSalePrice.toFixed(2),
      currency: product.currency,
      source: 'PRODUCT_DEFAULT',
      priceId: null,
    };
  }

  /** The price a given warehouse sells at, resolved through its country. */
  async priceForWarehouse(productId: string, warehouseId: string, at: Date = new Date()) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { countryId: true },
    });
    return this.priceFor(productId, warehouse?.countryId ?? null, at);
  }

  /** Full history for a product, newest first. */
  async history(productId: string, countryId?: string) {
    const rows = await this.prisma.productPrice.findMany({
      where: { productId, ...(countryId ? { countryId } : {}) },
      orderBy: [{ validFrom: 'desc' }],
      include: {
        country: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    const now = new Date();
    return rows.map((r) => ({
      ...r,
      price: r.price.toFixed(2),
      isCurrent: r.validFrom <= now && (r.validTo === null || r.validTo > now),
    }));
  }

  /**
   * Opens a new price from a date, closing whatever was in force.
   *
   * Scheduling a price for the future is allowed; back-dating one before a
   * price that is already closed is not, because it would silently reinterpret
   * sales that have already happened.
   */
  async setPrice(user: RequestUser, productId: string, dto: SetPriceDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true },
    });
    if (!product) throw BusinessError.notFound('Product', productId);

    if (dto.countryId) {
      const country = await this.prisma.country.findUnique({
        where: { id: dto.countryId },
        select: { id: true },
      });
      if (!country) throw BusinessError.notFound('Country', dto.countryId);
    }
    if (Number(dto.price) < 0) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'A price cannot be negative.');
    }

    const validFrom = dto.validFrom ? new Date(dto.validFrom) : new Date();

    const closedAlready = await this.prisma.productPrice.findFirst({
      where: {
        productId,
        countryId: dto.countryId ?? null,
        validTo: { not: null, gt: validFrom },
      },
      orderBy: { validFrom: 'desc' },
    });
    if (closedAlready) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        'A later price already exists for this product. Set the new price from a date after it, or supersede that one.',
        400,
        { conflictingFrom: closedAlready.validFrom.toISOString() },
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // Close the open row so the two never overlap.
      await tx.productPrice.updateMany({
        where: { productId, countryId: dto.countryId ?? null, validTo: null, validFrom: { lte: validFrom } },
        data: { validTo: validFrom },
      });
      return tx.productPrice.create({
        data: {
          productId,
          countryId: dto.countryId ?? null,
          price: dto.price,
          currency: dto.currency,
          validFrom,
          createdById: user.id,
        },
        include: { country: { select: { id: true, code: true, name: true } } },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'SET_PRICE',
      entityType: 'Product',
      entityId: productId,
      metadata: {
        product: product.name,
        price: dto.price,
        currency: dto.currency,
        countryId: dto.countryId ?? null,
        validFrom: validFrom.toISOString(),
      },
    });

    return { ...created, price: created.price.toFixed(2) };
  }

  /** What every product sells for right now in one country. */
  async currentList(countryId?: string) {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, defaultSalePrice: true, currency: true },
      orderBy: { name: 'asc' },
    });

    const now = new Date();
    return Promise.all(
      products.map(async (p) => {
        const resolved = await this.priceFor(p.id, countryId ?? null, now);
        return {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          price: resolved.price,
          currency: resolved.currency,
          source: resolved.source,
        };
      }),
    );
  }
}
