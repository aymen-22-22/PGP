import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { allocate } from '../src/costing/allocation';
import { Fixture, as, createTestApp, login, receiveDevices, seedFixture } from './helpers';

describe('Landed costing', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let imeis: string[];
  let lotId: string;
  let receiptId: string;

  const landed = async (imei: string): Promise<string> =>
    (await as(app, admin).get(`/api/v1/imeis/${imei}`).expect(200)).body.landedCost;

  const postCost = (body: Record<string, unknown>) =>
    as(app, admin).post('/api/v1/cost-documents').send(body);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);

    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
      .send({
        lines: [
          {
            purchaseItemId: fixture.purchase.itemId,
            imeis: Array.from({ length: 10 }, (_, i) => testImeiAt(i + 1)),
          },
        ],
      })
      .expect(200);
    imeis = Array.from({ length: 10 }, (_, i) => testImeiAt(i + 1));
    lotId = res.body.lotIds[0];
    receiptId = res.body.receiptId;
  });
  afterAll(async () => {
    await app.close();
  });

  it('starts landed cost at the purchase price', async () => {
    expect(await landed(imeis[0])).toBe('900.00');
    const lot = await prisma.lot.findUnique({ where: { id: lotId } });
    expect(lot?.quantity).toBe(10);
    expect(lot?.unitPurchaseCost.toFixed(2)).toBe('900.00');
  });

  it('spreads a cost evenly across the units it covers', async () => {
    await postCost({
      type: 'HANDLING',
      amount: '50.00',
      currency: 'EUR',
      allocation: 'QUANTITY',
      scope: 'LOT',
      scopeId: lotId,
    }).expect(201);
    expect(await landed(imeis[0])).toBe('905.00');
  });

  /** The whole point of point 5: freight follows the units that actually moved. */
  it('charges a shipment only to the units on it', async () => {
    const transfer = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 3 }],
        imeis: imeis.slice(0, 3),
      })
      .expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);

    await postCost({
      type: 'FREIGHT',
      amount: '60.00',
      currency: 'EUR',
      allocation: 'QUANTITY',
      scope: 'SHIPMENT',
      scopeId: transfer.body.id,
    }).expect(201);

    expect(await landed(imeis[0])).toBe('920.00'); // shipped: +20
    expect(await landed(imeis[5])).toBe('900.00'); // stayed behind: untouched
  });

  it('converts a dinar bill to euros and stamps the rate', async () => {
    const res = await postCost({
      type: 'CUSTOMS',
      amount: '28000.00',
      currency: 'DZD',
      allocation: 'QUANTITY',
      scope: 'RECEIPT',
      scopeId: receiptId,
    }).expect(201);

    expect(res.body.amountBase).toBe('100.00'); // 28,000 / 280
    expect(Number(res.body.exchangeRate)).toBeCloseTo(1 / 280, 8);
    expect(await landed(imeis[0])).toBe('910.00');
  });

  it('weights an ad-valorem cost by what each unit is already worth', async () => {
    // Make one unit more valuable, then allocate by value.
    await postCost({
      type: 'HANDLING',
      amount: '100.00',
      currency: 'EUR',
      allocation: 'MANUAL',
      scope: 'DEVICES',
      deviceIds: await deviceIdsFor(prisma, imeis.slice(0, 2)),
      manualAmounts: await manualFor(prisma, [
        [imeis[0], '100.00'],
        [imeis[1], '0.00'],
      ]),
    }).expect(201);
    expect(await landed(imeis[0])).toBe('1000.00');
    expect(await landed(imeis[1])).toBe('900.00');

    await postCost({
      type: 'CUSTOMS',
      amount: '190.00',
      currency: 'EUR',
      allocation: 'VALUE',
      scope: 'DEVICES',
      deviceIds: await deviceIdsFor(prisma, imeis.slice(0, 2)),
    }).expect(201);

    // 1000 : 900 → 100 : 90
    expect(await landed(imeis[0])).toBe('1100.00');
    expect(await landed(imeis[1])).toBe('990.00');
  });

  it('rejects manual amounts that do not add up to the bill', async () => {
    const res = await postCost({
      type: 'OTHER',
      amount: '100.00',
      currency: 'EUR',
      allocation: 'MANUAL',
      scope: 'DEVICES',
      deviceIds: await deviceIdsFor(prisma, imeis.slice(0, 2)),
      manualAmounts: await manualFor(prisma, [
        [imeis[0], '40.00'],
        [imeis[1], '40.00'],
      ]),
    }).expect(400);
    expect(res.body.message).toContain('must match exactly');
  });

  /**
   * The business chose restatement over letting leftover stock absorb late
   * costs, so a bill that lands after a sale must move that sale's profit.
   */
  it('restates a completed sale when a late cost arrives', async () => {
    const sale = await as(app, admin)
      .post('/api/v1/sales')
      .send({
        customerId: fixture.customer.id,
        warehouseId: fixture.central.id,
        items: [{ productId: fixture.product.id, quantity: 1, unitPrice: '1000.00' }],
      })
      .expect(201);
    const completed = await as(app, admin)
      .post(`/api/v1/sales/${sale.body.id}/complete`)
      .send({ imeis: [imeis[0]] })
      .expect(200);
    expect(completed.body.cost).toBe('900.00');

    const late = await postCost({
      type: 'FREIGHT',
      amount: '100.00',
      currency: 'EUR',
      allocation: 'QUANTITY',
      scope: 'LOT',
      scopeId: lotId,
    }).expect(201);

    expect(late.body.restatedSales).toBe(1);
    expect(await landed(imeis[0])).toBe('910.00');

    const after = await as(app, admin).get(`/api/v1/sales/${sale.body.id}`).expect(200);
    expect(after.body.totalCost).toBe('910.00');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'POST_COST_DOCUMENT' } });
    expect((audit?.metadata as { restatedSales?: string[] })?.restatedSales).toHaveLength(1);
  });

  /**
   * Regression: accessory COGS is booked on the sale item when a bulk line is
   * picked. A late cost restating the sale must add that balance to the sum of
   * device landed costs — otherwise the 4.00 the cables actually cost would
   * be erased from the recomputed total.
   */
  it('keeps accessory cost-of-sale when a late bill restates the sale', async () => {
    const bulk = await as(app, admin)
      .post('/api/v1/purchases')
      .send({
        supplierId: fixture.supplier.id,
        warehouseId: fixture.central.id,
        items: [{ productId: fixture.accessory.id, quantity: 10, unitPrice: '2.00' }],
      })
      .expect(201);
    await as(app, admin)
      .post(`/api/v1/purchases/${bulk.body.id}/receive`)
      .send({ lines: [{ purchaseItemId: bulk.body.items[0].id, quantity: 10 }] })
      .expect(200);

    const sale = await as(app, admin)
      .post('/api/v1/sales')
      .send({
        customerId: fixture.customer.id,
        warehouseId: fixture.central.id,
        items: [
          { productId: fixture.product.id, quantity: 1, unitPrice: '1000.00' },
          { productId: fixture.accessory.id, quantity: 2, unitPrice: '5.00' },
        ],
      })
      .expect(201);
    const completed = await as(app, admin)
      .post(`/api/v1/sales/${sale.body.id}/complete`)
      .send({ imeis: [imeis[0]] })
      .expect(200);
    // 900.00 for the phone plus 2 × 2.00 for the cables.
    expect(completed.body.cost).toBe('904.00');

    const late = await postCost({
      type: 'FREIGHT',
      amount: '100.00',
      currency: 'EUR',
      allocation: 'QUANTITY',
      scope: 'LOT',
      scopeId: lotId,
    }).expect(201);

    expect(await landed(imeis[0])).toBe('910.00');
    expect(late.body.restatedSales).toBe(1);

    const after = await as(app, admin).get(`/api/v1/sales/${sale.body.id}`).expect(200);
    // 910.00 restated for the phone, and the 4.00 from the cables must still be there.
    expect(after.body.totalCost).toBe('914.00');
  });

  it('posts a draft with manual amounts chosen at posting time', async () => {
    const draft = await postCost({
      type: 'OTHER',
      amount: '100.00',
      currency: 'EUR',
      allocation: 'MANUAL',
      scope: 'DEVICES',
      deviceIds: await deviceIdsFor(prisma, imeis.slice(0, 2)),
      manualAmounts: await manualFor(prisma, [
        [imeis[0], '100.00'],
        [imeis[1], '0.00'],
      ]),
      post: false,
    }).expect(201);

    await as(app, admin)
      .post(`/api/v1/cost-documents/${draft.body.id}/post`)
      .send({
        manualAmounts: await manualFor(prisma, [
          [imeis[0], '100.00'],
          [imeis[1], '0.00'],
        ]),
      })
      .expect(200);
    expect(await landed(imeis[0])).toBe('1000.00');
    expect(await landed(imeis[1])).toBe('900.00');
  });

  /**
   * Regression: posting a MANUAL draft without its amounts used to dereference
   * the missing array and fall over with an internal 500. It must be a 400 the
   * operator can read and fix.
   */
  it('refuses to post a manual document that carries no amounts', async () => {
    const draft = await postCost({
      type: 'OTHER',
      amount: '100.00',
      currency: 'EUR',
      allocation: 'MANUAL',
      scope: 'DEVICES',
      deviceIds: await deviceIdsFor(prisma, imeis.slice(0, 2)),
      manualAmounts: await manualFor(prisma, [
        [imeis[0], '100.00'],
        [imeis[1], '0.00'],
      ]),
      post: false,
    }).expect(201);

    const res = await as(app, admin)
      .post(`/api/v1/cost-documents/${draft.body.id}/post`)
      .send({})
      .expect(400);
    expect(res.body.message).toContain('amount for each unit');

    const doc = await prisma.costDocument.findUnique({ where: { id: draft.body.id } });
    expect(doc?.status).toBe('DRAFT');
    expect(await prisma.costEntry.count({ where: { costDocumentId: draft.body.id } })).toBe(0);
  });

  it('reverses a posted cost and puts the figures back', async () => {
    const posted = await postCost({
      type: 'HANDLING',
      amount: '50.00',
      currency: 'EUR',
      allocation: 'QUANTITY',
      scope: 'LOT',
      scopeId: lotId,
    }).expect(201);
    expect(await landed(imeis[0])).toBe('905.00');

    await as(app, admin).post(`/api/v1/cost-documents/${posted.body.id}/reverse`).expect(200);
    expect(await landed(imeis[0])).toBe('900.00');

    const document = await prisma.costDocument.findUnique({ where: { id: posted.body.id } });
    // The document survives: the trail must show a cost was booked and taken back.
    expect(document?.status).toBe('REVERSED');
    expect(await prisma.costEntry.count({ where: { costDocumentId: posted.body.id } })).toBe(0);
  });

  it('rebuilds every landed cost from the ledger without changing anything', async () => {
    await postCost({
      type: 'FREIGHT',
      amount: '77.00',
      currency: 'EUR',
      allocation: 'QUANTITY',
      scope: 'LOT',
      scopeId: lotId,
    }).expect(201);
    const before = await landed(imeis[0]);

    // Corrupt the stored figure, then prove the ledger restores it.
    await prisma.device.updateMany({ data: { landedCost: '1.00' } });
    await as(app, admin).post('/api/v1/costing/rebuild').expect(200);
    expect(await landed(imeis[0])).toBe(before);
  });

  /**
   * 1/280 does not fit in DECIMAL(18,8). Storing the inverse turned an
   * 8,400,000 DZD bill into EUR 30,000.01; deriving it by division does not.
   */
  it('converts a large dinar bill without losing a cent to rounding', async () => {
    const res = await postCost({
      type: 'CUSTOMS',
      amount: '8400000.00',
      currency: 'DZD',
      allocation: 'QUANTITY',
      scope: 'LOT',
      scopeId: lotId,
    }).expect(201);
    expect(res.body.amountBase).toBe('30000.00');

    // And the allocation of it still reconciles exactly.
    const entries = await as(app, admin)
      .get(`/api/v1/cost-documents/${res.body.id}/entries`)
      .expect(200);
    const total = entries.body.reduce((sum: number, e: { amount: string }) => sum + Number(e.amount), 0);
    expect(total.toFixed(2)).toBe('30000.00');
  });

  it('refuses a second rate for a direction already derivable', async () => {
    const res = await as(app, admin)
      .post('/api/v1/exchange-rates')
      .send({ fromCurrency: 'DZD', toCurrency: 'EUR', rate: '0.00357143' })
      .expect(400);
    expect(res.body.message).toContain('already exists');
  });

  it('refuses a cost that applies to nothing', async () => {
    const res = await postCost({
      type: 'OTHER',
      amount: '10.00',
      currency: 'EUR',
      allocation: 'QUANTITY',
      scope: 'LOT',
      scopeId: '00000000-0000-4000-8000-000000000000',
    }).expect(400);
    expect(res.body.message).toContain('applies to no units');
  });

  it('keeps a warehouse user out of another warehouse’s costs', async () => {
    const jean = await login(app, fixture.jean.email);
    await as(app, jean)
      .post('/api/v1/cost-documents')
      .send({
        type: 'HANDLING',
        amount: '10.00',
        currency: 'EUR',
        allocation: 'QUANTITY',
        scope: 'LOT',
        scopeId: lotId,
      })
      .expect(403);
  });

  it('only lets an admin reverse or rebuild', async () => {
    const jean = await login(app, fixture.jean.email);
    await as(app, jean).post('/api/v1/costing/rebuild').expect(403);
  });
});

