import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture } from './helpers';

describe('Warehouse operations: scan, receive, send', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let jean: string;
  let carlos: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    jean = await login(app, fixture.jean.email);
    carlos = await login(app, fixture.carlos.email);
  });
  afterAll(async () => {
    await app.close();
  });

  const labels = async () =>
    (await as(app, admin).post(`/api/v1/purchases/${fixture.purchase.id}/labels`).expect(200)).body.data as {
      code: string;
    }[];

  it('lists what is coming per product, and counts down as each unit is received', async () => {
    const central = fixture.central.id;
    const before = await as(app, admin).get(`/api/v1/ops/incoming?warehouseId=${central}`).expect(200);
    expect(before.body.items[0]).toMatchObject({ product: { id: fixture.product.id }, toReceive: 10 });

    const [label] = await labels();
    const scanned = await as(app, admin).post('/api/v1/ops/scan').send({ code: label.code, warehouseId: central }).expect(200);
    expect(scanned.body).toMatchObject({ status: 'INCOMING', source: 'PURCHASE', remaining: 10 });

    const received = await as(app, admin).post('/api/v1/ops/receive').send({ code: label.code, warehouseId: central }).expect(200);
    expect(received.body.remaining).toBe(9);

    const again = await as(app, admin).post('/api/v1/ops/scan').send({ code: label.code, warehouseId: central }).expect(200);
    expect(again.body.status).toBe('AVAILABLE');
    expect(again.body.destinations.map((d: { id: string }) => d.id)).not.toContain(central);
  });

  it('sends from the scanner, and the far end receives it by scanning', async () => {
    const central = fixture.central.id;
    const [label] = await labels();
    await as(app, admin).post('/api/v1/ops/receive').send({ code: label.code, warehouseId: central }).expect(200);

    const sent = await as(app, admin)
      .post('/api/v1/ops/send')
      .send({ codes: [label.code], destinationWarehouseId: fixture.france.id, warehouseId: central })
      .expect(201);
    expect(sent.body.count).toBe(1);

    // Jean works in France: to them it is simply "incoming".
    const incoming = await as(app, jean).get('/api/v1/ops/incoming').expect(200);
    expect(incoming.body.total).toBe(1);
    const scan = await as(app, jean).post('/api/v1/ops/scan').send({ code: label.code }).expect(200);
    expect(scan.body).toMatchObject({ status: 'INCOMING', source: 'TRANSFER' });
    await as(app, jean).post('/api/v1/ops/receive').send({ code: label.code }).expect(200);
    expect((await as(app, jean).get('/api/v1/ops/incoming').expect(200)).body.total).toBe(0);

    const activity = await as(app, jean).get('/api/v1/ops/activity').expect(200);
    expect(activity.body.data[0]).toMatchObject({ type: 'TRANSFER_IN', count: 1, product: { id: fixture.product.id } });
  });

  it('says when a code is unknown or belongs elsewhere', async () => {
    const [label] = await labels();
    expect((await as(app, carlos).post('/api/v1/ops/scan').send({ code: 'UL-2099-999999' }).expect(200)).body.status).toBe(
      'NOT_FOUND',
    );
    expect((await as(app, carlos).post('/api/v1/ops/scan').send({ code: label.code }).expect(200)).body.status).toBe(
      'OTHER_WAREHOUSE',
    );
    await as(app, carlos).post('/api/v1/ops/receive').send({ code: label.code }).expect(400);
  });
});
