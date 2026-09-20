import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type DocumentScope = 'PO' | 'TR' | 'SHP' | 'SO' | 'RET' | 'RCP' | 'LOT' | 'LC';

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
}
