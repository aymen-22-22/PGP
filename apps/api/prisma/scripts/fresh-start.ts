/**
 * Fresh start: erase every transaction and keep the set-up.
 *
 * Deleted: phones and their history, purchases, receipts, labels, transfers,
 * shipments, sales, returns, lots, costs, accessory stock, sent-email log,
 * audit log, and the document number counters (so the next PO is -000001).
 *
 * Kept: countries, warehouses, cost centres, users, brands, products, prices,
 * suppliers, customers, delivery companies, drivers, exchange rates.
 *
 * Irreversible. Take a database backup first, then run:
 *
 *   CONFIRM=FRESH DATABASE_URL="<connection string>" \
 *     npm run db:fresh-start -w @phone-erp/api
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TRANSACTIONAL = [
  'CostEntry',
  'CostDocument',
  'ReturnItem',
  'Return',
  'TransferDevice',
  'TransferItem',
  'Shipment',
  'Transfer',
  'ReceiptLine',
  'Receipt',
  'PurchaseUnitLabel',
  'DeviceMovement',
  'Device',
  'SaleItem',
  'Sale',
  'PurchaseItem',
  'Purchase',
  'Lot',
  'StockMovement',
  'StockLevel',
  'Notification',
  'AuditLog',
  'DocumentCounter',
];

async function main(): Promise<void> {
  const counts: Record<string, number> = {};
  for (const table of TRANSACTIONAL) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`);
    counts[table] = Number(row.n);
  }
  console.table(counts);

  if (process.env.CONFIRM !== 'FRESH') {
    console.log('\nDry run — nothing deleted. Re-run with CONFIRM=FRESH to erase the rows above.');
    return;
  }

  // One statement, no CASCADE: if a kept table ever points at one of these,
  // Postgres refuses the whole thing instead of quietly emptying it too.
  await prisma.$executeRawUnsafe(`TRUNCATE ${TRANSACTIONAL.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\nFresh start done — ${total.toLocaleString()} rows erased. Set-up data is untouched.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
