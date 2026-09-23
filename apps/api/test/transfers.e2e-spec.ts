import { INestApplication } from '@nestjs/common';
import { PurchaseStatus } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, receiveDevices, seedFixture, testImei } from './helpers';

describe('Transfers and shipments (spec §12–§14)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let jean: string;
  let carlos: string;
  let imeis: string[];

  const createTransfer = (quantity = 5, destination?: string) =>
    as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: destination ?? fixture.france.id,
        items: [{ productId: fixture.product.id, quantity }],
        autoFill: true,
      });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    jean = await login(app, fixture.jean.email);
    carlos = await login(app, fixture.carlos.email);
    imeis = await receiveDevices(app, admin, fixture, 10);
  });
  afterAll(async () => {
    await app.close();
  });

  it('moves specific devices, not a bare quantity', async () => {
    const res = await createTransfer(5).expect(201);
    expect(res.body.loadedQuantity).toBe(5);
    expect(res.body.devices).toHaveLength(5);
    expect(res.body.devices.every((d: { imei: string }) => imeis.includes(d.imei))).toBe(true);
    expect(res.body.shipment.status).toBe('PREPARING');
  });

  it('refuses a transfer to the same warehouse', async () => {
    await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.central.id,
        items: [{ productId: fixture.product.id, quantity: 1 }],
      })
      .expect(400);
  });

  it('refuses to load a device from a different warehouse', async () => {
    const transfer = await createTransfer(2).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);
    const detail = await as(app, jean).get(`/api/v1/transfers/${transfer.body.id}`).expect(200);
    await as(app, jean)
      .post(`/api/v1/transfers/${transfer.body.id}/receive`)
      .send({ imeis: detail.body.devices.map((d: { imei: string }) => d.imei) })
      .expect(200);

    // Those devices now live in France, so a second Central transfer cannot take them.
    const second = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.spain.id,
        items: [{ productId: fixture.product.id, quantity: 1 }],
      })
      .expect(201);
    const res = await as(app, admin)
      .post(`/api/v1/transfers/${second.body.id}/load`)
      .send({ imeis: [detail.body.devices[0].imei] })
      .expect(400);
    expect(res.body.code).toBe('IMEI_WRONG_WAREHOUSE');
  });

  it('refuses to load more devices than planned', async () => {
    const transfer = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 2 }],
      })
      .expect(201);

    const res = await as(app, admin)
      .post(`/api/v1/transfers/${transfer.body.id}/load`)
      .send({ imeis: imeis.slice(0, 3) })
      .expect(400);
    expect(res.body.code).toBe('QUANTITY_EXCEEDED');
  });

  it('only lets the source warehouse ship', async () => {
    const transfer = await createTransfer(3).expect(201);
    const res = await as(app, jean).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(403);
    expect(res.body.code).toBe('WAREHOUSE_FORBIDDEN');
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);
  });

  it('puts shipped devices in transit without moving their location yet', async () => {
    const transfer = await createTransfer(3).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);

    const devices = await prisma.device.findMany({ where: { transferId: transfer.body.id } });
    expect(devices).toHaveLength(3);
    expect(devices.every((d) => d.status === 'IN_TRANSFER')).toBe(true);
    // Still located at the source: nothing is in two places at once.
    expect(devices.every((d) => d.currentWarehouseId === fixture.central.id)).toBe(true);
  });

  it('lists what was sent today on the Send page', async () => {
    const transfer = await createTransfer(3).expect(201);
    const before = await as(app, admin).get('/api/v1/transfers/sent-today').expect(200);
    expect(before.body.transfers.some((t: { id: string }) => t.id === transfer.body.id)).toBe(false);

    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);
    const after = await as(app, admin).get('/api/v1/transfers/sent-today').expect(200);
    const row = after.body.transfers.find((t: { id: string }) => t.id === transfer.body.id);
    expect(row).toMatchObject({ quantity: 3 });
    expect(after.body.total).toBe(before.body.total + 3);
  });

  it('only lets the destination warehouse receive', async () => {
    const transfer = await createTransfer(3).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);
    const detail = await as(app, jean).get(`/api/v1/transfers/${transfer.body.id}`).expect(200);
    const shipped = detail.body.devices.map((d: { imei: string }) => d.imei);

    const res = await as(app, carlos)
      .post(`/api/v1/transfers/${transfer.body.id}/receive`)
      .send({ imeis: shipped })
      .expect(403);
    expect(res.body.code).toBe('WAREHOUSE_FORBIDDEN');

    await as(app, jean)
      .post(`/api/v1/transfers/${transfer.body.id}/receive`)
      .send({ imeis: shipped })
      .expect(200);
  });

  it('records who received each device and when', async () => {
    const transfer = await createTransfer(3).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);
    const detail = await as(app, jean).get(`/api/v1/transfers/${transfer.body.id}`).expect(200);
    const shipped = detail.body.devices.map((d: { imei: string }) => d.imei);

    const res = await as(app, jean)
      .post(`/api/v1/transfers/${transfer.body.id}/receive`)
      .send({ imeis: shipped })
      .expect(200);

    expect(res.body).toMatchObject({ expected: 3, scanned: 3, missing: 0, status: 'RECEIVED', receivedBy: 'Jean' });

    const devices = await prisma.device.findMany({ where: { imei: { in: shipped } } });
    expect(devices.every((d) => d.status === 'IN_STOCK')).toBe(true);
    expect(devices.every((d) => d.currentWarehouseId === fixture.france.id)).toBe(true);
    expect(devices.every((d) => d.transferId === null)).toBe(true);

    const shipment = await prisma.shipment.findUnique({ where: { transferId: transfer.body.id } });
    expect(shipment?.status).toBe('RECEIVED');
    expect(shipment?.receivedById).toBe(fixture.jean.id);

    const inbound = await prisma.deviceMovement.findMany({ where: { type: 'TRANSFER_IN' } });
    expect(inbound).toHaveLength(3);
    expect(inbound.every((m) => m.performedById === fixture.jean.id)).toBe(true);
  });

  it('cannot receive the same transfer twice', async () => {
    const transfer = await createTransfer(3).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);
    const detail = await as(app, jean).get(`/api/v1/transfers/${transfer.body.id}`).expect(200);
    const shipped = detail.body.devices.map((d: { imei: string }) => d.imei);

    await as(app, jean).post(`/api/v1/transfers/${transfer.body.id}/receive`).send({ imeis: shipped }).expect(200);
    const res = await as(app, jean)
      .post(`/api/v1/transfers/${transfer.body.id}/receive`)
      .send({ imeis: shipped })
      .expect(400);
    expect(res.body.code).toBe('ALREADY_RECEIVED');
  });

  it('refuses an IMEI that is not on the shipment', async () => {
    const transfer = await createTransfer(3).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);

    const res = await as(app, jean)
      .post(`/api/v1/transfers/${transfer.body.id}/receive`)
      .send({ imeis: [testImei(999)] })
      .expect(400);
    expect(res.body.code).toBe('IMEI_NOT_IN_TRANSFER');
  });

  it('reports what is missing rather than closing a short shipment silently', async () => {
    const transfer = await createTransfer(5).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);
    const detail = await as(app, jean).get(`/api/v1/transfers/${transfer.body.id}`).expect(200);
    const shipped = detail.body.devices.map((d: { imei: string }) => d.imei);

    const short = await as(app, jean)
      .post(`/api/v1/transfers/${transfer.body.id}/receive`)
      .send({ imeis: shipped.slice(0, 3) })
      .expect(400);
    expect(short.body.code).toBe('PARTIAL_RECEIPT_NOT_ALLOWED');
    expect(short.body.details).toMatchObject({ expected: 5, scanned: 3, missing: 2 });

    const partial = await as(app, jean)
      .post(`/api/v1/transfers/${transfer.body.id}/receive`)
      .send({ imeis: shipped.slice(0, 3), allowPartial: true })
      .expect(200);
    // Two phones are still unaccounted for, so the transfer stays open.
    expect(partial.body).toMatchObject({ scanned: 3, missing: 2, status: 'IN_TRANSIT' });
  });

  it('cannot ship a transfer that has already been shipped', async () => {
    const transfer = await createTransfer(3).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);
    const res = await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(400);
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('shows the destination its incoming shipments and nothing else', async () => {
    const toFrance = await createTransfer(3, fixture.france.id).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${toFrance.body.id}/ship`).expect(200);
    const toSpain = await createTransfer(3, fixture.spain.id).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${toSpain.body.id}/ship`).expect(200);

    const jeanSees = await as(app, jean).get('/api/v1/transfers?incoming=true').expect(200);
    expect(jeanSees.body.data).toHaveLength(1);
    expect(jeanSees.body.data[0].number).toBe(toFrance.body.number);

    const carlosSees = await as(app, carlos).get('/api/v1/transfers?incoming=true').expect(200);
    expect(carlosSees.body.data).toHaveLength(1);
    expect(carlosSees.body.data[0].number).toBe(toSpain.body.number);
  });
});

