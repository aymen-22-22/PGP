import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture, testImei } from './helpers';

describe('Serial-only receiving, identification and barcode resolution', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;

  const receive = (body: Record<string, unknown>, allowPartial = true) =>
    as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
      .send({
        lines: [{ purchaseItemId: fixture.purchase.itemId, ...body }],
        allowPartial,
      });

  const verify = (payload: Record<string, unknown>) =>
    as(app, admin).post('/api/v1/imeis/verify').send(payload).expect(200);

  const identify = (deviceId: string, imei: string, imei2?: string) =>
    as(app, admin).patch(`/api/v1/imeis/${deviceId}/identify`).send({ imei, ...(imei2 ? { imei2 } : {}) });

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

  it('accepts an unknown serial when receiving stock, as a unit awaiting its IMEI', async () => {
    const res = await receive({ serials: ['2UKBB25506101197', 'SN-X7R2-441'] });
    expect(res.body).toMatchObject({ scanned: 2 });

    const pending = await prisma.device.findMany({ where: { status: 'PENDING_IDENTIFICATION' } });
    expect(pending).toHaveLength(2);
    expect(pending.every((d) => d.imei === null)).toBe(true);
    expect(pending.map((d) => d.serialNumber).sort()).toEqual(['2UKBB25506101197', 'X7R2441']);
    expect(pending.every((d) => d.currentWarehouseId === fixture.central.id)).toBe(true);
    expect(pending.every((d) => d.purchaseCost?.toFixed(2) === '900.00')).toBe(true);
  });

  it('counts serials and IMEIs together toward the ordered quantity', async () => {
    const res = await receive({ imeis: [testImei(1), testImei(2)], serials: ['2UKBB25506101197', 'SN-X7R2-441'] });
    expect(res.body).toMatchObject({ scanned: 4 });
    expect(await prisma.device.count({ where: { status: 'IN_STOCK' } })).toBe(2);
    expect(await prisma.device.count({ where: { status: 'PENDING_IDENTIFICATION' } })).toBe(2);
    // Accessories aside, stock count for the warehouse reflects sellable units only.
    const summary = await as(app, admin).get('/api/v1/inventory').expect(200);
    const row = summary.body.data.find((r: { warehouseId: string }) => r.warehouseId === fixture.central.id);
    expect(row.inStock).toBe(2);
    expect(row.pendingIdentification).toBe(2);
  });

  it('refuses to file an IMEI or a product barcode as a serial', async () => {
    const asImei = await receive({ serials: [testImei(1)] }).expect(400);
    expect(asImei.body.code).toBe('VALIDATION_FAILED');

    const asEan = await receive({ serials: ['4234567890128'] }).expect(400);
    expect(asEan.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a duplicate serial in one scan batch', async () => {
    const res = await receive({ serials: ['2UKBB25506101197', '2ukbb25506101197'] }).expect(400);
    expect(res.body.code).toBe('SERIAL_DUPLICATE_IN_REQUEST');
  });

  it('rejects a serial the system already knows', async () => {
    await receive({ serials: ['2UKBB25506101197'] });
    const res = await receive({ serials: ['2UKBB25506101197', 'SN-X7R2-441'] }).expect(409);
    expect(res.body.code).toBe('IMEI_ALREADY_EXISTS');
    expect(await prisma.device.count({ where: { status: 'PENDING_IDENTIFICATION' } })).toBe(1);
  });

  it('identify attaches the IMEI and makes the unit sellable', async () => {
    await receive({ serials: ['2UKBB25506101197'] });
    const pending = await prisma.device.findFirstOrThrow({ where: { serialNumber: '2UKBB25506101197' } });

    const imei = testImei(42);
    const res = await identify(pending.id, imei).expect(200);
    expect(res.body).toMatchObject({ status: 'IN_STOCK', imei, serialNumber: '2UKBB25506101197' });

    const device = await prisma.device.findUniqueOrThrow({ where: { id: pending.id } });
    expect(device.imei).toBe(imei);
    expect(device.status).toBe('IN_STOCK');
    expect(await prisma.deviceMovement.count({ where: { deviceId: pending.id, type: 'IDENTIFIED' } })).toBe(1);

    // The identified unit is reachable through the scan resolver.
    const bySerial = await verify({ payload: '2UKBB25506101197' });
    expect(bySerial.body).toMatchObject({ kind: 'SERIAL', accepted: true });
    expect(bySerial.body.device.id).toBe(pending.id);

    // A sale on it completes, which turns it SOLD.
    const sale = await as(app, admin)
      .post('/api/v1/sales')
      .send({
        customerId: fixture.customer.id,
        warehouseId: fixture.central.id,
        items: [{ productId: fixture.product.id, quantity: 1, unitPrice: '980.00' }],
      })
      .expect(201);
    await as(app, admin)
      .post(`/api/v1/sales/${sale.body.id}/complete`)
      .send({ imeis: [imei] })
      .expect(200);
    expect((await prisma.device.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('SOLD');
  });

  it('refuses to identify with an IMEI another phone already uses', async () => {
    await receive({ serials: ['2UKBB25506101197'] });
    const other = await prisma.device.findFirstOrThrow({ where: { serialNumber: '2UKBB25506101197' } });

    await receive({ imeis: [testImei(7)] });
    const res = await identify(other.id, testImei(7)).expect(409);
    expect(res.body.code).toBe('IMEI_ALREADY_EXISTS');
  });

  it('refuses to identify a unit that is not awaiting its IMEI', async () => {
    await receive({ imeis: [testImei(7)] });
    const device = await prisma.device.findFirstOrThrow({ where: { imei: testImei(7) } });
    const res = await identify(device.id, testImei(8)).expect(400);
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('a pending unit cannot be loaded onto a transfer before identification', async () => {
    // The phone is on the books but has no IMEI yet.
    await receive({ serials: ['2UKBB25506101197'] });

    // autoFill only ever picks IN_STOCK devices, so with nothing identified the
    // transfer cannot start — the pending unit stays put.
    const res = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 1 }],
        autoFill: true,
      })
      .expect(400);
    expect(res.body.code).toBe('IMEI_NOT_AVAILABLE');
  });

  describe('the scan resolver (POST /imeis/verify)', () => {
    it('offers an unknown IMEI as new while receiving, refuses it otherwise', async () => {
      const inReceiving = await verify({ payload: testImei(99), receiving: true });
      expect(inReceiving.body).toMatchObject({ kind: 'IMEI', accepted: true, code: 'IMEI_NEW_ACCEPTED' });

      const out = await verify({ payload: testImei(99) });
      expect(out.body).toMatchObject({ kind: 'IMEI', accepted: false, code: 'IMEI_NOT_FOUND' });
    });

    it('accepts a known serial and offers an unknown one as new while receiving', async () => {
      await receive({ serials: ['2UKBB25506101197'] });

      // A pending unit is refused outside receiving (not found would be the
      // answer for a serial nobody ever received).
      const pending = await verify({ payload: 'S/N:2UKBB25506101197' });
      expect(pending.body).toMatchObject({ kind: 'SERIAL', accepted: false, code: 'IMEI_NOT_AVAILABLE' });

      const unknownOut = await verify({ payload: 'UNKNOWN-SN-001' });
      expect(unknownOut.body).toMatchObject({ kind: 'SERIAL', accepted: false, code: 'SERIAL_NOT_FOUND' });

      // While receiving, the unknown serial is offered as a new unit.
      const newSer = await verify({ payload: 'UNKNOWN-SN-001', receiving: true });
      expect(newSer.body).toMatchObject({ kind: 'SERIAL', accepted: true, code: 'SERIAL_NEW_ACCEPTED' });
    });

    it('resolves an EAN to its product and asks for manual selection when unknown', async () => {
      await prisma.product.update({
        where: { id: fixture.product.id },
        data: { barcode: '0880123456789' },
      });

      const match = await verify({ payload: '0880123456789' });
      expect(match.body).toMatchObject({ kind: 'EAN', accepted: true, code: 'PRODUCT' });
      expect(match.body.product.id).toBe(fixture.product.id);

      const unknown = await verify({ payload: '4234567890128' });
      expect(unknown.body).toMatchObject({ kind: 'EAN', accepted: false, code: 'PRODUCT_BARCODE_NOT_FOUND' });
    });

    it('refuses anything that is not IMEI, serial or EAN', async () => {
      const res = await verify({ payload: 'hello' });
      expect(res.body.kind).toBe('OTHER');
      expect(res.body.accepted).toBe(false);
      expect(res.body.code).toBe('UNRECOGNIZED_BARCODE');
    });

    it('refuses to move a pending (serial-only) unit in any context', async () => {
      await receive({ serials: ['2UKBB25506101197'] });
      const res = await verify({ payload: '2UKBB25506101197' });
      expect(res.body.kind).toBe('SERIAL');
      expect(res.body.accepted).toBe(false);
      expect(res.body.code).toBe('IMEI_NOT_AVAILABLE');
      expect(res.body.message).toMatch(/pending/i);
    });
  });
});