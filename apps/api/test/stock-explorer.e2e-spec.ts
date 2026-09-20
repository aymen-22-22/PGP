import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture, testImei } from './helpers';

/**
 * Walking into the stock, and being stopped at the door where appropriate.
 *
 * The authorisation tests matter most: a warehouse card that simply is not
 * rendered is not access control, and the endpoint must refuse the id even when
 * someone types it in directly.
 */
describe('Stock explorer', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let jean: string;
  let carlos: string;

  const receivePhones = async (count: number) => {
    const imeis = Array.from({ length: count }, (_, i) => testImei(i + 1));
    await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
      .send({ lines: [{ purchaseItemId: fixture.purchase.itemId, imeis }], allowPartial: true })
      .expect(200);
    return imeis;
  };

  const receiveAccessories = async (quantity: number, unitPrice: string) => {
    const po = await as(app, admin)
      .post('/api/v1/purchases')
      .send({
        supplierId: fixture.supplier.id,
        warehouseId: fixture.central.id,
        purchaseDate: new Date().toISOString(),
        items: [{ productId: fixture.accessory.id, quantity, unitPrice }],
      })
      .expect(201);
    await as(app, admin)
      .post(`/api/v1/purchases/${po.body.id}/receive`)
      .send({ lines: [{ purchaseItemId: po.body.items[0].id, quantity }] })
      .expect(200);
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    jean = await login(app, fixture.jean.email);
    carlos = await login(app, fixture.carlos.email);
    await receivePhones(4);
    await receiveAccessories(60, '2.00');
  });
  afterAll(async () => {
    await app.close();
  });

  describe('which warehouses are offered', () => {
    it('shows an administrator every active warehouse', async () => {
      const res = await as(app, admin).get('/api/v1/stock-explorer/warehouses').expect(200);
      expect(res.body.data.map((w: { code: string }) => w.code).sort()).toEqual(['CENTRAL', 'ES', 'FR']);
    });

    it('shows a warehouse user only their own', async () => {
      const res = await as(app, jean).get('/api/v1/stock-explorer/warehouses').expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(fixture.france.id);
    });

    it('refuses a warehouse the user was never given, even by direct id', async () => {
      // Jean can see the card for France only, but the guard is the endpoint.
      await as(app, jean)
        .get(`/api/v1/stock-explorer/warehouses/${fixture.spain.id}/categories`)
        .expect(403);

      await as(app, carlos)
        .get(`/api/v1/stock-explorer/warehouses/${fixture.central.id}/products/${fixture.product.id}`)
        .expect(403);
    });

    it('refuses before confirming whether the warehouse even exists', async () => {
      // A 404 here would tell an unauthorised caller that an id is real.
      const invented = '00000000-0000-4000-8000-000000000000';
      await as(app, jean).get(`/api/v1/stock-explorer/warehouses/${invented}/categories`).expect(403);
    });
  });

  describe('the figures on the cards', () => {
    it('adds up to the stock value on the dashboard', async () => {
      const [dashboard, warehouses] = await Promise.all([
        as(app, admin).get('/api/v1/reports/dashboard').expect(200),
        as(app, admin).get('/api/v1/stock-explorer/warehouses').expect(200),
      ]);

      const summed = warehouses.body.data
        .reduce((sum: number, w: { stockValue: string }) => sum + Number(w.stockValue), 0)
        .toFixed(2);
      expect(summed).toBe(dashboard.body.stockValue);
    });

    it('counts products, categories and units in the warehouse holding them', async () => {
      const res = await as(app, admin).get('/api/v1/stock-explorer/warehouses').expect(200);
      const central = res.body.data.find((w: { code: string }) => w.code === 'CENTRAL');

      // Four phones and sixty cables: two products, two categories, 64 units.
      expect(central).toMatchObject({ products: 2, categories: 2, quantity: 64 });
    });

    it('reports an empty warehouse as empty rather than omitting it', async () => {
      const res = await as(app, admin).get('/api/v1/stock-explorer/warehouses').expect(200);
      const spain = res.body.data.find((w: { code: string }) => w.code === 'ES');

      expect(spain).toMatchObject({ products: 0, quantity: 0, stockValue: '0.00' });
    });
  });

  describe('drilling in', () => {
    it('lists only categories that actually hold stock here', async () => {
      const res = await as(app, admin)
        .get(`/api/v1/stock-explorer/warehouses/${fixture.central.id}/categories`)
        .expect(200);

      // The browser is organised by make, so these are brands.
      const names = res.body.data.map((c: { category: string }) => c.category).sort();
      expect(names).toEqual(['Accessories', 'Apple']);
      expect(res.body.warehouse.code).toBe('CENTRAL');
    });

    it('category totals add up to the warehouse total', async () => {
      const [warehouses, categories] = await Promise.all([
        as(app, admin).get('/api/v1/stock-explorer/warehouses').expect(200),
        as(app, admin)
          .get(`/api/v1/stock-explorer/warehouses/${fixture.central.id}/categories`)
          .expect(200),
      ]);
      const central = warehouses.body.data.find((w: { code: string }) => w.code === 'CENTRAL');
      const summed = categories.body.data
        .reduce((sum: number, c: { stockValue: string }) => sum + Number(c.stockValue), 0)
        .toFixed(2);

      expect(summed).toBe(central.stockValue);
    });

    it('shows the products of one category with what is on the way and gone', async () => {
      const res = await as(app, admin)
        .get(`/api/v1/stock-explorer/warehouses/${fixture.central.id}/categories/Accessories/products`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        sku: 'ACC-USBC-2M',
        quantity: 60,
        inShipment: 0,
        sold: 0,
        status: 'IN_STOCK',
      });
    });
  });

  it('counts sold and in-shipment for this warehouse only', async () => {
    // Sell one from Central, then confirm Central's card and the product page
    // agree. They used to differ: the card counted every warehouse's sales.
    const devices = await as(app, admin).get('/api/v1/inventory/devices?pageSize=1').expect(200);
    await as(app, admin)
      .post('/api/v1/pos/sales')
      .send({ warehouseId: fixture.central.id, lines: [{ imei: devices.body.data[0].imei }] })
      .expect(201);

    const [cards, page] = await Promise.all([
      as(app, admin)
        .get(`/api/v1/stock-explorer/warehouses/${fixture.central.id}/categories/Apple/products`)
        .expect(200),
      as(app, admin)
        .get(`/api/v1/stock-explorer/warehouses/${fixture.central.id}/products/${fixture.product.id}`)
        .expect(200),
    ]);

    const card = cards.body.data.find((p: { productId: string }) => p.productId === fixture.product.id);
    expect(card.sold).toBe(page.body.stock.sold);
    expect(card.inShipment).toBe(page.body.stock.inShipment);
    expect(card.quantity).toBe(page.body.stock.available);
  });

  describe('warehouse photos', () => {
    // A real 4x4 PNG, and a text file claiming to be one.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      'base64',
    );

    it('stores a photo and shows it on the warehouse card', async () => {
      const upload = await as(app, admin)
        .post(`/api/v1/warehouses/${fixture.central.id}/image`)
        .attach('image', PNG, 'yard.png')
        .expect(201);

      expect(upload.body.imageUrl).toMatch(/^\/uploads\/warehouses\/[0-9a-f-]{36}\.png$/);

      const cards = await as(app, admin).get('/api/v1/stock-explorer/warehouses').expect(200);
      const central = cards.body.data.find((w: { code: string }) => w.code === 'CENTRAL');
      expect(central.imageUrl).toBe(upload.body.imageUrl);
    });

    it('refuses a file that only claims to be a picture', async () => {
      const res = await as(app, admin)
        .post(`/api/v1/warehouses/${fixture.central.id}/image`)
        .attach('image', Buffer.from('<?php echo 1; ?>'), { filename: 'yard.png', contentType: 'image/png' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('is refused to a warehouse user, even for their own warehouse', async () => {
      await as(app, jean)
        .post(`/api/v1/warehouses/${fixture.france.id}/image`)
        .attach('image', PNG, 'yard.png')
        .expect(403);
    });

    it('removing the photo clears the card', async () => {
      await as(app, admin)
        .post(`/api/v1/warehouses/${fixture.central.id}/image`)
        .attach('image', PNG, 'yard.png')
        .expect(201);

      const res = await as(app, admin)
        .delete(`/api/v1/warehouses/${fixture.central.id}/image`)
        .expect(200);

      expect(res.body.imageUrl).toBeNull();
    });
  });

  describe('the product page', () => {
    it('gathers stock, purchases and history in one answer', async () => {
      const res = await as(app, admin)
        .get(`/api/v1/stock-explorer/warehouses/${fixture.central.id}/products/${fixture.product.id}`)
        .expect(200);

      expect(res.body.product.sku).toBe('APL-IP18PM-256-BLK');
      // Four units is under the low-stock threshold, which is the point of it.
      expect(res.body.stock).toMatchObject({ available: 4, sold: 0, status: 'LOW' });
      expect(res.body.units).toHaveLength(4);
      expect(res.body.purchases[0].number).toMatch(/^PO-/);
      expect(res.body.movements.length).toBeGreaterThan(0);
      expect(res.body.movements[0]).toMatchObject({ kind: 'DEVICE', type: 'PURCHASE_RECEIPT' });
    });

    it('shows an accessory by quantity, with its ledger rather than units', async () => {
      const res = await as(app, admin)
        .get(`/api/v1/stock-explorer/warehouses/${fixture.central.id}/products/${fixture.accessory.id}`)
        .expect(200);

      expect(res.body.stock).toMatchObject({ available: 60, inShipment: 0, sold: 0 });
      expect(res.body.units).toHaveLength(0);
      expect(res.body.movements[0]).toMatchObject({ kind: 'QUANTITY', type: 'PURCHASE_RECEIPT' });
    });

    it('records a sale against the product it sold', async () => {
      const imeis = await as(app, admin)
        .get('/api/v1/inventory/devices?pageSize=1')
        .expect(200);
      const imei = imeis.body.data[0].imei;

      await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({ warehouseId: fixture.central.id, lines: [{ imei }] })
        .expect(201);

      const res = await as(app, admin)
        .get(`/api/v1/stock-explorer/warehouses/${fixture.central.id}/products/${fixture.product.id}`)
        .expect(200);

      expect(res.body.stock).toMatchObject({ available: 3, sold: 1 });
      expect(res.body.sales[0].number).toMatch(/^SO-/);
    });
  });
});
