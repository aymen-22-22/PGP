import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Currency, PrismaClient, PurchaseStatus, Role, TrackingMode } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { testImei } from '../prisma/test-imei';

export { testImei };

export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  // No pipe is added here on purpose. AppModule already provides the global
  // ValidationPipe, and adding a second one ran every DTO through the
  // transforms twice — which is not what production does, so the suite was
  // quietly testing different behaviour. An absent `isActive` came out as
  // `false`, turning "no filter" into "only the inactive ones".
  app.useGlobalFilters(new AllExceptionsFilter(false));
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

async function hash(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export const PASSWORD = 'TestPassword123!';

export interface Fixture {
  central: { id: string };
  france: { id: string };
  spain: { id: string };
  admin: { id: string; email: string };
  jean: { id: string; email: string };
  carlos: { id: string; email: string };
  inactive: { email: string };
  supplier: { id: string };
  customer: { id: string };
  product: { id: string };
  /** An accessory: no IMEI, counted by quantity. */
  accessory: { id: string };
  brands: { apple: { id: string }; accessories: { id: string } };
  purchase: { id: string; itemId: string };
}

/**
 * Builds the standard three-warehouse world. Each suite starts from a clean
 * database so tests never depend on each other's ordering.
 */
export async function seedFixture(prisma: PrismaClient): Promise<Fixture> {
  const passwordHash = await hash(PASSWORD);

  // Costing needs a rate to convert dinar bills; keep one available for tests.
  const rateValidFrom = new Date('2000-01-01T00:00:00Z');
  for (const rate of [{ fromCurrency: Currency.EUR, toCurrency: Currency.DZD, rate: '280' }]) {
    const existing = await prisma.exchangeRate.findFirst({
      where: { fromCurrency: rate.fromCurrency, toCurrency: rate.toCurrency, validFrom: rateValidFrom },
    });
    if (!existing) await prisma.exchangeRate.create({ data: { ...rate, validFrom: rateValidFrom } });
  }

  const central = await prisma.warehouse.create({
    data: { name: 'Central Warehouse', code: 'CENTRAL', country: 'Netherlands' },
  });
  const france = await prisma.warehouse.create({
    data: { name: 'France Warehouse', code: 'FR', country: 'France' },
  });
  const spain = await prisma.warehouse.create({
    data: { name: 'Spain Warehouse', code: 'ES', country: 'Spain' },
  });

  const admin = await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@test.local',
      passwordHash,
      role: Role.ADMIN,
      warehouseId: central.id,
    },
  });
  const jean = await prisma.user.create({
    data: {
      name: 'Jean',
      email: 'jean@test.local',
      passwordHash,
      role: Role.WAREHOUSE_USER,
      warehouseId: france.id,
    },
  });
  const carlos = await prisma.user.create({
    data: {
      name: 'Carlos',
      email: 'carlos@test.local',
      passwordHash,
      role: Role.WAREHOUSE_USER,
      warehouseId: spain.id,
    },
  });
  await prisma.user.create({
    data: {
      name: 'Retired',
      email: 'retired@test.local',
      passwordHash,
      role: Role.WAREHOUSE_USER,
      warehouseId: france.id,
      isActive: false,
    },
  });

  const supplier = await prisma.supplier.create({ data: { name: 'China Supplier', country: 'China' } });
  const customer = await prisma.customer.create({ data: { name: 'France Customer', country: 'France' } });

  const apple = await prisma.brand.create({ data: { name: 'Apple' } });
  const accessories = await prisma.brand.create({ data: { name: 'Accessories' } });

  const product = await prisma.product.create({
    data: {
      name: 'iPhone 18 Pro Max 256GB Black',
      sku: 'APL-IP18PM-256-BLK',
      brandId: apple.id,
      model: 'iPhone 18 Pro Max',
      storage: '256GB',
      color: 'Black',
      purchasePrice: '900.00',
      defaultSalePrice: '980.00',
      currency: Currency.EUR,
    },
  });

  const accessory = await prisma.product.create({
    data: {
      name: 'USB-C Braided Cable 2m',
      sku: 'ACC-USBC-2M',
      brandId: accessories.id,
      model: 'USB-C 2m',
      category: 'Accessory',
      purchasePrice: '2.00',
      defaultSalePrice: '9.00',
      currency: Currency.EUR,
      tracking: TrackingMode.BULK,
    },
  });

  const purchase = await prisma.purchase.create({
    data: {
      number: 'PO-TEST-000001',
      supplierId: supplier.id,
      warehouseId: central.id,
      purchaseDate: new Date(),
      status: PurchaseStatus.ORDERED,
      totalAmount: '9000.00',
      createdById: admin.id,
      items: { create: [{ productId: product.id, quantity: 10, unitPrice: '900.00', totalPrice: '9000.00' }] },
    },
    include: { items: true },
  });

  return {
    central,
    france,
    spain,
    admin,
    jean,
    carlos,
    inactive: { email: 'retired@test.local' },
    supplier,
    customer,
    product,
    accessory,
    brands: { apple, accessories },
    purchase: { id: purchase.id, itemId: purchase.items[0].id },
  };
}

export async function login(app: INestApplication, email: string, password = PASSWORD): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken;
}

/** Authenticated request helper — bearer tokens keep the CSRF guard out of the way. */
export function as(app: INestApplication, token: string) {
  const agent = request(app.getHttpServer());
  return {
    get: (url: string) => agent.get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => agent.post(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => agent.patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => agent.delete(url).set('Authorization', `Bearer ${token}`),
  };
}

/** Receives `count` devices into the fixture purchase and returns their IMEIs. */
export async function receiveDevices(
  app: INestApplication,
  token: string,
  fixture: Fixture,
  count: number,
  startAt = 1,
): Promise<string[]> {
  const imeis = Array.from({ length: count }, (_, i) => testImei(startAt + i));
  await as(app, token)
    .post(`/api/v1/purchases/${fixture.purchase.id}/receive`)
    .send({ lines: [{ purchaseItemId: fixture.purchase.itemId, imeis }], allowPartial: true })
    .expect(200);
  return imeis;
}
