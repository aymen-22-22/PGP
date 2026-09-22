import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture } from './helpers';

/**
 * Selling and looking up a device that arrived through the label-first
 * workflow, which never asks for an IMEI.
 *
 * The transfer path was fixed first; sales, the till and the lookup screen
 * kept resolving scans against `Device.imei` alone, so a label-received phone
 * could be moved between warehouses but never sold or found.
 */
describe('Selling a label-received device', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let label: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);

    const labels = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);
    label = labels.body.data[0].code as string;

    await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive-by-label`)
      .send({ code: label })
      .expect(200);
  });
  afterAll(async () => {
    await app.close();
  });

  it('completes a sale against the label code', async () => {
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
      .send({ imeis: [label] })
      .expect(200);

    const device = await prisma.device.findFirst({ where: { label: { code: label } } });
    expect(device?.status).toBe('SOLD');
    // Nothing invented an IMEI along the way.
    expect(device?.imei).toBeNull();
  });

  it('names the scanned label when the phone is not sellable', async () => {
    // Sell it once...
    const first = await as(app, admin)
      .post('/api/v1/sales')
      .send({
        customerId: fixture.customer.id,
        warehouseId: fixture.central.id,
        items: [{ productId: fixture.product.id, quantity: 1 }],
      })
      .expect(201);
    await as(app, admin)
      .post(`/api/v1/sales/${first.body.id}/complete`)
      .send({ imeis: [label] })
      .expect(200);

    // ...then try to sell the same label again. The error has to quote the
    // code that was scanned; there is no IMEI to quote instead.
    const second = await as(app, admin)
      .post('/api/v1/sales')
      .send({
        customerId: fixture.customer.id,
        warehouseId: fixture.central.id,
        items: [{ productId: fixture.product.id, quantity: 1 }],
      })
      .expect(201);
    const rejected = await as(app, admin)
      .post(`/api/v1/sales/${second.body.id}/complete`)
      .send({ imeis: [label] })
      .expect(409);
    expect(rejected.body.details.imeis).toContain(label);
  });

  it('verifies a label scan and opens its history', async () => {
    const verified = await as(app, admin)
      .post('/api/v1/imeis/verify')
      .send({ imei: label, warehouseId: fixture.central.id })
      .expect(200);
    expect(verified.body.kind).toBe('LABEL');
    expect(verified.body.accepted).toBe(true);

    const history = await as(app, admin)
      .get(`/api/v1/imeis/${encodeURIComponent(label)}/history`)
      .expect(200);
    expect(history.body.device.imei).toBeNull();
    expect(history.body.movements.map((m: { type: string }) => m.type)).toContain('PURCHASE_RECEIPT');
  });

  it('says a reserved label has not arrived rather than calling it unknown', async () => {
    const labels = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);
    const unreceived = labels.body.data.find((l: { code: string }) => l.code !== label).code as string;

    const verified = await as(app, admin)
      .post('/api/v1/imeis/verify')
      .send({ imei: unreceived })
      .expect(200);
    expect(verified.body.kind).toBe('LABEL');
    expect(verified.body.accepted).toBe(false);
    expect(verified.body.message).toMatch(/not been received/i);
  });
});
