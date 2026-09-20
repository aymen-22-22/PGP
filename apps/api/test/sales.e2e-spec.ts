import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, receiveDevices, seedFixture, testImei } from './helpers';

describe('Sales, concurrency and profit (spec §16, §19, §28)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let jean: string;
  let imeis: string[];

  const createSale = (quantity: number, unitPrice = '980.00') =>
    as(app, admin)
      .post('/api/v1/sales')
      .send({
        customerId: fixture.customer.id,
        warehouseId: fixture.central.id,
        items: [{ productId: fixture.product.id, quantity, unitPrice }],
      });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    jean = await login(app, fixture.jean.email);
    imeis = await receiveDevices(app, admin, fixture, 10);
  });
  afterAll(async () => {
    await app.close();
  });

  it('marks the exact scanned devices as sold', async () => {
    const sale = await createSale(3).expect(201);
    const res = await as(app, admin)
      .post(`/api/v1/sales/${sale.body.id}/complete`)
      .send({ imeis: imeis.slice(0, 3) })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'COMPLETED', devicesSold: 3, revenue: '2940.00', cost: '2700.00' });

    const sold = await prisma.device.findMany({ where: { imei: { in: imeis.slice(0, 3) } } });
    expect(sold.every((d) => d.status === 'SOLD')).toBe(true);
    expect(sold.every((d) => d.saleId === sale.body.id)).toBe(true);
    expect(sold.every((d) => d.soldAt !== null)).toBe(true);
  });

  it('cannot sell an IMEI that does not exist', async () => {
    const sale = await createSale(1).expect(201);
    const res = await as(app, admin)
      .post(`/api/v1/sales/${sale.body.id}/complete`)
      .send({ imeis: [testImei(9999)] })
      .expect(404);
    expect(res.body.code).toBe('IMEI_NOT_FOUND');
  });

  it('cannot sell an IMEI held by another warehouse', async () => {
    const transfer = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 2 }],
        autoFill: true,
      })
      .expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);
    const detail = await as(app, jean).get(`/api/v1/transfers/${transfer.body.id}`).expect(200);
    const moved = detail.body.devices.map((d: { imei: string }) => d.imei);
    await as(app, jean).post(`/api/v1/transfers/${transfer.body.id}/receive`).send({ imeis: moved }).expect(200);

    const sale = await createSale(1).expect(201);
    const res = await as(app, admin)
      .post(`/api/v1/sales/${sale.body.id}/complete`)
      .send({ imeis: [moved[0]] })
      .expect(400);
    expect(res.body.code).toBe('IMEI_WRONG_WAREHOUSE');
  });

  it('cannot sell an IMEI that is already sold', async () => {
    const first = await createSale(1).expect(201);
    await as(app, admin)
      .post(`/api/v1/sales/${first.body.id}/complete`)
      .send({ imeis: [imeis[0]] })
      .expect(200);

    const second = await createSale(1).expect(201);
    const res = await as(app, admin)
      .post(`/api/v1/sales/${second.body.id}/complete`)
      .send({ imeis: [imeis[0]] })
      .expect(409);
    expect(res.body.code).toBe('IMEI_ALREADY_SOLD');
  });

  it('cannot complete the same sale twice', async () => {
    const sale = await createSale(2).expect(201);
    await as(app, admin)
      .post(`/api/v1/sales/${sale.body.id}/complete`)
      .send({ imeis: imeis.slice(0, 2) })
      .expect(200);
    const res = await as(app, admin)
      .post(`/api/v1/sales/${sale.body.id}/complete`)
      .send({ imeis: imeis.slice(2, 4) })
      .expect(400);
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('requires the scanned count to match the order', async () => {
    const sale = await createSale(3).expect(201);
    const res = await as(app, admin)
      .post(`/api/v1/sales/${sale.body.id}/complete`)
      .send({ imeis: imeis.slice(0, 2) })
      .expect(400);
    expect(res.body.code).toBe('QUANTITY_EXCEEDED');
  });

  it('refuses to order more units than the warehouse holds', async () => {
    const res = await createSale(50).expect(400);
    expect(res.body.code).toBe('QUANTITY_EXCEEDED');
  });

  /**
   * Spec §28: two users must never be able to sell the same phone. The two
   * requests are fired without awaiting in between so they overlap in the
   * database; exactly one must win.
   */
  it('lets only one of two simultaneous sales claim the same IMEI', async () => {
    const saleA = await createSale(1).expect(201);
    const saleB = await createSale(1).expect(201);
    const target = [imeis[0]];

    const complete = (id: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/sales/${id}/complete`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ imeis: target });

    const [a, b] = await Promise.all([complete(saleA.body.id), complete(saleB.body.id)]);
    const statuses = [a.status, b.status].sort();

    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);

    const loser = a.status === 200 ? b : a;
    expect(['IMEI_NOT_AVAILABLE', 'IMEI_ALREADY_SOLD', 'CONCURRENT_MODIFICATION']).toContain(loser.body.code);

    // Exactly one sale owns the device, and it was only sold once.
    const device = await prisma.device.findUnique({ where: { imei: imeis[0] } });
    expect(device?.status).toBe('SOLD');
    const saleMovements = await prisma.deviceMovement.findMany({
      where: { deviceId: device!.id, type: 'SALE' },
    });
    expect(saleMovements).toHaveLength(1);
    const completed = await prisma.sale.count({ where: { status: 'COMPLETED' } });
    expect(completed).toBe(1);
  });

  it('computes revenue, cost, profit and margin exactly as the specification does', async () => {
    // 10 phones bought at 900 and sold at 980.
    const sale = await createSale(10).expect(201);
    await as(app, admin).post(`/api/v1/sales/${sale.body.id}/complete`).send({ imeis }).expect(200);

    const dash = await as(app, admin).get('/api/v1/reports/dashboard').expect(200);
    expect(dash.body.financials).toMatchObject({
      revenue: '9800.00',
      purchaseCost: '9000.00',
      profit: '800.00',
      margin: '8.16',
    });
    expect(dash.body.totals.sold).toBe(10);
    expect(dash.body.totals.available).toBe(0);
  });

  it('cancels a sale that has not been completed, but not one that has', async () => {
    const open = await createSale(1).expect(201);
    await as(app, admin).post(`/api/v1/sales/${open.body.id}/cancel`).expect(200);

    const done = await createSale(1).expect(201);
    await as(app, admin).post(`/api/v1/sales/${done.body.id}/complete`).send({ imeis: [imeis[1]] }).expect(200);
    const res = await as(app, admin).post(`/api/v1/sales/${done.body.id}/cancel`).expect(400);
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('brings a returned phone back into stock', async () => {
    const sale = await createSale(1).expect(201);
    await as(app, admin).post(`/api/v1/sales/${sale.body.id}/complete`).send({ imeis: [imeis[0]] }).expect(200);

    await as(app, admin)
      .post('/api/v1/returns')
      .send({
        customerId: fixture.customer.id,
        warehouseId: fixture.central.id,
        reason: 'Customer changed their mind',
        lines: [{ imei: imeis[0], outcome: 'RESTOCKED' }],
      })
      .expect(201);

    const device = await prisma.device.findUnique({ where: { imei: imeis[0] } });
    expect(device?.status).toBe('IN_STOCK');
    expect(device?.saleId).toBeNull();

    const movements = await prisma.deviceMovement.findMany({
      where: { deviceId: device!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(movements.map((m) => m.type)).toEqual(['PURCHASE_RECEIPT', 'SALE', 'RETURN']);
  });
});