describe('Devices cannot be promised twice (regression)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let imeis: string[];

  const newTransfer = (destination: string, quantity: number) =>
    as(app, admin).post('/api/v1/transfers').send({
      sourceWarehouseId: fixture.central.id,
      destinationWarehouseId: destination,
      items: [{ productId: fixture.product.id, quantity }],
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    imeis = await receiveDevices(app, admin, fixture, 10);
  });
  afterAll(async () => {
    await app.close();
  });

  /**
   * A device is only stamped with Device.transferId at dispatch, so between
   * loading and shipping the only record of the claim is its TransferDevice
   * row. Everything that picks stock has to consult it.
   */
  it('refuses to load a device already loaded on another open transfer', async () => {
    const first = await newTransfer(fixture.france.id, 2).expect(201);
    await as(app, admin)
      .post(`/api/v1/transfers/${first.body.id}/load`)
      .send({ imeis: imeis.slice(0, 2) })
      .expect(200);

    const second = await newTransfer(fixture.spain.id, 2).expect(201);
    const res = await as(app, admin)
      .post(`/api/v1/transfers/${second.body.id}/load`)
      .send({ imeis: imeis.slice(0, 2) })
      .expect(400);

    expect(res.body.code).toBe('IMEI_NOT_AVAILABLE');
    expect(res.body.message).toContain('another transfer');
    expect(res.body.details.imeis[0].transfer).toBe(first.body.number);
  });

  it('tops a part-loaded transfer up to plan instead of re-picking what it holds', async () => {
    const transfer = await newTransfer(fixture.france.id, 5).expect(201);
    await as(app, admin)
      .post(`/api/v1/transfers/${transfer.body.id}/load`)
      .send({ imeis: imeis.slice(0, 3) })
      .expect(200);

    const filled = await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/auto-fill`).expect(200);
    expect(filled.body.added).toBe(2);

    const after = await as(app, admin).get(`/api/v1/transfers/${transfer.body.id}`).expect(200);
    expect(after.body.loadedQuantity).toBe(5);
  });

  it('never auto-fills a device another open transfer already holds', async () => {
    const first = await newTransfer(fixture.france.id, 4).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${first.body.id}/auto-fill`).expect(200);
    const firstImeis: string[] = (await as(app, admin).get(`/api/v1/transfers/${first.body.id}`).expect(200)).body
      .devices.map((d: { imei: string }) => d.imei);

    const second = await newTransfer(fixture.spain.id, 4).expect(201);
    await as(app, admin).post(`/api/v1/transfers/${second.body.id}/auto-fill`).expect(200);
    const secondImeis: string[] = (await as(app, admin).get(`/api/v1/transfers/${second.body.id}`).expect(200))
      .body.devices.map((d: { imei: string }) => d.imei);

    expect(firstImeis).toHaveLength(4);
    expect(secondImeis).toHaveLength(4);
    expect(secondImeis.filter((i) => firstImeis.includes(i))).toHaveLength(0);
  });

  it('refuses to sell a phone that is packed on an open transfer', async () => {
    const transfer = await newTransfer(fixture.france.id, 2).expect(201);
    await as(app, admin)
      .post(`/api/v1/transfers/${transfer.body.id}/load`)
      .send({ imeis: imeis.slice(0, 2) })
      .expect(200);

    const sale = await as(app, admin)
      .post('/api/v1/sales')
      .send({
        customerId: fixture.customer.id,
        warehouseId: fixture.central.id,
        items: [{ productId: fixture.product.id, quantity: 2 }],
      })
      .expect(201);

    const res = await as(app, admin)
      .post(`/api/v1/sales/${sale.body.id}/complete`)
      .send({ imeis: imeis.slice(0, 2) })
      .expect(400);
    expect(res.body.code).toBe('IMEI_NOT_AVAILABLE');
    expect(res.body.message).toContain('transfer');
  });

  it('never auto-picks a phone that is packed on an open transfer', async () => {
    const transfer = await newTransfer(fixture.france.id, 2).expect(201);
    await as(app, admin)
      .post(`/api/v1/transfers/${transfer.body.id}/load`)
      .send({ imeis: imeis.slice(0, 2) })
      .expect(200);

    const sale = await as(app, admin)
      .post('/api/v1/sales')
      .send({
        customerId: fixture.customer.id,
        warehouseId: fixture.central.id,
        items: [{ productId: fixture.product.id, quantity: 3 }],
      })
      .expect(201);
    await as(app, admin).post(`/api/v1/sales/${sale.body.id}/complete`).send({ autoPick: true }).expect(200);

    const picked = (await as(app, admin).get(`/api/v1/sales/${sale.body.id}`).expect(200)).body.devices.map(
      (d: { imei: string }) => d.imei,
    );
    expect(picked.filter((i: string) => imeis.slice(0, 2).includes(i))).toHaveLength(0);

    // …and the transfer can still be dispatched.
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);
  });
});

