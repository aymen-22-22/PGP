import { INestApplication } from '@nestjs/common';
import { DeviceStatus, PurchaseStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture } from './helpers';

/**
 * Goods-in by scanning the label printed at PO time — no IMEI entry.
 *
 * The label already proves the product and the purchase order, which is the
 * whole point of printing it before the phone arrives: a warehouse employee
 * scans one phone at a time, and each scan alone has to be enough for the
 * system to accept it as a real, sellable unit.
 */
describe('Receive by label', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let carlos: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    carlos = await login(app, fixture.carlos.email);
  });
  afterAll(async () => {
    await app.close();
  });

  async function generateLabels() {
    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);
    return res.body.data as { code: string }[];
  }

  it('registers a device straight into sellable stock, no IMEI asked for', async () => {
    const [label] = await generateLabels();

    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive-by-label`)
      .send({ code: label.code })
      .expect(200);

    expect(res.body).toMatchObject({
      code: label.code,
      product: { name: fixture.product.name, sku: fixture.product.sku },
      purchase: { number: 'PO-TEST-000001' },
      expected: 10,
      received: 1,
      remaining: 9,
    });

    const device = await prisma.device.findFirst({ where: { purchaseItemId: fixture.purchase.itemId } });
    expect(device).toMatchObject({ status: DeviceStatus.IN_STOCK, imei: null, serialNumber: null });

    const stored = await prisma.purchaseUnitLabel.findUnique({ where: { code: label.code } });
    expect(stored?.deviceId).toBe(device?.id);
    expect(stored?.receivedAt).not.toBeNull();
  });

  it('moves the purchase to PARTIALLY_RECEIVED, then RECEIVED once every label is scanned', async () => {
    const labels = await generateLabels();

    for (const label of labels.slice(0, 9)) {
      await as(app, admin)
        .post(`/api/v1/purchases/${fixture.purchase.id}/receive-by-label`)
        .send({ code: label.code })
        .expect(200);
    }
    let purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: fixture.purchase.id } });
    expect(purchase.status).toBe(PurchaseStatus.PARTIALLY_RECEIVED);

    const last = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive-by-label`)
      .send({ code: labels[9].code })
      .expect(200);
    expect(last.body.remaining).toBe(0);
    expect(last.body.purchaseStatus).toBe(PurchaseStatus.RECEIVED);

    purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: fixture.purchase.id } });
    expect(purchase.status).toBe(PurchaseStatus.RECEIVED);
  });

  it('refuses a code that was never printed', async () => {
    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive-by-label`)
      .send({ code: 'UL-2026-999999' })
      .expect(404);
    expect(res.body.code).toBe('UNRECOGNIZED_BARCODE');
  });

  it('refuses a label that belongs to a different purchase order', async () => {
    const [label] = await generateLabels();

    const other = await as(app, admin)
      .post('/api/v1/purchases')
      .send({
        supplierId: fixture.supplier.id,
        warehouseId: fixture.central.id,
        items: [{ productId: fixture.product.id, quantity: 3, unitPrice: '900.00' }],
      })
      .expect(201);

    const res = await as(app, admin)
      .post(`/api/v1/purchases/${other.body.id}/receive-by-label`)
      .send({ code: label.code })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('refuses to scan the same label twice', async () => {
    const [label] = await generateLabels();
    await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive-by-label`)
      .send({ code: label.code })
      .expect(200);

    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive-by-label`)
      .send({ code: label.code })
      .expect(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('keeps a warehouse user out of another warehouse\'s purchase', async () => {
    const [label] = await generateLabels();
    // The fixture purchase is bound for the central warehouse; Carlos works in Spain.
    await as(app, carlos)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive-by-label`)
      .send({ code: label.code })
      .expect(403);
  });

  it('refuses to receive against a cancelled purchase', async () => {
    await as(app, admin).post(`/api/v1/purchases/${fixture.purchase.id}/cancel`).expect(200);
    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive-by-label`)
      .send({ code: 'UL-2026-000001' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
