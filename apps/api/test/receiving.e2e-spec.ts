import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture, testImei } from './helpers';

describe('Purchase receiving and IMEI rules (spec §11, §27)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;

  const receive = (imeis: string[], allowPartial = false) =>
    as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
      .send({ lines: [{ purchaseItemId: fixture.purchase.itemId, imeis }], allowPartial });

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

  it('creates one device per IMEI, in stock at the receiving warehouse', async () => {
    const imeis = Array.from({ length: 10 }, (_, i) => testImei(i + 1));
    const res = await receive(imeis).expect(200);

    expect(res.body).toMatchObject({ expected: 10, scanned: 10, missing: 0, purchaseStatus: 'RECEIVED' });

    const devices = await prisma.device.findMany({ where: { purchaseId: fixture.purchase.id } });
    expect(devices).toHaveLength(10);
    expect(devices.every((d) => d.status === 'IN_STOCK')).toBe(true);
    expect(devices.every((d) => d.currentWarehouseId === fixture.central.id)).toBe(true);
    // The purchase price is frozen onto each device so profit stays explainable,
    // and landed cost starts there before any handling or freight is posted.
    expect(devices.every((d) => d.purchaseCost?.toFixed(2) === '900.00')).toBe(true);
    expect(devices.every((d) => d.landedCost?.toFixed(2) === '900.00')).toBe(true);
    // Goods-in also opens the lot that later cost bills are pointed at.
    expect(devices.every((d) => d.lotId !== null)).toBe(true);
  });

  it('writes one PURCHASE_RECEIPT movement per device', async () => {
    await receive(Array.from({ length: 5 }, (_, i) => testImei(i + 1)), true).expect(200);
    const movements = await prisma.deviceMovement.findMany({ where: { type: 'PURCHASE_RECEIPT' } });
    expect(movements).toHaveLength(5);
    expect(movements.every((m) => m.toWarehouseId === fixture.central.id)).toBe(true);
    expect(movements.every((m) => m.fromWarehouseId === null)).toBe(true);
  });

  it('reports expected, scanned and missing when short', async () => {
    const res = await receive([testImei(1), testImei(2), testImei(3)]).expect(400);
    expect(res.body.code).toBe('PARTIAL_RECEIPT_NOT_ALLOWED');
    expect(res.body.details).toMatchObject({ expected: 10, scanned: 3, missing: 7 });
  });

  it('accepts a short receipt when partial receiving is requested', async () => {
    const res = await receive([testImei(1), testImei(2), testImei(3)], true).expect(200);
    expect(res.body).toMatchObject({ scanned: 3, missing: 7, purchaseStatus: 'PARTIALLY_RECEIVED' });

    const remaining = await as(app, admin).get(`/api/v1/purchases/${fixture.purchase.id}`).expect(200);
    expect(remaining.body.items[0].remainingQuantity).toBe(7);
  });

  it('rejects more IMEIs than were ordered', async () => {
    const res = await receive(Array.from({ length: 11 }, (_, i) => testImei(i + 1))).expect(400);
    expect(res.body.code).toBe('QUANTITY_EXCEEDED');
  });

  it('rejects a duplicate IMEI inside one scan batch', async () => {
    const res = await receive([testImei(1), testImei(2), testImei(1)]).expect(400);
    expect(res.body.code).toBe('IMEI_DUPLICATE_IN_REQUEST');
  });

  it('rejects an IMEI that already exists in the system', async () => {
    await receive(Array.from({ length: 5 }, (_, i) => testImei(i + 1)), true).expect(200);
    const res = await receive([testImei(3), testImei(6)], true).expect(409);
    expect(res.body.code).toBe('IMEI_ALREADY_EXISTS');
    expect(res.body.details.imeis).toContain(testImei(3));
  });

  it('rejects malformed IMEIs', async () => {
    for (const bad of ['12345', 'abcdefghijklmno', '9900000000000123']) {
      const res = await receive([bad]).expect(400);
      expect(res.body.code).toBe('IMEI_INVALID');
    }
  });

  it('normalises spaces and dashes emitted by scanners', async () => {
    await receive([` ${testImei(1)} `, testImei(2).replace(/^(\d{8})/, '$1-')], true).expect(200);
    const device = await prisma.device.findUnique({ where: { imei: testImei(1) } });
    expect(device).not.toBeNull();
  });

  it('commits nothing when any IMEI in the batch is bad', async () => {
    await receive([testImei(1), testImei(2), 'not-an-imei']).expect(400);
    expect(await prisma.device.count()).toBe(0);
    expect(await prisma.deviceMovement.count()).toBe(0);
    expect(await prisma.receipt.count()).toBe(0);
  });

  it('refuses to receive the same purchase twice once it is complete', async () => {
    await receive(Array.from({ length: 10 }, (_, i) => testImei(i + 1))).expect(200);
    const res = await receive([testImei(20)]).expect(400);
    expect(res.body.code).toBe('ALREADY_RECEIVED');
  });

  it('finds a received phone by IMEI with its full provenance', async () => {
    await receive(Array.from({ length: 2 }, (_, i) => testImei(i + 1)), true).expect(200);
    const res = await as(app, admin).get(`/api/v1/imeis/${testImei(1)}`).expect(200);

    expect(res.body.status).toBe('IN_STOCK');
    expect(res.body.currentWarehouse.id).toBe(fixture.central.id);
    expect(res.body.supplier.name).toBe('China Supplier');
    expect(res.body.product.sku).toBe('APL-IP18PM-256-BLK');
  });
});

describe('Receipt validation when REQUIRE_RECEIPT_VALIDATION is on (spec §15)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;

  beforeAll(async () => {
    process.env.REQUIRE_RECEIPT_VALIDATION = 'true';
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
  });
  afterAll(async () => {
    delete process.env.REQUIRE_RECEIPT_VALIDATION;
    await app.close();
  });

  it('holds received devices out of sellable stock until a receipt is validated', async () => {
    const imeis = Array.from({ length: 4 }, (_, i) => testImei(i + 1));
    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
      .send({ lines: [{ purchaseItemId: fixture.purchase.itemId, imeis }], allowPartial: true })
      .expect(200);

    expect(res.body.pendingValidation).toBe(true);
    expect(res.body.deviceStatus).toBe('RECEIVED');

    const beforeStock = await as(app, admin).get(`/api/v1/inventory/${fixture.central.id}`).expect(200);
    expect(beforeStock.body.available).toBe(0);
    expect(beforeStock.body.pendingValidation).toBe(4);

    const validated = await as(app, admin)
      .post(`/api/v1/receipts/${res.body.receiptId}/validate`)
      .expect(200);
    expect(validated.body.devicesReleased).toBe(4);

    const afterStock = await as(app, admin).get(`/api/v1/inventory/${fixture.central.id}`).expect(200);
    expect(afterStock.body.available).toBe(4);
  });

  it('refuses to validate the same receipt twice', async () => {
    const imeis = [testImei(1), testImei(2)];
    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
      .send({ lines: [{ purchaseItemId: fixture.purchase.itemId, imeis }], allowPartial: true })
      .expect(200);

    await as(app, admin).post(`/api/v1/receipts/${res.body.receiptId}/validate`).expect(200);
    const second = await as(app, admin).post(`/api/v1/receipts/${res.body.receiptId}/validate`).expect(400);
    expect(second.body.code).toBe('INVALID_STATUS_TRANSITION');
  });
});
