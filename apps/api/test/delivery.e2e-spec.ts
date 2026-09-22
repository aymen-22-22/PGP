import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, receiveDevices, seedFixture } from './helpers';

/**
 * Transport companies and drivers: who a picker names on a Send, never
 * someone they can invent themselves.
 */
describe('Delivery companies and drivers', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let admin: string;
  let jean: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    admin = await login(app, fixture.admin.email);
    jean = await login(app, fixture.jean.email);
  });
  afterAll(async () => {
    await app.close();
  });

  it('lets admin create a company and a driver for it', async () => {
    const company = await as(app, admin)
      .post('/api/v1/delivery/companies')
      .send({ name: 'XYZ Transport', phone: '+33 1 23 45 67 89' })
      .expect(201);
    expect(company.body.name).toBe('XYZ Transport');

    const driver = await as(app, admin)
      .post('/api/v1/delivery/drivers')
      .send({ name: 'Ahmed', companyId: company.body.id })
      .expect(201);
    expect(driver.body.company.name).toBe('XYZ Transport');
  });

  it('refuses a second company with the same name, whatever the case', async () => {
    await as(app, admin).post('/api/v1/delivery/companies').send({ name: 'XYZ Transport' }).expect(201);
    const clash = await as(app, admin)
      .post('/api/v1/delivery/companies')
      .send({ name: 'xyz transport' })
      .expect(409);
    expect(clash.body.message).toContain('XYZ Transport');
  });

  it('lets a warehouse account list active carriers but not create one', async () => {
    await as(app, admin).post('/api/v1/delivery/companies').send({ name: 'XYZ Transport' }).expect(201);

    const list = await as(app, jean).get('/api/v1/delivery/companies').expect(200);
    expect(list.body.data.map((c: { name: string }) => c.name)).toContain('XYZ Transport');

    await as(app, jean).post('/api/v1/delivery/companies').send({ name: 'Rogue Transport' }).expect(403);
  });

  it('hides a retired company from the active list but keeps it visible on request', async () => {
    const company = await as(app, admin).post('/api/v1/delivery/companies').send({ name: 'Old Firm' }).expect(201);
    await as(app, admin)
      .patch(`/api/v1/delivery/companies/${company.body.id}`)
      .send({ isActive: false })
      .expect(200);

    const active = await as(app, jean).get('/api/v1/delivery/companies').expect(200);
    expect(active.body.data.map((c: { name: string }) => c.name)).not.toContain('Old Firm');

    const all = await as(app, admin).get('/api/v1/delivery/companies?includeInactive=true').expect(200);
    expect(all.body.data.map((c: { name: string }) => c.name)).toContain('Old Firm');
  });

  it('names a carrier on a transfer, and refuses deleting a company that has carried one', async () => {
    const company = await as(app, admin).post('/api/v1/delivery/companies').send({ name: 'XYZ Transport' }).expect(201);
    const driver = await as(app, admin)
      .post('/api/v1/delivery/drivers')
      .send({ name: 'Ahmed', companyId: company.body.id })
      .expect(201);

    // Stock to actually pick — a bare fixture has nothing in central to autoFill with.
    await receiveDevices(app, admin, fixture, 1);

    const transfer = await as(app, admin)
      .post('/api/v1/transfers')
      .send({
        sourceWarehouseId: fixture.central.id,
        destinationWarehouseId: fixture.france.id,
        items: [{ productId: fixture.product.id, quantity: 1 }],
        autoFill: true,
        deliveryCompanyId: company.body.id,
        driverId: driver.body.id,
      })
      .expect(201);

    // ship() returns a status summary, not the shipment row itself — the
    // carrier is confirmed through the transfer's own detail view below.
    await as(app, admin).post(`/api/v1/transfers/${transfer.body.id}/ship`).expect(200);

    const detail = await as(app, admin).get(`/api/v1/transfers/${transfer.body.id}`).expect(200);
    expect(detail.body.shipment.deliveryCompany.name).toBe('XYZ Transport');
    expect(detail.body.shipment.driver.name).toBe('Ahmed');

    await as(app, admin).delete(`/api/v1/delivery/companies/${company.body.id}`).expect(409);
  });
});
