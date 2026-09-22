import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, receiveDevices, seedFixture } from './helpers';

describe('Selling prices and the counter', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let imeis: string[];
  let countryId: string;

  const priceNow = async (at?: string) =>
    (
      await as(app, admin)
        .get(`/api/v1/products/${fixture.product.id}/price?countryId=${countryId}${at ? `&at=${at}` : ''}`)
        .expect(200)
    ).body;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    imeis = await receiveDevices(app, admin, fixture, 8);

    const country = await prisma.country.create({
      data: { code: 'DZ', name: 'Algeria', currency: 'DZD' },
    });
    countryId = country.id;
    await prisma.warehouse.update({ where: { id: fixture.central.id }, data: { countryId } });
  });
  afterAll(async () => {
    await app.close();
  });

  describe('prices', () => {
    it('falls back to the product list price before one is set', async () => {
      const res = await priceNow();
      expect(res.source).toBe('PRODUCT_DEFAULT');
      expect(res.price).toBe('980.00');
    });

    it('prefers a country price over a global one', async () => {
      await as(app, admin)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '1000.00', currency: 'EUR' })
        .expect(201);
      expect((await priceNow()).source).toBe('GLOBAL');

      await as(app, admin)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '350000.00', currency: 'DZD', countryId })
        .expect(201);
      const res = await priceNow();
      expect(res.source).toBe('COUNTRY');
      expect(res.price).toBe('350000.00');
      expect(res.currency).toBe('DZD');
    });

    /** A price is superseded, never overwritten, so an old sale stays explainable. */
    it('keeps the old price when a new one is set', async () => {
      await as(app, admin)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '350000.00', currency: 'DZD', countryId, validFrom: '2026-01-01T00:00:00Z' })
        .expect(201);
      await as(app, admin)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '365000.00', currency: 'DZD', countryId, validFrom: '2026-09-01T00:00:00Z' })
        .expect(201);

      expect((await priceNow()).price).toBe('365000.00');
      expect((await priceNow('2026-05-01T00:00:00Z')).price).toBe('350000.00');

      const history = (
        await as(app, admin)
          .get(`/api/v1/products/${fixture.product.id}/prices?countryId=${countryId}`)
          .expect(200)
      ).body;
      expect(history).toHaveLength(2);
      expect(history.filter((h: { validTo: string | null }) => h.validTo !== null)).toHaveLength(1);
    });

    it('refuses a price back-dated behind one already closed', async () => {
      await as(app, admin)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '100.00', currency: 'EUR', countryId, validFrom: '2026-01-01T00:00:00Z' })
        .expect(201);
      await as(app, admin)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '200.00', currency: 'EUR', countryId, validFrom: '2026-09-01T00:00:00Z' })
        .expect(201);

      const res = await as(app, admin)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '1.00', currency: 'EUR', countryId, validFrom: '2026-03-01T00:00:00Z' })
        .expect(400);
      expect(res.body.message).toContain('later price already exists');
    });

    it('only lets an admin change a price', async () => {
      const jean = await login(app, fixture.jean.email);
      await as(app, jean)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '1.00', currency: 'EUR' })
        .expect(403);
    });

    it('a B2B sale adopts the price list currency and stamps the rate', async () => {
      await as(app, admin)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '280000.00', currency: 'DZD', countryId })
        .expect(201);

      const sale = await as(app, admin)
        .post('/api/v1/sales')
        .send({
          customerId: fixture.customer.id,
          warehouseId: fixture.central.id,
          items: [{ productId: fixture.product.id, quantity: 1 }],
        })
        .expect(201);

      expect(sale.body.currency).toBe('DZD');
      expect(sale.body.totalAmount).toBe('280000.00');

      const row = await prisma.sale.findUnique({ where: { id: sale.body.id } });
      expect(row?.totalAmountBase.toFixed(2)).toBe('1000.00'); // 280,000 / 280
      expect(Number(row?.exchangeRate)).toBeCloseTo(1 / 280, 8);
    });

    it('reports revenue across currencies in one comparable figure', async () => {
      await as(app, admin)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '280000.00', currency: 'DZD', countryId })
        .expect(201);

      const sale = await as(app, admin)
        .post('/api/v1/sales')
        .send({
          customerId: fixture.customer.id,
          warehouseId: fixture.central.id,
          items: [{ productId: fixture.product.id, quantity: 1 }],
        })
        .expect(201);
      await as(app, admin)
        .post(`/api/v1/sales/${sale.body.id}/complete`)
        .send({ imeis: [imeis[0]] })
        .expect(200);

      const dash = await as(app, admin).get('/api/v1/reports/dashboard').expect(200);
      // EUR 1,000 of revenue, not a raw 280,000 that would dwarf every euro sale.
      expect(dash.body.financials.revenue).toBe('1000.00');
      expect(dash.body.financials.purchaseCost).toBe('900.00');
      expect(dash.body.financials.profit).toBe('100.00');

      const byProduct = await as(app, admin).get('/api/v1/reports/profit-by-product').expect(200);
      expect(byProduct.body.totals.revenue).toBe('1000.00');
    });

    it('a B2B sale with no price given uses the list', async () => {
      await as(app, admin)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '1111.00', currency: 'EUR', countryId })
        .expect(201);

      const sale = await as(app, admin)
        .post('/api/v1/sales')
        .send({
          customerId: fixture.customer.id,
          warehouseId: fixture.central.id,
          items: [{ productId: fixture.product.id, quantity: 2 }],
        })
        .expect(201);
      expect(sale.body.totalAmount).toBe('2222.00');
    });
  });

  describe('counter sales', () => {
    beforeEach(async () => {
      await as(app, admin)
        .post(`/api/v1/products/${fixture.product.id}/prices`)
        .send({ price: '280000.00', currency: 'DZD', countryId })
        .expect(201);
    });

    it('tells the cashier the price the moment a handset is scanned', async () => {
      const res = await as(app, admin)
        .post('/api/v1/pos/lookup')
        .send({ imei: imeis[0], warehouseId: fixture.central.id })
        .expect(200);
      expect(res.body.sellable).toBe(true);
      expect(res.body.price).toBe('280000.00');
      expect(res.body.currency).toBe('DZD');
    });

    it('refuses a handset that is not in this shop', async () => {
      const res = await as(app, admin)
        .post('/api/v1/pos/lookup')
        .send({ imei: '990000000999998', warehouseId: fixture.central.id })
        .expect(200);
      expect(res.body.sellable).toBe(false);
      expect(res.body.code).toBe('IMEI_NOT_FOUND');
    });

    it('sells, converts to the reporting currency, and books profit against landed cost', async () => {
      const res = await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[0] }, { imei: imeis[1] }] })
        .expect(201);

      expect(res.body.currency).toBe('DZD');
      expect(res.body.total).toBe('560000.00');
      expect(res.body.totalInBase).toBe('2000.00'); // 560,000 / 280
      expect(res.body.cost).toBe('1800.00'); // 2 units at 900 landed
      expect(res.body.grossProfit).toBe('200.00');

      const devices = await prisma.device.findMany({ where: { imei: { in: imeis.slice(0, 2) } } });
      expect(devices.every((d) => d.status === 'SOLD')).toBe(true);
    });

    /**
     * The bug this guards: the till showed EUR 980 but booked DZD 980 because
     * it assumed the shop's currency instead of the price's. Same number, a
     * hundredth of the money, and a wildly negative margin.
     */
    it('books the sale in the currency the price is actually in', async () => {
      // No DZD price for this product — the fallback is the EUR list price.
      await prisma.productPrice.deleteMany({});

      const res = await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[0] }] })
        .expect(201);

      expect(res.body.currency).toBe('EUR');
      expect(res.body.total).toBe('980.00');
      expect(res.body.totalInBase).toBe('980.00');
      expect(res.body.exchangeRate).toBe('1.00000000');
      // 980 sold against 900 landed — a sane margin, not minus seventeen hundred.
      expect(res.body.grossProfit).toBe('80.00');
    });

    it('refuses a currency that contradicts the price list', async () => {
      const res = await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, currency: 'EUR', lines: [{ imei: imeis[0] }] })
        .expect(400);
      expect(res.body.message).toContain('priced in DZD');
    });

    it('records a walk-in sale with no customer', async () => {
      const res = await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[0] }] })
        .expect(201);
      const sale = await prisma.sale.findUnique({ where: { id: res.body.saleId } });
      expect(sale?.customerId).toBeNull();
      expect(sale?.channel).toBe('POS');
    });

    it('lets the cashier override the price for one handset', async () => {
      const res = await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({
          warehouseId: fixture.central.id,
          lines: [{ imei: imeis[0], unitPrice: '250000.00' }],
        })
        .expect(201);
      expect(res.body.total).toBe('250000.00');
    });

    it('never sells the same handset twice', async () => {
      await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[0] }] })
        .expect(201);
      const again = await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[0] }] })
        .expect(409);
      expect(again.body.code).toBe('IMEI_ALREADY_SOLD');
    });

    it('rejects the same handset scanned twice in one basket', async () => {
      const res = await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[0] }, { imei: imeis[0] }] })
        .expect(400);
      expect(res.body.code).toBe('IMEI_DUPLICATE_IN_REQUEST');
    });

    it('will not sell a handset packed for a transfer', async () => {
      const transfer = await as(app, admin)
        .post('/api/v1/transfers')
        .send({
          sourceWarehouseId: fixture.central.id,
          destinationWarehouseId: fixture.france.id,
          items: [{ productId: fixture.product.id, quantity: 1 }],
          imeis: [imeis[0]],
        })
        .expect(201);
      expect(transfer.body.loadedQuantity).toBe(1);

      const res = await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[0] }] })
        .expect(400);
      expect(res.body.message).toContain('transfer');
    });

    it('keeps a warehouse account off the till entirely', async () => {
      // Selling is an office function; a warehouse account may receive and
      // move stock, but never quote a price or take a payment — not even at
      // its own warehouse.
      const jean = await login(app, fixture.jean.email);
      await as(app, jean)
        .post('/api/v1/pos/sales')
        .send({ lines: [{ imei: imeis[0] }] })
        .expect(403);
    });

    it('adds up the day’s takings', async () => {
      await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[0] }] })
        .expect(201);
      await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[1] }, { imei: imeis[2] }] })
        .expect(201);

      const today = await as(app, admin)
        .get(`/api/v1/pos/today?warehouseId=${fixture.central.id}`)
        .expect(200);
      expect(today.body.sales).toBe(2);
      expect(today.body.revenue).toBe('840000.00');
      expect(today.body.grossProfit).toBe('300.00'); // 3000 base − 2700 landed
    });

    it('shows counter sales in the one sales list and the IMEI history', async () => {
      const res = await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[0] }] })
        .expect(201);

      const sales = await as(app, admin).get('/api/v1/sales').expect(200);
      expect(sales.body.data.some((s: { number: string }) => s.number === res.body.number)).toBe(true);

      const history = await as(app, admin).get(`/api/v1/imeis/${imeis[0]}/history`).expect(200);
      expect(history.body.movements.map((m: { type: string }) => m.type)).toContain('SALE');
    });
  });

  describe('landed cost statement', () => {
    it('shows the build-up for an arrival', async () => {
      const receipt = await prisma.receipt.findFirst({ orderBy: { createdAt: 'desc' } });
      await as(app, admin)
        .post('/api/v1/cost-documents')
        .send({
          type: 'HANDLING',
          description: 'Unloading',
          amount: '80.00',
          currency: 'EUR',
          allocation: 'QUANTITY',
          scope: 'RECEIPT',
          scopeId: receipt!.id,
        })
        .expect(201);

      const res = await as(app, admin)
        .get(`/api/v1/landed-cost/receipt/${receipt!.id}`)
        .expect(200);

      expect(res.body.goods.units).toBe(8);
      expect(res.body.costs.purchase.perUnit).toBe('900.0000');
      expect(res.body.costs.components).toHaveLength(1);
      expect(res.body.costs.components[0].perUnit).toBe('10.0000');
      expect(res.body.costs.unitLandedCost).toBe('910.0000');
      expect(res.body.uniform).toBe(true);
      // One row per leg, not one per unit.
      expect(res.body.journey).toHaveLength(1);
      expect(res.body.journey[0].units).toBe(8);
    });

    it('reports a split lot honestly instead of averaging it', async () => {
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
      await as(app, admin)
        .post('/api/v1/cost-documents')
        .send({
          type: 'FREIGHT',
          amount: '30.00',
          currency: 'EUR',
          allocation: 'QUANTITY',
          scope: 'SHIPMENT',
          scopeId: transfer.body.id,
        })
        .expect(201);

      const device = await prisma.device.findFirst({ where: { imei: imeis[0] } });
      const res = await as(app, admin).get(`/api/v1/landed-cost/lot/${device!.lotId}`).expect(200);

      expect(res.body.uniform).toBe(false);
      expect(res.body.unitCostSpread).toEqual([
        { unitCost: '900.00', units: 5 },
        { unitCost: '910.00', units: 3 },
      ]);
    });
  });
});

