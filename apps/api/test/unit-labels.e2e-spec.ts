import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture } from './helpers';

/**
 * Labels for units that have not arrived yet.
 *
 * A sealed box cannot be identified by IMEI without opening it, so every unit
 * on an order gets a code up front and a label at goods-in. What matters here
 * is that the codes are stable and countable: the button is pressed by whoever
 * is standing at the bench, often twice, and a line that ends up with eleven
 * labels for ten phones is worse than no labels at all.
 */
describe('Purchase unit labels', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let carlos: string;

  const labelsOf = (body: { data: { code: string }[] }) => body.data.map((l) => l.code);

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

  it('reserves one code per unit ordered', async () => {
    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);

    const item = await prisma.purchaseItem.findUniqueOrThrow({
      where: { id: fixture.purchase.itemId },
    });
    expect(res.body.data).toHaveLength(item.quantity);
    expect(res.body.purchase.number).toMatch(/^PO-/);

    const codes = labelsOf(res.body);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^UL-\d{4}-\d{6}$/);
  });

  it('numbers each unit within its line, so a sheet can read "3 of 10"', async () => {
    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);

    const sequences = res.body.data.map((l: { sequence: number }) => l.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(sequences[0]).toBe(1);
    expect(res.body.data[0].of).toBe(res.body.data.length);
  });

  it('carries the product, so the label says what it is going on', async () => {
    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);

    expect(res.body.data[0].product).toMatchObject({ name: expect.any(String), sku: expect.any(String) });
  });

  it('does not double the labels when the button is pressed twice', async () => {
    const first = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);
    const second = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);

    expect(labelsOf(second.body)).toEqual(labelsOf(first.body));
  });

  it('tops up a line whose quantity has grown, keeping the codes already issued', async () => {
    const before = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);

    await prisma.purchaseItem.update({
      where: { id: fixture.purchase.itemId },
      data: { quantity: { increment: 3 } },
    });

    const after = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);

    expect(after.body.data).toHaveLength(before.body.data.length + 3);
    // The originals survive, still first, still with the same codes.
    expect(labelsOf(after.body).slice(0, before.body.data.length)).toEqual(labelsOf(before.body));
    const sequences = after.body.data.map((l: { sequence: number }) => l.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it('reads back what was reserved', async () => {
    const created = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);
    const read = await as(app, admin)
      .get(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);

    expect(labelsOf(read.body)).toEqual(labelsOf(created.body));
  });

  it('has none before the button is pressed', async () => {
    const res = await as(app, admin)
      .get(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);

    expect(res.body.data).toEqual([]);
  });

  it('keeps a warehouse user out of another warehouse\'s order', async () => {
    // The fixture purchase is bound for the central warehouse; Carlos works in Spain.
    await as(app, carlos).post(`/api/v1/purchases/${fixture.purchase.id}/labels`).expect(403);
    await as(app, carlos).get(`/api/v1/purchases/${fixture.purchase.id}/labels`).expect(403);
  });

  it('refuses to label a cancelled order', async () => {
    await as(app, admin).post(`/api/v1/purchases/${fixture.purchase.id}/cancel`).expect(200);

    const res = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('never issues the same code to two orders', async () => {
    const first = await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/labels`)
      .expect(200);

    const second = await as(app, admin)
      .post('/api/v1/purchases')
      .send({
        supplierId: fixture.supplier.id,
        warehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 4, unitPrice: '900.00' }],
      })
      .expect(201);

    const more = await as(app, admin).post(`/api/v1/purchases/${second.body.id}/labels`).expect(200);

    const overlap = labelsOf(more.body).filter((c) => labelsOf(first.body).includes(c));
    expect(overlap).toEqual([]);
  });
});
