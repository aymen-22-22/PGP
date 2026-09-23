import { DocumentNumberService, dayCode, slugOf } from './document-number.service';

function fakeTx(names: Record<string, string>) {
  const counters = new Map<string, number>();
  return {
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, name: names[id] ?? 'x' })),
    },
    device: { findMany: async () => [] },
    documentCounter: {
      upsert: async ({ where }: { where: { scope_year: { scope: string; year: number } } }) => {
        const key = `${where.scope_year.scope}/${where.scope_year.year}`;
        const value = (counters.get(key) ?? 0) + 1;
        counters.set(key, value);
        return { value };
      },
    },
  } as never;
}

describe('DocumentNumberService', () => {
  const service = new DocumentNumberService();
  const day = new Date(Date.UTC(2025, 10, 26));

  it('slugs product names and formats the day', () => {
    expect(slugOf('iPhone 18 Pro Max')).toBe('iphone18promax');
    expect(slugOf('Écouteurs USB-C')).toBe('ecouteursusbc');
    expect(dayCode(day)).toBe('26112025');
  });

  it('builds a readable reference and keeps repeats unique', async () => {
    const tx = fakeTx({ a: 'iPhone 18 Pro Max', b: 'Case' });
    expect(await service.next(tx, 'PO', [{ productId: 'a', quantity: 10 }], day)).toBe('PO-iphone18promax-26112025-10');
    expect(await service.next(tx, 'PO', [{ productId: 'a', quantity: 10 }], day)).toBe('PO-iphone18promax-26112025-10-2');
    expect(
      await service.next(tx, 'SO', [{ productId: 'b', quantity: 5 }, { productId: 'a', quantity: 20 }], day),
    ).toBe('SO-iphone18promax+1-26112025-25');
    expect(await service.next(tx, 'LC', undefined, day)).toBe('LC-26112025-1');
  });
});
