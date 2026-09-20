import { Injectable } from '@nestjs/common';
import { Currency, Prisma } from '@prisma/client';
import { ErrorCode } from '@phone-erp/shared-types';
import { BusinessError } from '../common/errors/business.error';
import { PrismaService } from '../prisma/prisma.service';

/** Every cost and every margin is reported in this currency. */
export const BASE_CURRENCY: Currency = Currency.EUR;

@Injectable()
export class ExchangeRateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The rate in force on a given day. Rates are dated rows, never edits, so a
   * cost converted last September keeps September's rate even after the dinar
   * moves — otherwise every historical margin would drift.
   */
  async rateFor(from: Currency, to: Currency, on: Date = new Date()): Promise<Prisma.Decimal> {
    if (from === to) return new Prisma.Decimal(1);

    const rate = await this.prisma.exchangeRate.findFirst({
      where: { fromCurrency: from, toCurrency: to, validFrom: { lte: on } },
      orderBy: { validFrom: 'desc' },
    });
    if (rate) return rate.rate;

    // Derive the opposite direction by division rather than storing it.
    //
    // A stored inverse is lossy: 1/280 does not fit in eight decimal places, so
    // 0.00357143 turns an 8,400,000 DZD bill into €30,000.01 instead of
    // €30,000.00. Dividing keeps full decimal precision, so only the exact
    // direction (1 EUR = 280 DZD) ever needs to be recorded.
    const inverse = await this.prisma.exchangeRate.findFirst({
      where: { fromCurrency: to, toCurrency: from, validFrom: { lte: on } },
      orderBy: { validFrom: 'desc' },
    });
    if (inverse && !inverse.rate.isZero()) {
      return new Prisma.Decimal(1).dividedBy(inverse.rate);
    }

    throw new BusinessError(
      ErrorCode.VALIDATION_FAILED,
      `No exchange rate from ${from} to ${to} is known for ${on.toISOString().slice(0, 10)}. Add one under Settings.`,
      400,
      { from, to, on: on.toISOString() },
    );
  }

  /** Converts an amount into the reporting currency, returning the rate used. */
  async toBase(
    amount: Prisma.Decimal | string,
    currency: Currency,
    on: Date = new Date(),
  ): Promise<{ amountBase: string; exchangeRate: string }> {
    const rate = await this.rateFor(currency, BASE_CURRENCY, on);
    const value = new Prisma.Decimal(amount);
    return {
      amountBase: value.times(rate).toDecimalPlaces(2).toFixed(2),
      exchangeRate: rate.toFixed(8),
    };
  }

  list() {
    return this.prisma.exchangeRate.findMany({ orderBy: [{ validFrom: 'desc' }] });
  }

  /** Adding a rate never edits an old one: a new rate is a new dated row. */
  async add(input: { fromCurrency: Currency; toCurrency: Currency; rate: string; validFrom?: string }) {
    if (input.fromCurrency === input.toCurrency) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'A currency cannot be converted to itself.');
    }
    if (Number(input.rate) <= 0) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'A rate must be greater than zero.');
    }
    const validFrom = input.validFrom ? new Date(input.validFrom) : new Date();

    // Storing both directions invites rounding drift, because one of the two is
    // almost always a repeating decimal. Keep the exact direction and let the
    // other be derived.
    const opposite = await this.prisma.exchangeRate.findFirst({
      where: { fromCurrency: input.toCurrency, toCurrency: input.fromCurrency, validFrom: { lte: validFrom } },
    });
    if (opposite) {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        `A rate for ${input.toCurrency} → ${input.fromCurrency} already exists; the opposite direction is derived from it. ` +
          'Record only the exact direction, or supersede that rate instead.',
        400,
        { existing: { from: input.toCurrency, to: input.fromCurrency, rate: opposite.rate.toString() } },
      );
    }

    return this.prisma.exchangeRate.create({
      data: {
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate: input.rate,
        validFrom,
      },
    });
  }
}
