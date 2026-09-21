import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type DocumentScope = 'PO' | 'TR' | 'SHP' | 'SO' | 'RET' | 'RCP' | 'LOT' | 'LC' | 'UL';

/**
 * Generates PO-2026-000001 style references.
 *
 * The counter row is updated inside the caller's transaction, so the row lock
 * PostgreSQL takes on the update serialises concurrent generators and no two
 * documents can ever receive the same number.
 */
@Injectable()
export class DocumentNumberService {
  async next(tx: Prisma.TransactionClient, scope: DocumentScope, date = new Date()): Promise<string> {
    const year = date.getUTCFullYear();
    const counter = await tx.documentCounter.upsert({
      where: { scope_year: { scope, year } },
      create: { scope, year, value: 1 },
      update: { value: { increment: 1 } },
    });
    return `${scope}-${year}-${String(counter.value).padStart(6, '0')}`;
  }

  /**
   * A block of consecutive references, taken in one increment.
   *
   * Calling next() in a loop would take the counter's row lock once per
   * reference; a thousand labels would be a thousand round trips to hold and
   * release the same lock. One increment of `count` reserves the whole range,
   * and the numbers in between are arithmetic.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    scope: DocumentScope,
    count: number,
    date = new Date(),
  ): Promise<string[]> {
    if (count <= 0) return [];
    const year = date.getUTCFullYear();
    const counter = await tx.documentCounter.upsert({
      where: { scope_year: { scope, year } },
      create: { scope, year, value: count },
      update: { value: { increment: count } },
    });
    const first = counter.value - count + 1;
    return Array.from(
      { length: count },
      (_, i) => `${scope}-${year}-${String(first + i).padStart(6, '0')}`,
    );
  }
}
