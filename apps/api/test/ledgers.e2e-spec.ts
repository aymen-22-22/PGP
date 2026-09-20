import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture, testImei } from './helpers';

/**
 * The drill-down contract: a ledger must add up to the tile it explains.
 *
 * These tests exist because the failure they guard against is silent. A ledger
 * that is a penny out still looks right, and the person reading it has no way
 * to tell which of the two numbers to believe.
 */
describe('Dashboard ledgers reconcile with their KPIs', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;

  const orderAccessories = async (quantity: number, unitPrice: string) => {
    const res = await as(app, admin)
      .post('/api/v1/purchases')
      .send({
        supplierId: fixture.supplier.id,
        warehouseId: fixture.central.id,
        purchaseDate: new Date().toISOString(),
        items: [{ productId: fixture.accessory.id, quantity, unitPrice }],
      })
      .expect(201);
    return { id: res.body.id as string, itemId: res.body.items[0].id as string };
  };

  /** A world with phones and accessories received, then partly sold. */
  const buildHistory = async () => {
    const imeis = Array.from({ length: 6 }, (_, i) => testImei(i + 1));
    const phoneReceipt = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
      .send({ lines: [{ purchaseItemId: fixture.purchase.itemId, imeis }], allowPartial: true })
      .expect(200);

    const accessories = await orderAccessories(100, '2.00');
    await as(app, admin)
      .post(`/api/v1/purchases/${accessories.id}/receive`)
      .send({ lines: [{ purchaseItemId: accessories.itemId, quantity: 100 }] })
      .expect(200);

    // Freight, so landed cost is not simply the purchase price.
    await as(app, admin)
      .post('/api/v1/cost-documents')
      .send({
        type: 'FREIGHT',
        amount: '300.00',
        currency: 'EUR',
        allocation: 'QUANTITY',
        scope: 'RECEIPT',
        // The phones' receipt specifically: landed costing allocates onto
        // devices, and the accessory receipt has none.
        scopeId: phoneReceipt.body.receiptId,
        post: true,
      })
      .expect(201);

    // Two counter sales: one mixing a phone with accessories, one phones only.
    await as(app, admin)
      .post('/api/v1/pos/sales')
      .send({
        warehouseId: fixture.central.id,
        lines: [{ imei: imeis[0] }],
        items: [{ productId: fixture.accessory.id, quantity: 3 }],
      })
      .expect(201);

    await as(app, admin)
      .post('/api/v1/pos/sales')
      .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[1] }, { imei: imeis[2] }] })
      .expect(201);

    return imeis;
  };

  const dashboard = async (query = '') =>
    (await as(app, admin).get(`/api/v1/reports/dashboard${query}`).expect(200)).body;

  const ledger = async (name: string, query = '') =>
    (await as(app, admin).get(`/api/v1/reports/ledger/${name}${query}`).expect(200)).body;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    await buildHistory();
  });
  afterAll(async () => {
    await app.close();
  });

  it('stock value ledger adds up to the stock value tile', async () => {
    const tile = await dashboard();
    const rows = await ledger('stock-value');

    expect(rows.totals.stockValue).toBe(tile.stockValue);
    expect(rows.data.length).toBeGreaterThan(0);
  });

  it('revenue ledger adds up to the revenue tile', async () => {
    const tile = await dashboard();
    const rows = await ledger('revenue');

    expect(rows.totals.revenue).toBe(tile.financials.revenue);
    expect(rows.totals.transactions).toBe(tile.financials.completedSales);
  });

  it('cost ledger adds up to the purchase cost tile', async () => {
    const tile = await dashboard();
    const rows = await ledger('cost');

    expect(rows.totals.cost).toBe(tile.financials.purchaseCost);
  });

  it('profit ledger adds up to the profit tile, margin included', async () => {
    const tile = await dashboard();
    const rows = await ledger('profit');

    expect(rows.totals.profit).toBe(tile.financials.profit);
    expect(rows.totals.margin).toBe(tile.financials.margin);
  });

  it('keeps totals over the whole set when a page shows only part of it', async () => {
    const all = await ledger('revenue');
    const firstPage = await ledger('revenue', '?pageSize=1');

    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.meta.total).toBe(all.meta.total);
    // The figure must describe everything the filter covers, not this page.
    expect(firstPage.totals.revenue).toBe(all.totals.revenue);
  });

  it('a narrowed ledger still matches the tile narrowed the same way', async () => {
    const query = `?warehouseId=${fixture.central.id}`;
    const tile = await dashboard(query);
    const rows = await ledger('profit', query);

    expect(rows.totals.revenue).toBe(tile.financials.revenue);
    expect(rows.totals.cost).toBe(tile.financials.purchaseCost);
    expect(rows.totals.profit).toBe(tile.financials.profit);
  });

  it('reports nothing for a period with no sales, and says so honestly', async () => {
    const query = '?from=2000-01-01T00:00:00.000Z&to=2000-12-31T00:00:00.000Z';
    const tile = await dashboard(query);
    const rows = await ledger('revenue', query);

    expect(tile.financials.revenue).toBe('0.00');
    expect(rows.totals.revenue).toBe('0.00');
    expect(rows.data).toHaveLength(0);
  });

  it('every line carries the sale it belongs to, so a row can be opened', async () => {
    const rows = await ledger('revenue');
    for (const row of rows.data) {
      expect(row.saleId).toEqual(expect.any(String));
      expect(row.reference).toMatch(/^SO-/);
    }
  });

  it('cost lines name the purchase and supplier the units arrived on', async () => {
    const rows = await ledger('cost');
    const phoneLine = rows.data.find((r: { tracking: string }) => r.tracking === 'SERIALIZED');

    expect(phoneLine.purchaseNumber).toMatch(/^PO-/);
    expect(phoneLine.supplierName).toBe('China Supplier');
  });

  it('filters by product without breaking the arithmetic', async () => {
    const all = await ledger('profit');
    const justPhones = await ledger('profit', `?productId=${fixture.product.id}`);
    const justCables = await ledger('profit', `?productId=${fixture.accessory.id}`);

    expect(Number(justPhones.totals.revenue) + Number(justCables.totals.revenue)).toBeCloseTo(
      Number(all.totals.revenue),
      2,
    );
  });
});
