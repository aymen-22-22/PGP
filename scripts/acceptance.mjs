#!/usr/bin/env node
/**
 * End-to-end acceptance check, driven entirely through the public REST API —
 * no database access, no internal imports.
 *
 * It walks the real chain: buy into France, move part of the stock to Spain,
 * then to Algeria, posting handling, freight and customs at every leg, and
 * sells in Algeria. It then lands a late invoice to prove history restates.
 *
 *     npm run db:reset -w @phone-erp/api && npm run db:seed -w @phone-erp/api
 *
 *     # in another terminal — the limits are lifted only for this burst of calls
 *     THROTTLE_LIMIT=100000 THROTTLE_LOGIN_LIMIT=100000 npm run start:prod -w @phone-erp/api
 *
 *     npm run acceptance
 *
 * Point it elsewhere with API_URL, and supply the seeded passwords if changed:
 *   API_URL=https://erp.example.com/api/v1 ADMIN_PASSWORD=… npm run acceptance
 *
 * Exits 0 when every check passes, 1 otherwise.
 */
const BASE = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin12345!';
const USER_PASSWORD = process.env.USER_PASSWORD ?? 'Warehouse123!';

const imei = (i) => {
  const p = `99000000${String(i).padStart(6, '0')}`;
  let s = 0, d = true;
  for (let k = p.length - 1; k >= 0; k--) { let x = +p[k]; if (d) { x *= 2; if (x > 9) x -= 9; } s += x; d = !d; }
  return p + String((10 - (s % 10)) % 10);
};

let fails = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }

  // This script fires a few hundred calls in a burst, which is exactly what the
  // rate limiter exists to stop. Say so plainly instead of failing obscurely.
  if (res.status === 429) {
    console.error(
      `\nRate limited on ${method} ${path}.\n\n` +
        'This script makes several hundred requests in a few seconds, so the default\n' +
        'limits will stop it. Run the API with them raised:\n\n' +
        '  THROTTLE_LIMIT=100000 THROTTLE_LOGIN_LIMIT=100000 npm run start:prod -w @phone-erp/api\n\n' +
        'The limits are correct for real use — only this verification run needs them lifted.\n',
    );
    process.exit(2);
  }
  return { status: res.status, body: json };
}
const login = async (email, password) => {
  const res = await api(null, 'POST', '/auth/login', { email, password });
  if (res.status !== 200) {
    console.error(`\nCould not sign in as ${email}: ${res.body?.message ?? res.status}\n`);
    process.exit(2);
  }
  return res.body;
};
const landed = async (t, im) => (await api(t, 'GET', `/imeis/${im}`)).body.landedCost;
const postCost = async (t, body) => {
  const r = await api(t, 'POST', '/cost-documents', body);
  if (r.status !== 201 && r.status !== 200) throw new Error(`cost failed: ${JSON.stringify(r.body)}`);
  return r.body;
};

console.log('\n=== Phone ERP acceptance: France → Spain → Algeria with landed costing ===\n');

const admin = await login('admin@phone-erp.local', ADMIN_PASSWORD);
ok('Admin signs in', !!admin.accessToken);
const A = admin.accessToken;
const J = (await login('jean@phone-erp.local', USER_PASSWORD)).accessToken;
const C = (await login('carlos@phone-erp.local', USER_PASSWORD)).accessToken;
const M = (await login('amina@phone-erp.local', USER_PASSWORD)).accessToken;
ok('France, Spain and Algeria users sign in', !!J && !!C && !!M);

const whs = (await api(A, 'GET', '/warehouses')).body;
const FR = whs.find((w) => w.code === 'FR-01');
const ES = whs.find((w) => w.code === 'ES-01');
const DZ = whs.find((w) => w.code === 'DZ-01');
ok('Six warehouses across three countries', whs.length >= 6, whs.map((w) => w.code).join(', '));

