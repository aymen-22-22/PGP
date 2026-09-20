import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Fixture, as, createTestApp, login, seedFixture } from './helpers';

/**
 * Makes are a record, not a word typed onto each product.
 *
 * The tests that matter are the ones about sameness: free text is how a
 * catalogue ends up with "Apple", "apple" and "Apple " in three separate piles,
 * and the stock browser groups by this.
 */
describe('Brands', () => {
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

  it('lists the makes with how many products each has', async () => {
    const res = await as(app, admin).get('/api/v1/brands').expect(200);

    const byName = Object.fromEntries(
      res.body.data.map((b: { name: string; products: number }) => [b.name, b.products]),
    );
    expect(byName).toEqual({ Apple: 1, Accessories: 1 });
  });

  it('creates a make anyone can then pick', async () => {
    const created = await as(app, admin).post('/api/v1/brands').send({ name: 'Xiaomi' }).expect(201);
    expect(created.body.name).toBe('Xiaomi');

    const list = await as(app, jean).get('/api/v1/brands').expect(200);
    expect(list.body.data.map((b: { name: string }) => b.name)).toContain('Xiaomi');
  });

  it('refuses a make that already exists, whatever the capitals', async () => {
    const res = await as(app, admin).post('/api/v1/brands').send({ name: 'apple' }).expect(409);
    expect(res.body.message).toContain('Apple');
  });

  it('trims the name, so a trailing space is not a second company', async () => {
    await as(app, admin).post('/api/v1/brands').send({ name: '  Xiaomi  ' }).expect(201);
    await as(app, admin).post('/api/v1/brands').send({ name: 'Xiaomi' }).expect(409);
  });

  it('is created by administrators only', async () => {
    await as(app, jean).post('/api/v1/brands').send({ name: 'Oppo' }).expect(403);
  });

  it('will not delete a make out from under its products', async () => {
    // There is no delete endpoint on purpose: retiring is the safe operation,
    // and the database refuses the destructive one regardless.
    const brands = await as(app, admin).get('/api/v1/brands').expect(200);
    const apple = brands.body.data.find((b: { name: string }) => b.name === 'Apple');

    await expect(prisma.brand.delete({ where: { id: apple.id } })).rejects.toThrow();
  });

  describe('products', () => {
    it('is created against a make, and carries it back', async () => {
      const brand = await as(app, admin).post('/api/v1/brands').send({ name: 'Xiaomi' }).expect(201);

      const product = await as(app, admin)
        .post('/api/v1/products')
        .send({
          name: 'Redmi Note 14',
          sku: 'XIA-RN14-128',
          brandId: brand.body.id,
          model: 'Redmi Note 14',
          purchasePrice: '180.00',
          defaultSalePrice: '240.00',
        })
        .expect(201);

      expect(product.body.brand).toMatchObject({ id: brand.body.id, name: 'Xiaomi' });
    });

    it('refuses a make that does not exist', async () => {
      const res = await as(app, admin)
        .post('/api/v1/products')
        .send({
          name: 'Ghost',
          sku: 'GHOST-1',
          brandId: '00000000-0000-4000-8000-000000000000',
          model: 'Ghost',
          purchasePrice: '1.00',
          defaultSalePrice: '2.00',
        })
        .expect(404);
      expect(res.body.message).toContain('Brand');
    });

    it('can be filtered by make', async () => {
      const res = await as(app, admin)
        .get(`/api/v1/products?brandId=${fixture.brands.apple.id}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].sku).toBe('APL-IP18PM-256-BLK');
    });

    it('can be moved to a different make', async () => {
      const brand = await as(app, admin).post('/api/v1/brands').send({ name: 'Xiaomi' }).expect(201);

      const res = await as(app, admin)
        .patch(`/api/v1/products/${fixture.product.id}`)
        .send({ brandId: brand.body.id })
        .expect(200);

      expect(res.body.brand.name).toBe('Xiaomi');
    });
  });
});