describe('Transfer cancellation race and large transfers (regression)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;

  beforeEach(async () => {
    ({ app, prisma } = await createTestApp());
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
  });
  afterEach(async () => {
    await app.close();
  });

  /**
   * The ship claim is status-guarded, so a cancel that read "still editable"
   * before the ship landed must not then delete the rows the ship just moved —
   * cancel claims the transfer the same way and one of the two is rolled back.
   * Either way the database is consistent and the loser gets a 4xx.
   */
  it('lets only one of a simultaneous ship and cancel keep the transfer', async () => {
    await receiveDevices(app, admin, fixture, 3);
    const transfer = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 3 }],
        autoFill: true,
      })
      .expect(201);
    const id = transfer.body.id;

    const ship = () =>
      request(app.getHttpServer())
        .post(`/api/v1/transfers/${id}/ship`)
        .set('Authorization', `Bearer ${admin}`)
        .send({});
    const cancel = () =>
      request(app.getHttpServer())
        .post(`/api/v1/transfers/${id}/cancel`)
        .set('Authorization', `Bearer ${admin}`)
        .send({});

    const [a, b] = await Promise.all([ship(), cancel()]);
    const winners = [a, b].filter((r) => r.status < 400);
    expect(winners).toHaveLength(1);
    expect([a, b].filter((r) => r.status >= 400)).toHaveLength(1);

    const after = await prisma.transfer.findUnique({
      where: { id },
      include: { _count: { select: { devices: true } } },
    });
    if (after?.status === 'IN_TRANSIT') {
      expect(after._count.devices).toBe(3);
      const devices = await prisma.device.findMany({ where: { transferId: id } });
      expect(devices).toHaveLength(3);
      expect(devices.every((d) => d.status === 'IN_TRANSFER')).toBe(true);
    } else {
      expect(after?.status).toBe('CANCELLED');
      expect(after?._count.devices).toBe(0);
    }
  });

  /**
   * The detail payload is capped at 2000 devices for response size, but
   * loaded/received quantities are the pick-list headline and must report the
   * truth for a transfer of any size, not the length of the truncated slice.
   */
  it('reports true loaded and received counts past the 2000-device payload cap', async () => {
    const big = await prisma.purchase.create({
      data: {
        number: 'PO-BIG-000001',
        supplierId: fixture.supplier.id,
        warehouseId: fixture.central.id,
        purchaseDate: new Date(),
        status: PurchaseStatus.ORDERED,
        totalAmount: '2160000.00',
        createdById: fixture.admin.id,
        items: {
          create: [
            { productId: fixture.product.id, quantity: 2400, unitPrice: '900.00', totalPrice: '2160000.00' },
          ],
        },
      },
      include: { items: true },
    });

    // Indices 11..2011 stay clear of the ten fixture IMEIs (1..10).
    const imeis = Array.from({ length: 2001 }, (_, i) => testImei(11 + i));
    await as(app, admin)
      .post(`/api/v1/purchases/${big.id}/receive`)
      .send({ lines: [{ purchaseItemId: big.items[0].id, imeis }], allowPartial: true })
      .expect(200);

    const transfer = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 2001 }],
        autoFill: true,
      })
      .expect(201);
    expect(transfer.body.loadedQuantity).toBe(2001);

    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);

    const loaded = await as(app, admin).get(`/api/v1/transfers/${transfer.body.id}`).expect(200);
    // The pick-list payload is still capped…
    expect(loaded.body.devices).toHaveLength(2000);
    // …but the headline quantities tell the truth for a transfer of any size.
    expect(loaded.body.loadedQuantity).toBe(2001);
    expect(loaded.body.receivedQuantity).toBe(0);

    const scanned = loaded.body.devices.slice(0, 3).map((d: { imei: string }) => d.imei);
    await as(app, admin)
      .post(`/api/v1/transfers/${transfer.body.id}/receive`)
      .send({ imeis: scanned, allowPartial: true })
      .expect(200);

    const received = await as(app, admin).get(`/api/v1/transfers/${transfer.body.id}`).expect(200);
    expect(received.body.receivedQuantity).toBe(3);
    expect(received.body.loadedQuantity).toBe(2001);
  });
});