const po = (await api(A, 'GET', '/purchases')).body.data[0];
const det = (await api(A, 'GET', `/purchases/${po.id}`)).body;
const PROD = det.items[0].productId;
ok('Purchase of 1,000 units at €900 into France', det.items[0].quantity === 1000, po.number);

console.log('\n--- Goods in at France ---\n');
const rec = await api(A, 'POST', `/purchases/${po.id}/receive`, {
  lines: [{ purchaseItemId: det.items[0].id, imeis: Array.from({ length: 1000 }, (_, i) => imei(i + 1)) }],
});
ok('1,000 IMEIs received', rec.body.scanned === 1000, `scanned ${rec.body.scanned}, missing ${rec.body.missing}`);
const lotId = rec.body.lotIds?.[0];
ok('A lot was opened for the batch', !!lotId);
{ const v = await landed(A, imei(1));
  ok('Landed cost starts at the purchase price', v === '900.00', String(v)); }

await postCost(A, { type: 'HANDLING', description: 'France unloading', amount: '5000.00', currency: 'EUR',
  allocation: 'QUANTITY', scope: 'LOT', scopeId: lotId });
{ const v = await landed(A, imei(1));
  ok('France handling €5/unit → €905', v === '905.00', String(v)); }

console.log('\n--- Partial shipment: 500 of 1,000 to Spain ---\n');
const t1 = (await api(A, 'POST', '/transfers', { sourceWarehouseId: FR.id, destinationWarehouseId: ES.id,
  items: [{ productId: PROD, quantity: 500 }], autoFill: true })).body;
await api(A, 'POST', `/transfers/${t1.id}/ship`, { carrier: 'Road freight' });
await postCost(A, { type: 'FREIGHT', description: 'Lyon → Barcelona', amount: '10000.00', currency: 'EUR',
  allocation: 'QUANTITY', scope: 'SHIPMENT', scopeId: t1.id });
const shipped = (await api(C, 'GET', `/transfers/${t1.id}`)).body.devices.map((d) => d.imei);
ok('Only the 500 shipped carry the freight → €925', (await landed(A, shipped[0])) === '925.00', await landed(A, shipped[0]));
const stayed = Array.from({ length: 1000 }, (_, i) => imei(i + 1)).find((x) => !shipped.includes(x));
ok('The 500 left in France are untouched → €905', (await landed(A, stayed)) === '905.00', await landed(A, stayed));

const rc1 = await api(C, 'POST', `/transfers/${t1.id}/receive`, { imeis: shipped });
ok('Spain receives all 500', rc1.body.scanned === 500 && rc1.body.missing === 0, `by ${rc1.body.receivedBy}`);
await postCost(A, { type: 'HANDLING', description: 'Spain handling', amount: '1500.00', currency: 'EUR',
  allocation: 'QUANTITY', scope: 'RECEIPT', scopeId: rc1.body.receiptId });
ok('Spain handling → €928', (await landed(A, shipped[0])) === '928.00', await landed(A, shipped[0]));

console.log('\n--- Spain → Algeria, customs billed in dinars ---\n');
const t2 = (await api(A, 'POST', '/transfers', { sourceWarehouseId: ES.id, destinationWarehouseId: DZ.id,
  items: [{ productId: PROD, quantity: 500 }], autoFill: true })).body;
await api(A, 'POST', `/transfers/${t2.id}/ship`, { carrier: 'Sea freight' });
await postCost(A, { type: 'FREIGHT', description: 'Barcelona → Algiers', amount: '20000.00', currency: 'EUR',
  allocation: 'QUANTITY', scope: 'SHIPMENT', scopeId: t2.id });
await postCost(A, { type: 'INSURANCE', description: 'Marine cover', amount: '1000.00', currency: 'EUR',
  allocation: 'QUANTITY', scope: 'SHIPMENT', scopeId: t2.id });
const inDz = (await api(M, 'GET', `/transfers/${t2.id}`)).body.devices.map((d) => d.imei);
const rc2 = await api(M, 'POST', `/transfers/${t2.id}/receive`, { imeis: inDz });
ok('Algeria receives all 500', rc2.body.scanned === 500, `by ${rc2.body.receivedBy}`);

