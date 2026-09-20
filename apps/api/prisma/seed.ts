/**
 * Development seed: the exact scenario from the specification's acceptance test.
 *
 * Three warehouses, three cost centres, an admin plus one user per country
 * warehouse, one supplier, two customers, one product, and a 1,000-unit purchase
 * whose IMEIs are ready to be received through the application itself.
 *
 * The IMEIs use the 99000000 test TAC prefix reserved for testing, with a valid
 * Luhn check digit so they behave exactly like real ones in the scanner.
 */
import { Currency, PrismaClient, PurchaseStatus, Role, TrackingMode } from '@prisma/client';
import * as argon2 from 'argon2';
import { testImei } from './test-imei';

const prisma = new PrismaClient();

const PASSWORDS = {
  admin: process.env.SEED_ADMIN_PASSWORD ?? 'Admin12345!',
  jean: process.env.SEED_USER_PASSWORD ?? 'Warehouse123!',
  carlos: process.env.SEED_USER_PASSWORD ?? 'Warehouse123!',
};

async function hash(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

async function main(): Promise<void> {
  console.log('Seeding…');

  // --- Countries -----------------------------------------------------------
  // France and Spain source and hold stock; Algeria holds stock and sells.
  const countries = {
    FR: await prisma.country.upsert({
      where: { code: 'FR' },
      update: {},
      create: { code: 'FR', name: 'France', currency: Currency.EUR },
    }),
    ES: await prisma.country.upsert({
      where: { code: 'ES' },
      update: {},
      create: { code: 'ES', name: 'Spain', currency: Currency.EUR },
    }),
    DZ: await prisma.country.upsert({
      where: { code: 'DZ' },
      update: {},
      create: { code: 'DZ', name: 'Algeria', currency: Currency.DZD },
    }),
  };

  // Costs are reported in euros; dinars convert at this rate. A rate is a dated
  // row, never an edit, so past conversions keep the rate they were made at.
  // Only the exact direction is stored. The reverse is derived by division, so
  // no precision is lost to a repeating decimal like 1/280.
  for (const rate of [{ fromCurrency: Currency.EUR, toCurrency: Currency.DZD, rate: '280' }]) {
    const validFrom = new Date('2000-01-01T00:00:00Z');
    const existing = await prisma.exchangeRate.findFirst({
      where: { fromCurrency: rate.fromCurrency, toCurrency: rate.toCurrency, validFrom },
    });
    if (!existing) await prisma.exchangeRate.create({ data: { ...rate, validFrom } });
  }

  // --- Warehouses and cost centres ----------------------------------------
  // Two per country, matching how the business actually names them.
  const warehouseSeed = [
    { code: 'FR-01', name: 'France Warehouse 1', country: 'France', countryId: countries.FR.id },
    { code: 'FR-02', name: 'France Warehouse 2', country: 'France', countryId: countries.FR.id },
    { code: 'ES-01', name: 'Spain Warehouse 1', country: 'Spain', countryId: countries.ES.id },
    { code: 'ES-02', name: 'Spain Warehouse 2', country: 'Spain', countryId: countries.ES.id },
    { code: 'DZ-01', name: 'Algeria Warehouse 1', country: 'Algeria', countryId: countries.DZ.id },
    { code: 'DZ-02', name: 'Algeria Warehouse 2', country: 'Algeria', countryId: countries.DZ.id },
  ];
  const warehouses: Record<string, { id: string; name: string }> = {};
  for (const w of warehouseSeed) {
    warehouses[w.code] = await prisma.warehouse.upsert({
      where: { code: w.code },
      update: { countryId: w.countryId },
      create: w,
    });
  }

  // The chain: goods land in France, move to Spain, then to Algeria to be sold.
  const france = warehouses['FR-01'];
  const spain = warehouses['ES-01'];
  const algeria = warehouses['DZ-01'];

  const ccFrance = await prisma.costCenter.upsert({
    where: { code: 'CC-FR' },
    update: {},
    create: { name: 'France', code: 'CC-FR', warehouseId: france.id },
  });
  const ccSpain = await prisma.costCenter.upsert({
    where: { code: 'CC-ES' },
    update: {},
    create: { name: 'Spain', code: 'CC-ES', warehouseId: spain.id },
  });
  const ccAlgeria = await prisma.costCenter.upsert({
    where: { code: 'CC-DZ' },
    update: {},
    create: { name: 'Algeria', code: 'CC-DZ', warehouseId: algeria.id },
  });

  // --- Users ---------------------------------------------------------------
  const admin = await prisma.user.upsert({
    where: { email: 'admin@phone-erp.local' },
    update: {},
    create: {
      name: 'Admin',
      email: 'admin@phone-erp.local',
      passwordHash: await hash(PASSWORDS.admin),
      role: Role.ADMIN,
      warehouseId: france.id,
      costCenterId: ccFrance.id,
    },
  });
  await prisma.user.upsert({
    where: { email: 'jean@phone-erp.local' },
    update: {},
    create: {
      name: 'Jean',
      email: 'jean@phone-erp.local',
      passwordHash: await hash(PASSWORDS.jean),
      role: Role.WAREHOUSE_USER,
      warehouseId: france.id,
      costCenterId: ccFrance.id,
    },
  });
  await prisma.user.upsert({
    where: { email: 'carlos@phone-erp.local' },
    update: {},
    create: {
      name: 'Carlos',
      email: 'carlos@phone-erp.local',
      passwordHash: await hash(PASSWORDS.carlos),
      role: Role.WAREHOUSE_USER,
      warehouseId: spain.id,
      costCenterId: ccSpain.id,
    },
  });
  await prisma.user.upsert({
    where: { email: 'amina@phone-erp.local' },
    update: {},
    create: {
      name: 'Amina',
      email: 'amina@phone-erp.local',
      passwordHash: await hash(PASSWORDS.jean),
      role: Role.WAREHOUSE_USER,
      warehouseId: algeria.id,
      costCenterId: ccAlgeria.id,
    },
  });

  // --- Partners and catalogue ---------------------------------------------
  const supplier =
    (await prisma.supplier.findFirst({ where: { name: 'France Supplier' } })) ??
    (await prisma.supplier.create({
      data: {
        name: 'France Supplier',
        country: 'France',
        countryId: countries.FR.id,
        email: 'ventes@france-supplier.example',
        phone: '+33 1 23 45 67 89',
        address: 'Lyon, France',
      },
    }));
  if (!(await prisma.supplier.findFirst({ where: { name: 'Spain Supplier' } }))) {
    await prisma.supplier.create({
      data: {
        name: 'Spain Supplier',
        country: 'Spain',
        countryId: countries.ES.id,
        email: 'ventas@spain-supplier.example',
        address: 'Barcelona, Spain',
      },
    });
  }

  for (const customer of [
    { name: 'Algiers Distributor', country: 'Algeria', email: 'contact@algiers-distributor.example' },
    { name: 'Oran Retail Group', country: 'Algeria', email: 'contact@oran-retail.example' },
  ]) {
    const existing = await prisma.customer.findFirst({ where: { name: customer.name } });
    if (!existing) await prisma.customer.create({ data: customer });
  }

  // Makes, which are how the stock browser is organised.
  const brands: Record<string, { id: string }> = {};
  for (const name of ['Apple', 'Samsung', 'Accessories']) {
    brands[name] = await prisma.brand.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const product = await prisma.product.upsert({
    where: { sku: 'APL-IP18PM-256-BLK' },
    update: {},
    create: {
      name: 'iPhone 18 Pro Max 256GB Black',
      sku: 'APL-IP18PM-256-BLK',
      brandId: brands.Apple.id,
      model: 'iPhone 18 Pro Max',
      storage: '256GB',
      color: 'Black',
      category: 'Smartphone',
      purchasePrice: '900.00',
      defaultSalePrice: '980.00',
      currency: Currency.EUR,
    },
  });

  // --- Selling prices per market -------------------------------------------
  //
  // The catalogue price is European. Algeria sells in dinars, so the Algerian
  // price is a price-list entry — without one a handset cannot share a receipt
  // with a dinar-priced accessory, which is the system telling the truth about
  // a missing price rather than inventing one.
  const priceFrom = new Date('2000-01-01T00:00:00Z');
  const priceInCountry = async (productId: string, countryId: string, price: string, currency: Currency) => {
    const existing = await prisma.productPrice.findFirst({ where: { productId, countryId } });
    if (existing) return;
    await prisma.productPrice.create({
      data: { productId, countryId, price, currency, validFrom: priceFrom, createdById: admin.id },
    });
  };
  // Priced off what the handset costs *landed* in Algiers, not off the European
  // list price converted. A phone bought at EUR 900 costs around EUR 1,430 by
  // the time handling, freight and Algerian customs are on it, so EUR 980 × 280
  // would sell every unit at a EUR 450 loss — which is precisely the mistake
  // landed costing exists to prevent.
  await priceInCountry(product.id, countries.DZ.id, '499000.00', Currency.DZD);

  // --- Accessories: stock counted by quantity, not by IMEI -----------------
  //
  // Bought in Europe in euros, sold in Algeria in dinars — so the catalogue
  // price is the European one and the dinar price is a price-list entry for
  // Algeria, exactly as the phones work. No opening stock: every shelf starts
  // empty and the quantities appear through purchases and receipts.
  const accessorySpecs = [
    { name: 'USB-C Braided Cable 2m', sku: 'ACC-USBC-2M', purchase: '2.00', sale: '4.00', dzd: '900.00' },
    { name: 'Fast Charger 30W', sku: 'ACC-CHG-30W', purchase: '6.50', sale: '11.00', dzd: '2800.00' },
    { name: 'Tempered Glass Screen Protector', sku: 'ACC-GLASS-UNI', purchase: '0.80', sale: '2.00', dzd: '500.00' },
    { name: 'Silicone Case Clear', sku: 'ACC-CASE-CLR', purchase: '1.20', sale: '2.50', dzd: '700.00' },
  ];

  for (const spec of accessorySpecs) {
    const accessory = await prisma.product.upsert({
      where: { sku: spec.sku },
      update: {},
      create: {
        name: spec.name,
        sku: spec.sku,
        brandId: brands.Accessories.id,
        model: spec.name,
        category: 'Accessory',
        purchasePrice: spec.purchase,
        defaultSalePrice: spec.sale,
        currency: Currency.EUR,
        tracking: TrackingMode.BULK,
      },
    });

    await priceInCountry(accessory.id, countries.DZ.id, spec.dzd, Currency.DZD);
  }

  // --- A purchase of 1,000 units, ready to be received ---------------------
  const existingPurchase = await prisma.purchase.findFirst({ where: { supplierId: supplier.id } });
  let purchaseNumber = existingPurchase?.number;

  if (!existingPurchase) {
    const purchase = await prisma.$transaction(async (tx) => {
      const counter = await tx.documentCounter.upsert({
        where: { scope_year: { scope: 'PO', year: new Date().getUTCFullYear() } },
        create: { scope: 'PO', year: new Date().getUTCFullYear(), value: 1 },
        update: { value: { increment: 1 } },
      });
      const number = `PO-${new Date().getUTCFullYear()}-${String(counter.value).padStart(6, '0')}`;
      return tx.purchase.create({
        data: {
          number,
          supplierId: supplier.id,
          warehouseId: france.id,
          purchaseDate: new Date(),
          currency: Currency.EUR,
          status: PurchaseStatus.ORDERED,
          totalAmount: '900000.00',
          createdById: admin.id,
          items: {
            create: [
              { productId: product.id, quantity: 1000, unitPrice: '900.00', totalPrice: '900000.00' },
            ],
          },
        },
      });
    });
    purchaseNumber = purchase.number;
  }

  console.log(`
Seed complete.

  Sign in with:
    admin@phone-erp.local   / ${PASSWORDS.admin}      (ADMIN, all warehouses)
    jean@phone-erp.local    / ${PASSWORDS.jean}   (France Warehouse 1)
    carlos@phone-erp.local  / ${PASSWORDS.carlos}   (Spain Warehouse 1)
    amina@phone-erp.local   / ${PASSWORDS.jean}   (Algeria Warehouse 1)

  Countries  : France and Spain (source + stock), Algeria (stock + sales)
  Warehouses : FR-01, FR-02, ES-01, ES-02, DZ-01, DZ-02
  Rate       : 1 EUR = 280 DZD
  Product    : ${product.name} (${product.sku})
  Purchase   : ${purchaseNumber} — 1,000 units at EUR 900.00 into France, awaiting receipt

  The chain to walk: receive into FR-01, transfer to ES-01, then to DZ-01,
  posting handling, freight and customs at each step. Landed cost accumulates
  on every unit and the arrival document shows the build-up.

  Test IMEIs (valid Luhn, reserved 99000000 test TAC):
    ${testImei(1)}  …  ${testImei(1000)}

  Generate the full list with:
    npm run db:imeis -w @phone-erp/api -- 1 1000
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
