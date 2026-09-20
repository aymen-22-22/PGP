import { INestApplication } from '@nestjs/common';
import { TrackingMode } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture, testImei } from './helpers';

/**
 * Accessories: stock that has no IMEI because the units are identical.
 *
 * The rules being pinned here are the ones that separate a quantity from a
 * serial number — that it cannot go negative, that it is costed by average
 * rather than specifically, and that a product cannot change its mind about
 * which kind of stock it is once it holds any.
 */
describe('Bulk stock for accessories', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;

  /** An accessory purchase, since the fixture purchase only holds phones. */
  const orderAccessories = async (quantity: number, unitPrice: string, warehouseId?: string) => {
    const res = await as(app, admin)
      .post('/api/v1/purchases')
      .send({
        supplierId: fixture.supplier.id,
        warehouseId: warehouseId ?? fixture.central.id,
        purchaseDate: new Date().toISOString(),
        items: [{ productId: fixture.accessory.id, quantity, unitPrice }],
      })
      .expect(201);
    return { id: res.body.id as string, itemId: res.body.items[0].id as string };
  };

  const receiveAccessories = (purchase: { id: string; itemId: string }, quantity: number) =>
    as(app, admin)
      .post(`/api/v1/purchases/${purchase.id}/receive`)
      .send({ lines: [{ purchaseItemId: purchase.itemId, quantity }] });

  const levelAt = (warehouseId: string) =>
    prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: fixture.accessory.id, warehouseId } },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('receiving', () => {
    it('books a quantity in without creating any device rows', async () => {
      const purchase = await orderAccessories(100, '2.00');
      const res = await receiveAccessories(purchase, 100).expect(200);

      expect(res.body.scanned).toBe(100);
      const level = await levelAt(fixture.central.id);
      expect(level?.quantity).toBe(100);
      expect(await prisma.device.count({ where: { productId: fixture.accessory.id } })).toBe(0);
    });

    it('re-averages the unit cost when the price changes', async () => {
      // 100 at 2.00 then 100 at 3.00 is 500.00 over 200 units.
      await receiveAccessories(await orderAccessories(100, '2.00'), 100).expect(200);
      await receiveAccessories(await orderAccessories(100, '3.00'), 100).expect(200);

      const level = await levelAt(fixture.central.id);
      expect(level?.quantity).toBe(200);
      expect(level?.avgUnitCost.toFixed(2)).toBe('2.50');
    });

    it('refuses IMEIs scanned against an accessory', async () => {
      const purchase = await orderAccessories(10, '2.00');
      const res = await as(app, admin)
        .post(`/api/v1/purchases/${purchase.id}/receive`)
        .send({ lines: [{ purchaseItemId: purchase.itemId, imeis: [testImei(1)] }] })
        .expect(400);
      expect(res.body.code).toBe('TRACKING_MODE_MISMATCH');
    });

    it('refuses a quantity entered against a phone line', async () => {
      const res = await as(app, admin)
        .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
        .send({ lines: [{ purchaseItemId: fixture.purchase.itemId, quantity: 5 }] })
        .expect(400);
      expect(res.body.code).toBe('TRACKING_MODE_MISMATCH');
    });

    it('will not receive more than was ordered', async () => {
      const purchase = await orderAccessories(10, '2.00');
      const res = await receiveAccessories(purchase, 11).expect(400);
      expect(res.body.code).toBe('QUANTITY_EXCEEDED');
    });
  });

  describe('selling', () => {
    const sellAtTill = (quantity: number) =>
      as(app, admin)
        .post('/api/v1/pos/sales')
        .send({
          warehouseId: fixture.central.id,
          items: [{ productId: fixture.accessory.id, quantity }],
        });

    beforeEach(async () => {
      await receiveAccessories(await orderAccessories(100, '2.00'), 100).expect(200);
    });

    it('sells accessories over the counter and books cost at the average', async () => {
      const res = await sellAtTill(3).expect(201);

      expect(res.body.total).toBe('27.00');
      expect(res.body.cost).toBe('6.00');
      expect((await levelAt(fixture.central.id))?.quantity).toBe(97);
    });

    it('sells phones and accessories on one receipt', async () => {
      const imeis = await (async () => {
        await as(app, admin)
          .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
          .send({ lines: [{ purchaseItemId: fixture.purchase.itemId, imeis: [testImei(1)] }], allowPartial: true })
          .expect(200);
        return [testImei(1)];
      })();

      const res = await as(app, admin)
        .post('/api/v1/pos/sales')
        .send({
          warehouseId: fixture.central.id,
          lines: [{ imei: imeis[0] }],
          items: [{ productId: fixture.accessory.id, quantity: 2 }],
        })
        .expect(201);

      // One phone at 980.00 plus two cables at 9.00.
      expect(res.body.total).toBe('998.00');
      expect((await levelAt(fixture.central.id))?.quantity).toBe(98);
    });

    it('refuses to sell more than is on the shelf, and changes nothing', async () => {
      const res = await sellAtTill(101).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect((await levelAt(fixture.central.id))?.quantity).toBe(100);
      expect(await prisma.sale.count()).toBe(0);
    });

    it('never lets concurrent tills drive the quantity below zero', async () => {
      // Six simultaneous sales of 20 against 100 on the shelf: five can
      // succeed, the sixth must not.
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => sellAtTill(20)));
      const accepted = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as { status: number }).status === 201,
      ).length;

      expect(accepted).toBe(5);
      expect((await levelAt(fixture.central.id))?.quantity).toBe(0);
    });
  });

  describe('transferring', () => {
    beforeEach(async () => {
      await receiveAccessories(await orderAccessories(100, '2.00'), 100).expect(200);
    });

    it('moves a quantity between warehouses, holding it in transit', async () => {
      const created = await as(app, admin)
        .post('/api/v1/transfers')
        .send({
          sourceWarehouseId: fixture.central.id,
          destinationWarehouseId: fixture.france.id,
          items: [{ productId: fixture.accessory.id, quantity: 30 }],
        })
        .expect(201);
      const transferId = created.body.id as string;

      await as(app, admin).post(`/api/v1/transfers/${transferId}/ship`).send({}).expect(200);

      // Gone from the source, not yet anywhere else.
      expect((await levelAt(fixture.central.id))?.quantity).toBe(70);
      expect(await levelAt(fixture.france.id)).toBeNull();

      await as(app, admin).post(`/api/v1/transfers/${transferId}/receive`).send({}).expect(200);

      const destination = await levelAt(fixture.france.id);
      expect(destination?.quantity).toBe(30);
      // It arrives at the cost it left at, not re-priced by the journey.
      expect(destination?.avgUnitCost.toFixed(2)).toBe('2.00');
    });

    it('creates an accessory-only transfer with auto-fill on', async () => {
      // The transfer form sends autoFill by default, but auto-fill only picks
      // phones — nothing to load on a bulk line used to fail the create with
      // "no available stock" even though the shelf was full.
      const created = await as(app, admin)
        .post('/api/v1/transfers')
        .send({
          sourceWarehouseId: fixture.central.id,
          destinationWarehouseId: fixture.france.id,
          items: [{ productId: fixture.accessory.id, quantity: 30 }],
          autoFill: true,
        })
        .expect(201);

      expect(created.body.id).toBeDefined();
      expect(created.body.loadedQuantity).toBe(0);
      expect(created.body.plannedQuantity).toBe(30);
    });
  });

  describe('stock takes', () => {
    beforeEach(async () => {
      await receiveAccessories(await orderAccessories(50, '2.00'), 50).expect(200);
    });

    it('corrects the figure to what was counted and records the reason', async () => {
      const res = await as(app, admin)
        .post('/api/v1/stock/adjust')
        .send({
          productId: fixture.accessory.id,
          warehouseId: fixture.central.id,
          countedQuantity: 43,
          reason: 'Annual count — seven unaccounted for',
        })
        .expect(201);

      expect(res.body).toMatchObject({ before: 50, after: 43, delta: -7 });
      expect((await levelAt(fixture.central.id))?.quantity).toBe(43);

      const ledger = await prisma.stockMovement.findFirst({
        where: { type: 'ADJUSTMENT', productId: fixture.accessory.id },
      });
      expect(ledger?.quantity).toBe(-7);
      expect(ledger?.notes).toContain('Annual count');
    });

    it('refuses to adjust a phone, which has IMEIs to account for instead', async () => {
      const res = await as(app, admin)
        .post('/api/v1/stock/adjust')
        .send({
          productId: fixture.product.id,
          warehouseId: fixture.central.id,
          countedQuantity: 5,
          reason: 'Count',
        })
        .expect(400);
      expect(res.body.code).toBe('TRACKING_MODE_MISMATCH');
    });
  });

  describe('changing how a product is tracked', () => {
    it('is allowed while the product has never held stock', async () => {
      await as(app, admin)
        .patch(`/api/v1/products/${fixture.accessory.id}`)
        .send({ tracking: TrackingMode.SERIALIZED })
        .expect(200);
    });

    it('lets an accessory holding stock be edited without touching how it is counted', async () => {
      // The update DTO extends the create DTO, and a property default is
      // inherited: an omitted `tracking` used to arrive as SERIALIZED, so every
      // edit of a stocked accessory read as a request to change it and failed.
      await receiveAccessories(await orderAccessories(10, '2.00'), 10).expect(200);

      const res = await as(app, admin)
        .patch(`/api/v1/products/${fixture.accessory.id}`)
        .send({ defaultSalePrice: '12.50' })
        .expect(200);

      // Products are returned as Prisma rows, so decimals arrive unpadded.
      expect(Number(res.body.defaultSalePrice)).toBe(12.5);
      expect(res.body.tracking).toBe(TrackingMode.BULK);
    });

    it('leaves the currency alone when an edit does not mention it', async () => {
      // Same inheritance trap: an omitted currency arrived as EUR and silently
      // re-denominated a product priced in dinars.
      await as(app, admin)
        .patch(`/api/v1/products/${fixture.accessory.id}`)
        .send({ currency: 'DZD' })
        .expect(200);

      const res = await as(app, admin)
        .patch(`/api/v1/products/${fixture.accessory.id}`)
        .send({ defaultSalePrice: '900.00' })
        .expect(200);

      expect(res.body.currency).toBe('DZD');
    });

    it('is refused once stock exists, because it would orphan it', async () => {
      await receiveAccessories(await orderAccessories(10, '2.00'), 10).expect(200);

      const res = await as(app, admin)
        .patch(`/api/v1/products/${fixture.accessory.id}`)
        .send({ tracking: TrackingMode.SERIALIZED })
        .expect(409);
      expect(res.body.code).toBe('TRACKING_MODE_MISMATCH');
    });
  });

  describe('filtering inventory', () => {
    it('scopes to one warehouse and one product at once', async () => {
      // A plain warehouse id used to be spread into the device filter as an
      // object, producing `{ 0: '9', 1: 'b', … }` and a 500.
      await receiveAccessories(await orderAccessories(60, '2.00'), 60).expect(200);

      const res = await as(app, admin)
        .get(`/api/v1/inventory?warehouseId=${fixture.central.id}&productId=${fixture.accessory.id}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ inStock: 60, tracking: 'BULK' });
    });

    it('scopes to one warehouse for a phone line too', async () => {
      await as(app, admin)
        .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
        .send({ lines: [{ purchaseItemId: fixture.purchase.itemId, imeis: [testImei(1)] }], allowPartial: true })
        .expect(200);

      const res = await as(app, admin)
        .get(`/api/v1/inventory?warehouseId=${fixture.central.id}&productId=${fixture.product.id}`)
        .expect(200);

      expect(res.body.data[0]).toMatchObject({ productId: fixture.product.id, tracking: 'SERIALIZED' });
    });
  });

  describe('reporting', () => {
    it('counts accessory value in the stock figure and shows it in inventory', async () => {
      await receiveAccessories(await orderAccessories(100, '2.00'), 100).expect(200);

      const dashboard = await as(app, admin).get('/api/v1/reports/dashboard').expect(200);
      expect(dashboard.body.stockValue).toBe('200.00');

      const inventory = await as(app, admin).get('/api/v1/inventory').expect(200);
      const row = inventory.body.data.find(
        (r: { productId: string }) => r.productId === fixture.accessory.id,
      );
      expect(row).toMatchObject({ inStock: 100, tracking: 'BULK' });
    });

    it('counts on-hand accessories as available on the dashboard', async () => {
      await receiveAccessories(await orderAccessories(40, '2.00'), 40).expect(200);

      const dashboard = await as(app, admin).get('/api/v1/reports/dashboard').expect(200);
      // Accessories live on the level table, so "ready to sell" never saw them.
      expect(dashboard.body.totals.available).toBe(40);

      const central = dashboard.body.byWarehouse.find(
        (w: { warehouseCode: string }) => w.warehouseCode === 'CENTRAL',
      );
      expect(central).toBeDefined();
      expect(central.available).toBe(40);
    });
  });
});