const customs = await postCost(A, { type: 'CUSTOMS', description: 'Algerian import duty', amount: '8400000.00',
  currency: 'DZD', allocation: 'QUANTITY', scope: 'RECEIPT', scopeId: rc2.body.receiptId });
ok('Dinar bill converted at 280 → €30,000', customs.amountBase === '30000.00',
  `${customs.amount} DZD @ ${customs.exchangeRate}`);
await postCost(A, { type: 'HANDLING', description: 'Algeria handling', amount: '560000.00', currency: 'DZD',
  allocation: 'QUANTITY', scope: 'RECEIPT', scopeId: rc2.body.receiptId });
ok('Full landed cost in Algeria → €1,034', (await landed(A, inDz[0])) === '1034.00', await landed(A, inDz[0]));

console.log('\n--- Sell in Algeria ---\n');
const customer = (await api(M, 'GET', '/customers')).body.data[0];
const sale = (await api(M, 'POST', '/sales', { customerId: customer.id,
  items: [{ productId: PROD, quantity: 100, unitPrice: '1200.00' }] })).body;
const done = await api(M, 'POST', `/sales/${sale.id}/complete`, { imeis: inDz.slice(0, 100) });
ok('100 sold at €1,200', done.body.devicesSold === 100, `revenue ${done.body.revenue}, cost ${done.body.cost}`);
ok('Cost booked at landed, not purchase price', done.body.cost === '103400.00', done.body.cost);

const dash = (await api(A, 'GET', '/reports/dashboard')).body;
ok('Dashboard profit uses landed cost',
  dash.financials.revenue === '120000.00' && dash.financials.purchaseCost === '103400.00',
  `${dash.financials.revenue} − ${dash.financials.purchaseCost} = ${dash.financials.profit}`);

console.log('\n--- A late invoice restates history ---\n');
const late = await postCost(A, { type: 'FREIGHT', description: 'Late inland haulage', amount: '5000.00',
  currency: 'EUR', allocation: 'QUANTITY', scope: 'SHIPMENT', scopeId: t2.id });
ok('Late invoice restated the completed sale', late.restatedSales === 1, `restatedSales=${late.restatedSales}`);
ok('Sold unit landed cost restated → €1,044', (await landed(A, inDz[0])) === '1044.00', await landed(A, inDz[0]));
const restated = (await api(M, 'GET', `/sales/${sale.id}`)).body;
ok('Past sale cost restated → €104,400', restated.totalCost === '104400.00', restated.totalCost);

const rebuilt = await api(A, 'POST', '/costing/rebuild');
ok('Landed costs reconcile to the ledger', rebuilt.status === 200 && (await landed(A, inDz[0])) === '1044.00',
  `${rebuilt.body.devices} devices checked`);

console.log('\n--- Traceability and warehouse isolation ---\n');
const hist = (await api(A, 'GET', `/imeis/${inDz[0]}/history`)).body;
ok('Full chain recorded',
  hist.movements.map((m) => m.type).join(' → ') === 'PURCHASE_RECEIPT → TRANSFER_OUT → TRANSFER_IN → TRANSFER_OUT → TRANSFER_IN → SALE',
  hist.movements.map((m) => m.type).join(' → '));
ok('Jean cannot read Algeria stock', (await api(J, 'GET', `/inventory/${DZ.id}`)).status === 403);
ok('Carlos cannot read France stock', (await api(C, 'GET', `/inventory/${FR.id}`)).status === 403);
ok('Warehouse user cannot list users', (await api(M, 'GET', '/users')).status === 403);
ok('Unauthenticated request rejected', (await api(null, 'GET', '/inventory')).status === 401);

console.log(`\n=== ${fails === 0 ? 'ALL CHECKS PASSED' : `${fails} CHECK(S) FAILED`} ===\n`);
process.exit(fails === 0 ? 0 : 1);
