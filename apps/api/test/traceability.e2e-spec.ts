import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, receiveDevices, seedFixture } from './helpers';

describe('IMEI traceability and the movement ledger (spec §20, §21)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let jean: string;
  let imeis: string[];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    jean = await login(app, fixture.jean.email);
    imeis = await receiveDevices(app, admin, fixture, 4);
  });
  afterAll(async () => {
    await app.close();
  });

  it('tells the full story of a phone from supplier to customer', async () => {
    // Central → France
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
    const moved: string[] = detail.body.devices.map((d: { imei: string }) => d.imei);
    await as(app, jean).post(`/api/v1/transfers/${transfer.body.id}/receive`).send({ imeis: moved }).expect(200);

    // France sells one — selling is an office function, not the warehouse
    // account that just received the transfer. An administrator has no
    // warehouse of their own, so the selling one has to be named.
    const sale = await as(app, admin)
      .post('/api/v1/sales')
      .send({
        customerId: fixture.customer.id,
        warehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 1 }],
      })
      .expect(201);
    await as(app, admin).post(`/api/v1/sales/${sale.body.id}/complete`).send({ imeis: [moved[0]] }).expect(200);

    const history = await as(app, admin).get(`/api/v1/imeis/${moved[0]}/history`).expect(200);

    expect(history.body.device.supplier.name).toBe('China Supplier');
    expect(history.body.device.purchase.number).toBe('PO-TEST-000001');
    expect(history.body.device.sale.customer.name).toBe('France Customer');
    expect(history.body.device.status).toBe('SOLD');

    const chain = history.body.movements.map((m: { type: string }) => m.type);
    expect(chain).toEqual(['PURCHASE_RECEIPT', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE']);

    const [receipt, out, inbound, sold] = history.body.movements;
    expect(receipt.toWarehouse.name).toBe('Central Warehouse');
    expect(out.fromWarehouse.name).toBe('Central Warehouse');
    expect(out.toWarehouse.name).toBe('France Warehouse');
    expect(inbound.performedBy.name).toBe('Jean');
    expect(sold.fromWarehouse.name).toBe('France Warehouse');

    // Chronological, never reordered.
    const times = history.body.movements.map((m: { createdAt: string }) => new Date(m.createdAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('never rewrites history when a device moves again', async () => {
    const before = await prisma.deviceMovement.count();

    const transfer = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 1 }],
        autoFill: true,
      })
      .expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);

    // Movements are only ever appended.
    expect(await prisma.deviceMovement.count()).toBe(before + 1);
  });

  it('validates one scanned IMEI against a context without changing anything', async () => {
    const good = await as(app, admin)
      .post('/api/v1/imeis/verify')
      .send({ imei: imeis[0], warehouseId: fixture.central.id })
      .expect(200);
    expect(good.body.accepted).toBe(true);
    expect(good.body.device.product.sku).toBe('APL-IP18PM-256-BLK');

    const wrongWarehouse = await as(app, admin)
      .post('/api/v1/imeis/verify')
      .send({ imei: imeis[0], warehouseId: fixture.france.id })
      .expect(200);
    expect(wrongWarehouse.body.accepted).toBe(false);
    expect(wrongWarehouse.body.code).toBe('IMEI_WRONG_WAREHOUSE');

    const unknown = await as(app, admin)
      .post('/api/v1/imeis/verify')
      .send({ imei: '990000000999998' })
      .expect(200);
    expect(unknown.body.accepted).toBe(false);
    expect(unknown.body.code).toBe('IMEI_NOT_FOUND');

    // Nothing was written.
    expect(await prisma.deviceMovement.count()).toBe(4);
  });

  it('derives stock from devices rather than any stored total', async () => {
    const summary = await as(app, admin).get('/api/v1/inventory').expect(200);
    const row = summary.body.data.find(
      (r: { warehouseId: string }) => r.warehouseId === fixture.central.id,
    );
    expect(row.inStock).toBe(4);

    // Delete a device directly and the figure follows immediately.
    const device = await prisma.device.findFirst({ where: { imei: imeis[0] } });
    await prisma.deviceMovement.deleteMany({ where: { deviceId: device!.id } });
    await prisma.device.delete({ where: { id: device!.id } });

    const after = await as(app, admin).get('/api/v1/inventory').expect(200);
    expect(after.body.data[0].inStock).toBe(3);
  });

  it('carries the label code and the carrier who moved it into the history', async () => {
    const [label] = await (
      await as(app, admin).post(`/api/v1/purchases/${fixture.purchase.id}/labels`).expect(200)
    ).body.data as { code: string }[];
    await as(app, admin)
      .post(`/api/v1/purchases/${fixture.purchase.id}/receive-by-label`)
      .send({ code: label.code })
      .expect(200);

    const company = await as(app, admin)
      .post('/api/v1/delivery/companies')
      .send({ name: 'XYZ Transport' })
      .expect(201);

    const transfer = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 1 }],
        imeis: [label.code],
        deliveryCompanyId: company.body.id,
      })
      .expect(201);
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);

    const history = await as(app, admin).get(`/api/v1/imeis/${label.code}/history`).expect(200);

    expect(history.body.device.imei).toBeNull();
    expect(history.body.device.label).toEqual({ code: label.code });
    expect(history.body.device.product.barcode).not.toBeUndefined();

    const shipped = history.body.movements.find((m: { type: string }) => m.type === 'TRANSFER_OUT');
    expect(shipped.carrier).toMatchObject({ name: 'XYZ Transport' });
  });

  it('writes an audit trail for every significant action', async () => {
    const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    const actions = logs.map((l) => l.action);
    expect(actions).toContain('LOGIN');
    expect(actions).toContain('RECEIVE_PURCHASE');

    const receipt = logs.find((l) => l.action === 'RECEIVE_PURCHASE');
    expect(receipt?.userId).toBe(fixture.admin.id);
    expect(receipt?.entityType).toBe('Purchase');
  });
});