describe('Walk-in sales have no customer (regression)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let imeis: string[];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    imeis = await receiveDevices(app, admin, fixture, 3);
  });
  afterAll(async () => {
    await app.close();
  });

  /**
   * The counter sells to people who are not customer records. Everything that
   * reads a sale has to cope with that — the IMEI history crashed on it.
   */
  it('serves the IMEI history of a walk-in sale without a customer', async () => {
    await as(app, admin)
      .post('/api/v1/pos/sales')
      .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[0] }] })
      .expect(201);

    const history = await as(app, admin).get(`/api/v1/imeis/${imeis[0]}/history`).expect(200);
    expect(history.body.device.sale).not.toBeNull();
    expect(history.body.device.sale.customer).toBeNull();
    expect(history.body.device.status).toBe('SOLD');

    const lookup = await as(app, admin).get(`/api/v1/imeis/${imeis[0]}`).expect(200);
    expect(lookup.body.sale.customer).toBeNull();
  });

  it('lists and opens a walk-in sale', async () => {
    const sale = await as(app, admin)
      .post('/api/v1/pos/sales')
      .send({ warehouseId: fixture.central.id, lines: [{ imei: imeis[0] }] })
      .expect(201);

    const list = await as(app, admin).get('/api/v1/sales').expect(200);
    const row = list.body.data.find((s: { number: string }) => s.number === sale.body.number);
    expect(row.customer).toBeNull();

    const detail = await as(app, admin).get(`/api/v1/sales/${sale.body.saleId}`).expect(200);
    expect(detail.body.customer).toBeNull();
    expect(detail.body.channel).toBe('POS');
  });
});
