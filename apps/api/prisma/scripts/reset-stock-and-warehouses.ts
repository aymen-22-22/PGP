/**
 * One-off production data reset: zero all stock, rename warehouses to real
 * city names (2 per country: Algeria, Spain, France), and add one warehouse
 * staff user per warehouse.
 *
 * Run once, directly against the target database:
 *
 *   DATABASE_URL="<production connection string>" \
 *     npx ts-node apps/api/prisma/scripts/reset-stock-and-warehouses.ts
 *
 * Idempotent: safe to re-run. Devices that can't be deleted because they're
 * referenced by a Return (onDelete: Restrict) are left in place and counted
 * in the summary rather than failing the whole run.
 */
import { Currency, PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

// Shared hosts cap threads; see the note in src/main.ts.
process.env.TOKIO_WORKER_THREADS ??= '1';
process.env.UV_THREADPOOL_SIZE ??= '1';

const prisma = new PrismaClient();

const STAFF_PASSWORD = process.env.RESET_STAFF_PASSWORD ?? 'Warehouse123!';

async function hash(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

interface WarehousePlan {
  countryCode: 'DZ' | 'ES' | 'FR';
  countryName: string;
  currency: Currency;
  sites: { code: string; name: string }[];
}

const PLAN: WarehousePlan[] = [
  {
    countryCode: 'DZ',
    countryName: 'Algeria',
    currency: Currency.DZD,
    sites: [
      { code: 'DZ-01', name: 'Algiers Warehouse' },
      { code: 'DZ-02', name: 'Oran Warehouse' },
    ],
  },
  {
    countryCode: 'ES',
    countryName: 'Spain',
    currency: Currency.EUR,
    sites: [
      { code: 'ES-01', name: 'Madrid Warehouse' },
      { code: 'ES-02', name: 'Barcelona Warehouse' },
    ],
  },
  {
    countryCode: 'FR',
    countryName: 'France',
    currency: Currency.EUR,
    sites: [
      { code: 'FR-01', name: 'Paris Warehouse' },
      { code: 'FR-02', name: 'Lyon Warehouse' },
    ],
  },
];

async function zeroStock(): Promise<{ deletedDevices: number; keptDevices: number; deletedStockLevels: number }> {
  // Only devices not tied to a Return can be deleted (Return -> ReturnItem ->
  // Device is onDelete: Restrict, preserving return history). Everything else
  // that references a Device (movements, receipt lines, transfer lines, cost
  // entries) cascades.
  const returnedDeviceIds = new Set((await prisma.returnItem.findMany({ select: { deviceId: true } })).map((r) => r.deviceId));

  const allDeviceIds = (await prisma.device.findMany({ select: { id: true } })).map((d) => d.id);
  const deletableIds = allDeviceIds.filter((id) => !returnedDeviceIds.has(id));

  let deletedDevices = 0;
  const BATCH = 500;
  for (let i = 0; i < deletableIds.length; i += BATCH) {
    const chunk = deletableIds.slice(i, i + BATCH);
    const result = await prisma.device.deleteMany({ where: { id: { in: chunk } } });
    deletedDevices += result.count;
  }

  const stockMovements = await prisma.stockMovement.deleteMany({});
  const stockLevels = await prisma.stockLevel.deleteMany({});
  void stockMovements;

  return {
    deletedDevices,
    keptDevices: allDeviceIds.length - deletedDevices,
    deletedStockLevels: stockLevels.count,
  };
}

async function resetWarehouses(): Promise<Record<string, { id: string; name: string }>> {
  const result: Record<string, { id: string; name: string }> = {};

  for (const country of PLAN) {
    const countryRow = await prisma.country.upsert({
      where: { code: country.countryCode },
      update: { name: country.countryName },
      create: { code: country.countryCode, name: country.countryName, currency: country.currency },
    });

    for (const site of country.sites) {
      const warehouse = await prisma.warehouse.upsert({
        where: { code: site.code },
        update: { name: site.name, country: country.countryName, countryId: countryRow.id, isActive: true },
        create: { code: site.code, name: site.name, country: country.countryName, countryId: countryRow.id },
      });
      result[site.code] = warehouse;
    }

    // Any other active warehouse under this country beyond the two planned
    // sites is retired rather than deleted, so historical purchases/transfers
    // that reference it stay intact.
    const planCodes = country.sites.map((s) => s.code);
    await prisma.warehouse.updateMany({
      where: { countryId: countryRow.id, code: { notIn: planCodes }, isActive: true },
      data: { isActive: false },
    });
  }

  return result;
}

async function addWarehouseStaff(warehouses: Record<string, { id: string; name: string }>): Promise<string[]> {
  const staffByCode: Record<string, { name: string; email: string }> = {
    'DZ-01': { name: 'Algiers Warehouse Staff', email: 'algiers.staff@phone-erp.local' },
    'DZ-02': { name: 'Oran Warehouse Staff', email: 'oran.staff@phone-erp.local' },
    'ES-01': { name: 'Madrid Warehouse Staff', email: 'madrid.staff@phone-erp.local' },
    'ES-02': { name: 'Barcelona Warehouse Staff', email: 'barcelona.staff@phone-erp.local' },
    'FR-01': { name: 'Paris Warehouse Staff', email: 'paris.staff@phone-erp.local' },
    'FR-02': { name: 'Lyon Warehouse Staff', email: 'lyon.staff@phone-erp.local' },
  };

  const passwordHash = await hash(STAFF_PASSWORD);
  const created: string[] = [];

  for (const [code, staff] of Object.entries(staffByCode)) {
    const warehouse = warehouses[code];
    if (!warehouse) continue;
    await prisma.user.upsert({
      where: { email: staff.email },
      update: { warehouseId: warehouse.id, isActive: true },
      create: {
        name: staff.name,
        email: staff.email,
        passwordHash,
        role: Role.WAREHOUSE_USER,
        warehouseId: warehouse.id,
      },
    });
    created.push(`${staff.email} — ${warehouse.name}`);
  }

  return created;
}

async function main(): Promise<void> {
  console.log('Zeroing stock…');
  const stockSummary = await zeroStock();

  console.log('Resetting warehouses…');
  const warehouses = await resetWarehouses();

  console.log('Adding warehouse staff…');
  const staffLines = await addWarehouseStaff(warehouses);

  console.log(`
Reset complete.

  Devices deleted : ${stockSummary.deletedDevices}
  Devices kept     : ${stockSummary.keptDevices} (referenced by a Return — history preserved)
  Stock levels wiped: ${stockSummary.deletedStockLevels}

  Warehouses (2 per country):
${Object.values(warehouses)
  .map((w) => `    ${w.name}`)
  .join('\n')}

  Warehouse staff (password: ${STAFF_PASSWORD}):
${staffLines.map((l) => `    ${l}`).join('\n')}

  Change the staff password via RESET_STAFF_PASSWORD env var before running
  in a real production environment, or rotate it after first login.
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
