import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type DocumentScope = 'PO' | 'TR' | 'SHP' | 'SO' | 'RET' | 'RCP' | 'LOT' | 'LC' | 'UL';

/** What a document is about: products and how many of each, or the units themselves. */
export type DocumentContents = { productId: string; quantity: number }[] | { deviceIds: string[] };

/** Year 0 marks the counters that keep readable references unique. */
const READABLE_YEAR = 0;
const MAX_SLUG = 30;

/** "iPhone 18 Pro Max" → "iphone18promax". */
export function slugOf(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return slug.slice(0, MAX_SLUG) || 'item';
}

/** 26 November 2025 → "26112025". */
export function dayCode(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${date.getUTCFullYear()}`;
}

/**
 * Generates references people can read aloud: PO-iphone18promax-26112025-10.
 *
 *   PREFIX - main product - day (DDMMYYYY) - total quantity
 *
 * Several products show the largest line and how many others came with it
 * (PO-iphone18promax+2-26112025-30). The same reference a second time the
 * same day gets a suffix (…-10-2). That suffix comes from a counter row
 * updated inside the caller's transaction, so the row lock PostgreSQL takes
 * serialises concurrent generators and no two documents share a number.
 *
 * Unit label codes (UL-2026-000123) keep the numeric form: the scanner
 * recognises them by shape, and they are printed small.
 */
@Injectable()
export class DocumentNumberService {
  async next(
    tx: Prisma.TransactionClient,
    scope: DocumentScope,
    contents?: DocumentContents,
    date = new Date(),
  ): Promise<string> {
    const lines = await this.linesOf(tx, contents);
    const parts: string[] = [scope];
    if (lines.length > 0) {
      const names = await tx.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
        select: { id: true, name: true },
      });
      const nameOf = new Map(names.map((p) => [p.id, p.name]));
      const main = [...lines].sort((a, b) => b.quantity - a.quantity)[0]!;
      const others = lines.length - 1;
      parts.push(`${slugOf(nameOf.get(main.productId) ?? 'item')}${others > 0 ? `+${others}` : ''}`);
    }
    parts.push(dayCode(date));
    if (lines.length > 0) parts.push(String(lines.reduce((s, l) => s + l.quantity, 0)));

    const base = parts.join('-');
    const counter = await tx.documentCounter.upsert({
      where: { scope_year: { scope: base, year: READABLE_YEAR } },
      create: { scope: base, year: READABLE_YEAR, value: 1 },
      update: { value: { increment: 1 } },
    });
    // Without products the day alone is not a reference, so those always count.
    return lines.length > 0 && counter.value === 1 ? base : `${base}-${counter.value}`;
  }

  /**
   * A block of consecutive unit-label codes, taken in one increment.
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

  private async linesOf(
    tx: Prisma.TransactionClient,
    contents?: DocumentContents,
  ): Promise<{ productId: string; quantity: number }[]> {
    if (!contents) return [];
    let raw: { productId: string; quantity: number }[];
    if (Array.isArray(contents)) {
      raw = contents;
    } else {
      if (contents.deviceIds.length === 0) return [];
      const devices = await tx.device.findMany({
        where: { id: { in: contents.deviceIds } },
        select: { productId: true },
      });
      raw = devices.map((d) => ({ productId: d.productId, quantity: 1 }));
    }
    const merged = new Map<string, number>();
    for (const l of raw) if (l.quantity > 0) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.quantity);
    return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
  }
}