describe('Cost allocation arithmetic', () => {
  const targets = (n: number, basis = 10_000n) =>
    Array.from({ length: n }, (_, i) => ({ deviceId: `d${i}`, basis }));

  const sum = (rows: { amount: string }[]) =>
    rows.reduce((total, r) => total + Math.round(Number(r.amount) * 10_000), 0);

  it('never loses a cent on an indivisible amount', () => {
    // €100 / 3 = 33.3333… — the parts must still total exactly 100.
    const rows = allocate('100.00', targets(3));
    expect(rows).toHaveLength(3);
    expect(sum(rows)).toBe(1_000_000); // 100.0000 in ten-thousandths
  });

  it('reconciles for a long tail of awkward splits', () => {
    for (const n of [1, 2, 3, 7, 11, 97, 1000]) {
      for (const amount of ['0.01', '1.00', '100.00', '1234.57', '999999.99']) {
        const rows = allocate(amount, targets(n));
        expect(sum(rows)).toBe(Math.round(Number(amount) * 10_000));
      }
    }
  });

  it('weights by basis and still reconciles', () => {
    const rows = allocate('190.00', [
      { deviceId: 'a', basis: 10_000_000n },
      { deviceId: 'b', basis: 9_000_000n },
    ]);
    expect(rows[0].amount).toBe('100.0000');
    expect(rows[1].amount).toBe('90.0000');
    expect(sum(rows)).toBe(1_900_000);
  });

  it('splits evenly when every basis is zero', () => {
    const rows = allocate('30.00', targets(3, 0n));
    expect(rows.map((r) => r.amount)).toEqual(['10.0000', '10.0000', '10.0000']);
  });

  it('handles an empty target list', () => {
    expect(allocate('10.00', [])).toEqual([]);
  });
});

// --- helpers ---------------------------------------------------------------

function testImeiAt(index: number): string {
  const prefix = `99000000${String(index).padStart(6, '0')}`;
  let sum = 0;
  let double = true;
  for (let i = prefix.length - 1; i >= 0; i -= 1) {
    let digit = Number(prefix[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return prefix + String((10 - (sum % 10)) % 10);
}

async function deviceIdsFor(prisma: PrismaService, imeis: string[]): Promise<string[]> {
  const devices = await prisma.device.findMany({ where: { imei: { in: imeis } }, select: { id: true } });
  return devices.map((d) => d.id);
}

async function manualFor(
  prisma: PrismaService,
  pairs: [string, string][],
): Promise<{ deviceId: string; amount: string }[]> {
  const devices = await prisma.device.findMany({
    where: { imei: { in: pairs.map((p) => p[0]) } },
    select: { id: true, imei: true },
  });
  const byImei = new Map(devices.map((d) => [d.imei, d.id]));
  return pairs.map(([imei, amount]) => ({ deviceId: byImei.get(imei)!, amount }));
}
