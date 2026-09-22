import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture } from './helpers';

/**
 * Transfers a device that arrived through the label-first workflow, which
 * never asks for an IMEI. Before this, loading such a device onto a transfer
 * was impossible: `loadDevices` looked devices up by IMEI alone, and a
 * label-received device has none.
 */
describe('Transferring a label-received device', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;

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

  it('loads, ships and receives a device by its label code, no IMEI anywhere', async () => {
    const labelsRes = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);
    const label = labelsRes.body.data[0].code as string;

    const received = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive-by-label`)
      .send({ code: label })
      .expect(200);
    expect(received.body.product).toBeDefined();

    const transfer = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 1 }],
      })
      .expect(201);

    const loaded = await as(app, admin)
      .post(`/api/v1/transfers/${transfer.body.id}/load`)
      .send({ imeis: [label] })
      .expect(200);
    expect(loaded.body.added).toBe(1);

    const detail = await as(app, admin).get(`/api/v1/transfers/${transfer.body.id}`).expect(200);
    expect(detail.body.devices).toHaveLength(1);
    // The device carries no IMEI; the label code is what stands in for it here.
    expect(detail.body.devices[0].imei).toBe(label);

    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).send({}).expect(200);

    const receipt = await as(app, admin)
      .post(`/api/v1/transfers/${transfer.body.id}/receive`)
      .send({ imeis: [label] })
      .expect(200);
    expect(receipt.body.scanned).toBe(1);
    expect(receipt.body.status).toBe('RECEIVED');

    const device = await prisma.device.findFirst({ where: { purchaseItemId: fixture.purchase.itemId } });
    expect(device?.currentWarehouseId).toBe(fixture.france.id);
    expect(device?.imei).toBeNull();
  });

  it('still loads a legacy device by its real IMEI', async () => {
    const imei = '990000862471854'; // valid Luhn, 99 test-TAC prefix
    await prisma.device.create({
      data: {
        imei,
        status: 'IN_STOCK',
        productId: fixture.product.id,
        currentWarehouseId: fixture.central.id,
        purchaseId: fixture.purchase.id,
        purchaseItemId: fixture.purchase.itemId,
      },
    });

    const transfer = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 1 }],
      })
      .expect(201);

    const loaded = await as(app, admin)
      .post(`/api/v1/transfers/${transfer.body.id}/load`)
      .send({ imeis: [imei] })
      .expect(200);
    expect(loaded.body.added).toBe(1);
  });
});
