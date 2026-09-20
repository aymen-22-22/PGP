import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, receiveDevices, seedFixture } from './helpers';

describe('RBAC and warehouse isolation (spec §24)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let adminToken: string;
  let jeanToken: string;
  let carlosToken: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await prisma.truncateAll();
    fixture = await seedFixture(prisma);
    adminToken = await login(app, fixture.admin.email);
    jeanToken = await login(app, fixture.jean.email);
    carlosToken = await login(app, fixture.carlos.email);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('a warehouse user cannot reach another warehouse, even by calling the API directly', () => {
    it('cannot read another warehouse’s stock', async () => {
      const res = await as(app, jeanToken).get(`/api/v1/inventory/${fixture.spain.id}`).expect(403);
      expect(res.body.code).toBe('WAREHOUSE_FORBIDDEN');
    });

    it('cannot read the central warehouse’s stock', async () => {
      await as(app, jeanToken).get(`/api/v1/inventory/${fixture.central.id}`).expect(403);
    });

    it('is silently scoped to its own warehouse when it forges a warehouseId filter', async () => {
      await receiveDevices(app, adminToken, fixture, 3);

      const res = await as(app, jeanToken)
        .get(`/api/v1/inventory?warehouseId=${fixture.central.id}`)
        .expect(403);
      expect(res.body.code).toBe('WAREHOUSE_FORBIDDEN');

      // Without an explicit filter, the list is restricted rather than refused.
      const own = await as(app, jeanToken).get('/api/v1/inventory').expect(200);
      expect(own.body.data).toHaveLength(0);
    });

    it('receives its own dashboard when it asks for another warehouse’s', async () => {
      const res = await as(app, jeanToken)
        .get(`/api/v1/reports/dashboard?warehouseId=${fixture.spain.id}`)
        .expect(200);
      expect(res.body.warehouseId).toBe(fixture.france.id);
    });

    it('cannot receive a purchase belonging to another warehouse', async () => {
      const res = await as(app, jeanToken)
        .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
        .send({ lines: [{ purchaseItemId: fixture.purchase.itemId, imeis: ['990000000000010'] }] })
        .expect(403);
      expect(res.body.code).toBe('WAREHOUSE_FORBIDDEN');
    });

    it('cannot create a transfer out of another warehouse', async () => {
      await as(app, jeanToken)
        .post('/api/v1/transfers')
        .send({
          sourceWarehouseId: fixture.central.id,
          destinationWarehouseId: fixture.france.id,
          items: [{ productId: fixture.product.id, quantity: 1 }],
        })
        .expect(403);
    });

    it('cannot see another warehouse’s purchases in a list', async () => {
      const res = await as(app, jeanToken).get('/api/v1/purchases').expect(200);
      expect(res.body.data).toHaveLength(0);

      const adminRes = await as(app, adminToken).get('/api/v1/purchases').expect(200);
      expect(adminRes.body.data.length).toBeGreaterThan(0);
    });

    it('cannot look up an IMEI held by another warehouse', async () => {
      const [imei] = await receiveDevices(app, adminToken, fixture, 1);
      await as(app, jeanToken).get(`/api/v1/imeis/${imei}`).expect(403);
      await as(app, carlosToken).get(`/api/v1/imeis/${imei}`).expect(403);
      await as(app, adminToken).get(`/api/v1/imeis/${imei}`).expect(200);
    });
  });

  describe('admin-only endpoints', () => {
    it('refuses user management to a warehouse user', async () => {
      const res = await as(app, jeanToken).get('/api/v1/users').expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('refuses product creation to a warehouse user', async () => {
      await as(app, jeanToken)
        .post('/api/v1/products')
        .send({
          name: 'Sneaky Product',
          sku: 'SNK-1',
          brand: 'X',
          model: 'Y',
          purchasePrice: '1.00',
          defaultSalePrice: '2.00',
        })
        .expect(403);
    });

    it('refuses warehouse creation and the audit log to a warehouse user', async () => {
      await as(app, jeanToken)
        .post('/api/v1/warehouses')
        .send({ name: 'Rogue', code: 'RG', country: 'Nowhere' })
        .expect(403);
      await as(app, jeanToken).get('/api/v1/audit-logs').expect(403);
    });

    it('allows an admin everything the warehouse user was refused', async () => {
      await as(app, adminToken).get('/api/v1/users').expect(200);
      await as(app, adminToken).get('/api/v1/audit-logs').expect(200);
      await as(app, adminToken).get(`/api/v1/inventory/${fixture.spain.id}`).expect(200);
    });

    it('stops an admin from locking themselves out', async () => {
      await as(app, adminToken).patch(`/api/v1/users/${fixture.admin.id}`).send({ isActive: false }).expect(400);
    });
  });
});
