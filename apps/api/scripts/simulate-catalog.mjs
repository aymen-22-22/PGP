/**
 * A whole catalogue, from purchase order to counter — and back.
 *
 * Where `simulate.mjs` follows one consignment of one handset, this builds a
 * small but realistic catalogue: several Apple, Samsung, Xiaomi, Oppo and
 * Realme models plus accessories, then runs each of them through the company.
 * Orders, goods-in with the validation gate, landed costs at every leg, two
 * cross-border transfers (France → Spain → Algeria), counter and POS sales,
 * customer returns, a stock take, the reports that must reconcile, and the
 * authorisation rules that must hold. Everything goes through the real HTTP
 * API — there are no shortcuts into the database.
 *
 * It is written to be run against an API that has receipt validation switched
 * ON, so the RECEIVED → IN_STOCK gate is genuinely exercised:
 *
 *   PORT=3100 REQUIRE_RECEIPT_VALIDATION=true node dist/main.js
 *   node scripts/simulate-catalog.mjs --url http://127.0.0.1:3100
 *
 * Options:
 *   --url          API base (default http://127.0.0.1:3000)
 *   --password     admin password (default Admin12345!)
 *   --pool         handsets ordered per model (default 6)
 *   --start        first test IMEI counter (default 20000)
 */
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const BASE = `${arg('url', 'http://127.0.0.1:3000')}/api/v1`;
const PASSWORD = arg('password', 'Admin12345!');
const STAFF_PASSWORD = arg('staff-password', 'Warehouse123!');
const POOL = Number(arg('pool', 6));
const START_IMEI = Number(arg('start', 20000));

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

// --- plumbing ---------------------------------------------------------------

let token = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One API call. Fires a day's work in seconds, which can trip the rate limiter;
 * the limiter is doing its job, so this backs off instead of loosening it.
 */
const request = async (method, path, body, attempt = 0) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => null);

  if (res.status === 429 && attempt < 8) {
    await sleep(500 * 2 ** attempt);
    return request(method, path, body, attempt + 1);
  }
  return { ok: res.ok, status: res.status, body: payload };
};

const api = async (method, path, body) => {
  const r = await request(method, path, body);
  if (!r.ok) {
    throw new Error(`${method} ${path} → ${r.status} ${r.body?.code ?? ''} ${r.body?.message ?? ''}`);
  }
  return r.body;
};
const get = (p) => api('GET', p);
const post = (p, b) => api('POST', p, b);
const del = (p) => api('DELETE', p);
const list = async (p) => {
  const r = await get(p);
  return r?.data ?? r;
};

const login = async (email, password) => (await post('/auth/login', { email, password })).accessToken;

// --- assertions -------------------------------------------------------------

let checks = 0;
let failures = 0;
const pass = (label) => {
  checks++;
  console.log(`   ${C.green}✓${C.reset} ${label}`);
};
const fail = (label, detail) => {
  checks++;
  failures++;
  console.log(`   ${C.red}✗ ${label}${detail ? ` — ${detail}` : ''}${C.reset}`);
};
/** Critical assertion: a failure stops the run, because later steps depend on it. */
const check = (cond, label, detail) => {
  if (cond) return pass(label);
  fail(label, detail);
  throw new Error(`stopped at: ${label}${detail ? ` (${detail})` : ''}`);
};
/** Non-critical: reported, but the walk continues. */
const soft = (cond, label, detail) => (cond ? pass(label) : fail(label, detail));

/** Asserts a call is refused, optionally with a specific machine code. */
const rejects = async (label, method, path, body, expectCode) => {
  const r = await request(method, path, body);
  if (r.ok) {
    fail(`${label} — should have been refused`, `got ${r.status}`);
    throw new Error(`expected refusal: ${label}`);
  }
  const code = r.body?.code ?? '';
  if (expectCode && code !== expectCode) {
    fail(`${label} — refused with ${code}`, `expected ${expectCode}`);
    throw new Error(`wrong refusal code: ${label}`);
  }
  pass(`${label} — refused (${r.status} ${code})`);
  return r;
};

const step = (n, title) => console.log(`\n${C.bold}${n}. ${title}${C.reset}`);
const say = (...p) => console.log('   ' + p.join(' '));
const rule = () => console.log('   ' + '─'.repeat(72));
const money = (a, c = 'EUR') =>
  `${c} ${Number(a).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Luhn check digit, so every scanned IMEI is one a handset could carry. */
const imeiFor = (n) => {
  const body = `99000000${String(n).padStart(6, '0')}`;
  let sum = 0;
  let double = true;
  for (let i = body.length - 1; i >= 0; i--) {
    let d = Number(body[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return body + String((10 - (sum % 10)) % 10);
};
let imeiCursor = START_IMEI;
const nextImeis = (count) => Array.from({ length: count }, () => imeiFor(imeiCursor++));

const landedCost = async (imei) => (await get(`/imeis/${imei}/history`)).device.landedCost;
const deviceStatus = async (imei) => (await get(`/imeis/${imei}/history`)).device.status;

// --- the catalogue we are going to build ------------------------------------

const MODELS = [
  {
    key: 'apple',
    brand: 'Apple',
    sku: 'APL-IP18PM-256-BLK',
    name: 'iPhone 18 Pro Max 256GB Black',
    model: 'iPhone 18 Pro Max',
    storage: '256GB',
    color: 'Black',
    buy: '900.00',
    sell: '980.00',
    pool: POOL + 4,
    partial: true,
    rich: true,
  },
  {
    key: 'galaxy-ultra',
    brand: 'Samsung',
    sku: 'SAM-S26U-512',
    name: 'Galaxy S26 Ultra 512GB Titanium Black',
    model: 'Galaxy S26 Ultra',
    storage: '512GB',
    color: 'Titanium Black',
    buy: '820.00',
    sell: '910.00',
    pool: POOL,
    rich: true,
  },
  {
    key: 'xiaomi-15-ultra',
    brand: 'Xiaomi',
    sku: 'XIA-15U-512',
    name: 'Xiaomi 15 Ultra 512GB Black',
    model: 'Xiaomi 15 Ultra',
    storage: '512GB',
    color: 'Black',
    buy: '700.00',
    sell: '820.00',
    pool: POOL,
    edge: true,
  },
  {
    key: 'redmi-note-14',
    brand: 'Xiaomi',
    sku: 'XIA-RN14P-256',
    name: 'Redmi Note 14 Pro 256GB Midnight Black',
    model: 'Redmi Note 14 Pro',
    storage: '256GB',
    color: 'Midnight Black',
    buy: '220.00',
    sell: '270.00',
    pool: POOL,
  },
  {
    key: 'oppo-find-x8',
    brand: 'Oppo',
    sku: 'OPP-FX8P-256',
    name: 'Oppo Find X8 Pro 256GB Space Black',
    model: 'Find X8 Pro',
    storage: '256GB',
    color: 'Space Black',
    buy: '650.00',
    sell: '760.00',
    pool: POOL,
  },
  {
    key: 'realme-gt7',
    brand: 'Realme',
    sku: 'REA-GT7P-256',
    name: 'Realme GT 7 Pro 256GB Galaxy Grey',
    model: 'GT 7 Pro',
    storage: '256GB',
    color: 'Galaxy Grey',
    buy: '500.00',
    sell: '600.00',
    pool: POOL,
  },
  {
    key: 'galaxy-a56',
    brand: 'Samsung',
    sku: 'SAM-A56-128',
    name: 'Galaxy A56 128GB Awesome Black',
    model: 'Galaxy A56',
    storage: '128GB',
    color: 'Awesome Black',
    buy: '300.00',
    sell: '360.00',
    pool: POOL,
  },
];

// --- shared context, filled in by main() ------------------------------------

let FR;
let ES;
let DZ;
let SUPPLIER;
let CUSTOMER;
const products = new Map();

// --- helpers ----------------------------------------------------------------

const ensureBrand = async (name, cache) => {
  if (cache.has(name)) return cache.get(name);
  const found = (await list('/brands')).find((b) => b.name === name);
  const id = found ? found.id : (await post('/brands', { name })).id;
  cache.set(name, id);
  return id;
};

const ensureProduct = async (def, brandId) => {
  const existing = (await get('/products?pageSize=100')).data.find((p) => p.sku === def.sku);
  if (existing) return existing;
  const created = await post('/products', {
    name: def.name,
    sku: def.sku,
    brandId,
    model: def.model,
    ...(def.storage ? { storage: def.storage } : {}),
    ...(def.color ? { color: def.color } : {}),
    ...(def.category ? { category: def.category } : {}),
    purchasePrice: def.buy,
    defaultSalePrice: def.sell,
    currency: 'EUR',
    tracking: def.tracking ?? 'SERIALIZED',
  });
  return created;
};

const receivePhones = (po, line, imeis, allowPartial = false) =>
  post(`/purchases/${po.id}/receive`, {
    lines: [{ purchaseItemId: line.id, imeis }],
    ...(allowPartial ? { allowPartial: true } : {}),
  });

/** Algeria sells in dinars — every handset needs a dinar price-list entry. */
const priceForAlgeria = async (def, product) => {
  const dz = `${Math.round(Number(def.sell) * 280)}.00`;
  await post(`/products/${product.id}/prices`, { price: dz, currency: 'DZD', countryId: DZ.countryId });
  const checked = await get(`/products/${product.id}/price?countryId=${DZ.countryId}`);
  check(checked.currency === 'DZD', `${def.sku} priced for the ${DZ.countryRef?.name} market at ${money(checked.price, 'DZD')}`);
  return checked;
};

/** Validates a receipt when the API is gate-keeping, and reports which mode it was in. */
const validateReceipt = async (receiptId, label) => {
  const before = await get(`/receipts/${receiptId}`);
  if (before.status === 'PENDING_VALIDATION') {
    await post(`/receipts/${receiptId}/validate`, {});
    const after = await get(`/receipts/${receiptId}`);
    check(after.status === 'VALIDATED', `${label}: receipt ${before.number} validated`);
  } else {
    soft(before.status === 'VALIDATED', `${label}: receipt ${before.number} auto-validated (gate off)`);
  }
  return get(`/receipts/${receiptId}`);
};

const postCost = async (label, spec, scope, scopeId) => {
  const doc = await post('/cost-documents', {
    type: spec.type,
    description: label,
    amount: spec.amount,
    currency: spec.currency,
    allocation: spec.allocation ?? 'QUANTITY',
    scope,
    scopeId,
    post: true,
  });
  say(`cost ${label.padEnd(36)} ${money(spec.amount, spec.currency)}`);
  return doc;
};

/** One cross-border leg: create/load, ship, landed costs, receive. */
const moveLeg = async ({ product, imeis, from, to, carrier, trackingRef, costs = [] }) => {
  const transfer = await post('/transfers', {
    sourceWarehouseId: from.id,
    destinationWarehouseId: to.id,
    items: [{ productId: product.id, quantity: imeis.length }],
    imeis,
    notes: `Catalog simulation — ${product.sku}`,
  });
  const shipped = await post(`/transfers/${transfer.id}/ship`, { carrier, trackingRef });

  const level = (await get(`/inventory?warehouseId=${from.id}&productId=${product.id}`)).data[0];
  soft(
    level && level.inTransfer === imeis.length,
    `${product.sku.padEnd(22)} ${imeis.length} left ${from.code}; ${from.code} shows ${level?.inStock ?? 0} on hand, ${level?.inTransfer ?? 0} in transit`,
  );

  for (const c of costs) await postCost(`[${product.sku}] ${c.label}`, c, 'SHIPMENT', transfer.id);

  const received = await post(`/transfers/${transfer.id}/receive`, { imeis });
  // With the validation gate on, the goods-in at the destination is itself a
  // pending receipt; the phones stay RECEIVED until it is validated.
  if (received.receiptId) await validateReceipt(received.receiptId, product.sku);
  return { transfer, shipped, received };
};

const completeSale = async (product, imeis, warehouse, { autoPick = false } = {}) => {
  const sale = await post('/sales', {
    customerId: CUSTOMER.id,
    warehouseId: warehouse.id,
    currency: 'DZD',
    items: [{ productId: product.id, quantity: imeis.length }],
    notes: `Catalog simulation — ${product.sku}`,
  });
  const done = await post(`/sales/${sale.id}/complete`, autoPick ? { autoPick: true } : { imeis });
  return { sale, done };
};

// --- one model, end to end --------------------------------------------------

const walkModel = async (def, product) => {
  const qty = def.pool;
  const imeis = nextImeis(qty);
  const tag = def.sku.padEnd(20);

  // 1 ── purchase order -----------------------------------------------------
  const po = await post('/purchases', {
    supplierId: SUPPLIER.id,
    warehouseId: FR.id,
    purchaseDate: new Date().toISOString(),
    currency: 'EUR',
    notes: `Catalog simulation — ${def.name}`,
    items: [{ productId: product.id, quantity: qty, unitPrice: def.buy }],
  });
  const line = po.items.find((i) => i.productId === product.id);
  say(`${tag} ${po.number} · ${qty} × ${def.name} @ ${money(def.buy)} · ${po.status}`);

  // 2 ── goods-in -----------------------------------------------------------
  // A duplicate IMEI inside one receipt must be refused outright, before
  // anything is written.
  if (def.edge) {
    await rejects(
      `${tag} duplicate IMEI in one receipt`,
      'POST',
      `/purchases/${po.id}/receive`,
      { lines: [{ purchaseItemId: line.id, imeis: [imeis[0], imeis[0]] }], allowPartial: true },
      'IMEI_DUPLICATE_IN_REQUEST',
    );
  }

  const arrived = def.partial ? qty - 3 : qty;
  const first = await receivePhones(po, line, imeis.slice(0, arrived), def.partial);
  if (def.partial) {
    const stillOpen = await get(`/purchases/${po.id}`);
    check(stillOpen.status === 'PARTIALLY_RECEIVED', `${tag} short delivery leaves the order PARTIALLY_RECEIVED`);
    say(`${tag} ${first.receiptNumber} · received ${first.scanned}/${first.expected} · missing ${first.missing}`);
  }
  await validateReceipt(first.receiptId, tag);

  if (def.partial) {
    const second = await receivePhones(po, line, imeis.slice(arrived));
    const closed = await get(`/purchases/${po.id}`);
    check(closed.status === 'RECEIVED', `${tag} remainder received, order now RECEIVED`);
    await validateReceipt(second.receiptId, tag);
  }

  // A newly-received phone must not be sellable until its receipt is validated.
  if (def.edge) {
    const gate = await post('/imeis/verify', { imei: imeis[0], expectStatus: 'IN_STOCK' });
    check(gate.accepted === true, `${tag} verified IMEI is accepted as sellable stock`);
  }

  // 3 ── landed cost on the French leg -------------------------------------
  await postCost(`[${def.sku}] unloading & inspection`, {
    type: 'HANDLING',
    amount: (qty * 4.5).toFixed(2),
    currency: 'EUR',
  }, 'RECEIPT', first.receiptId);
  const afterFrance = await landedCost(imeis[0]);

  // 4 ── France → Spain -----------------------------------------------------
  const toSpain = imeis.slice(0, qty - 2); // two handsets stay in France
  await moveLeg({
    product,
    imeis: toSpain,
    from: FR,
    to: ES,
    carrier: 'DHL Road',
    trackingRef: `DHL-FR-ES-${def.key}`,
    costs: [{ label: 'road freight Lyon → Barcelona', type: 'FREIGHT', amount: (toSpain.length * 12).toFixed(2), currency: 'EUR', allocation: 'VALUE' }],
  });

  // 5 ── Spain → Algeria ----------------------------------------------------
  await moveLeg({
    product,
    imeis: toSpain,
    from: ES,
    to: DZ,
    carrier: 'Sea + road',
    trackingRef: `MSC-ES-DZ-${def.key}`,
    costs: [
      { label: 'sea freight Barcelona → Algiers', type: 'FREIGHT', amount: (toSpain.length * 18).toFixed(2), currency: 'EUR', allocation: 'VALUE' },
      { label: 'Algerian customs duty', type: 'CUSTOMS', amount: (toSpain.length * 9000).toFixed(2), currency: 'DZD', allocation: 'VALUE' },
    ],
  });

  const arrivedDZ = await landedCost(imeis[0]);
  check(
    Number(arrivedDZ) > Number(def.buy),
    `${tag} landed cost ${money(arrivedDZ)} exceeds purchase ${money(def.buy)}`,
  );
  say(`${tag} cost build-up: purchase ${money(def.buy)} → France ${money(afterFrance)} → Algiers ${money(arrivedDZ)}`);

  // 6 ── sales --------------------------------------------------------------
  const dsImeis = await availableImeis(product.id, DZ.id);
  const normalCount = def.rich ? 2 : Math.min(2, dsImeis.length);

  let returnedFrom = [];
  if (def.rich) {
    const explicit = dsImeis.slice(0, 2);
    const { done } = await completeSale(product, explicit, DZ, {});
    check(done.status === 'COMPLETED' && done.devicesSold === 2, `${tag} counter sale completed (2 named IMEIs)`);
    say(`${tag} sold ${money(done.revenue)} · cost ${money(done.cost)}`);
    returnedFrom = explicit;
  }

  const autoImeis = (await availableImeis(product.id, DZ.id)).slice(0, normalCount);
  if (autoImeis.length > 0) {
    const { done } = await completeSale(product, autoImeis, DZ, { autoPick: true });
    check(done.status === 'COMPLETED', `${tag} auto-pick sale completed (${done.devicesSold} units)`);
  }

  // 7 ── returns (rich models only) ----------------------------------------
  if (def.rich && returnedFrom.length === 2) {
    const ret = await post('/returns', {
      customerId: CUSTOMER.id,
      warehouseId: DZ.id,
      reason: 'Customer return — catalog simulation',
      lines: [
        { imei: returnedFrom[0], outcome: 'RESTOCKED' },
        { imei: returnedFrom[1], outcome: 'DAMAGED' },
      ],
    });
    soft(!!(ret.number ?? ret.id), `${tag} return recorded ${ret.number ?? ''}`);
    check((await deviceStatus(returnedFrom[0])) === 'IN_STOCK', `${tag} restocked phone is back IN_STOCK`);
    check((await deviceStatus(returnedFrom[1])) === 'DAMAGED', `${tag} damaged phone is parked as DAMAGED`);

    // Returning a phone that is not currently sold must be refused.
    await rejects(
      `${tag} return of a phone that is no longer sold`,
      'POST',
      '/returns',
      { customerId: CUSTOMER.id, warehouseId: DZ.id, lines: [{ imei: returnedFrom[0] }] },
      'VALIDATION_FAILED',
    );
  }

  return { po, imeis };
};

const availableImeis = async (productId, warehouseId, status = 'IN_STOCK') => {
  const r = await get(`/inventory/devices?warehouseId=${warehouseId}&productId=${productId}&status=${status}&pageSize=100`);
  return (r.data ?? []).map((d) => d.imei);
};

// --- accessories (bulk) -----------------------------------------------------

const walkAccessories = async (cable, glass) => {
  const cableQty = 200;
  const glassQty = 100;

  const po = await post('/purchases', {
    supplierId: SUPPLIER.id,
    warehouseId: FR.id,
    currency: 'EUR',
    notes: 'Catalog simulation — accessories',
    items: [
      { productId: cable.id, quantity: cableQty, unitPrice: cable.purchasePrice },
      { productId: glass.id, quantity: glassQty, unitPrice: glass.purchasePrice },
    ],
  });
  const cableLine = po.items.find((i) => i.productId === cable.id);
  const glassLine = po.items.find((i) => i.productId === glass.id);
  say(`${po.number} · ${cableQty} × ${cable.name} · ${glassQty} × ${glass.name}`);

  // Over-receipt of a counted line must be refused.
  await rejects(
    'accessory over-receipt (500 against 200 ordered)',
    'POST',
    `/purchases/${po.id}/receive`,
    { lines: [{ purchaseItemId: cableLine.id, quantity: 500 }] },
    'QUANTITY_EXCEEDED',
  );

  const receipt = await post(`/purchases/${po.id}/receive`, {
    lines: [
      { purchaseItemId: cableLine.id, quantity: cableQty },
      { purchaseItemId: glassLine.id, quantity: glassQty },
    ],
  });
  await validateReceipt(receipt.receiptId, 'accessories');
  say(`accessories received at ${FR.code} · ${receipt.scanned} units`);

  // Note: the landed-cost documents are per-device (IMEI), so a receipt or
  // shipment that carries only counted accessories resolves to no units and
  // cannot take a HANDLING/FREIGHT/CUSTOMS allocation. Bulk cost rides the
  // weighted average the stock ledger already keeps.

  // Move most of them to the Algerian shop, in two legs.
  const cableFR = (await get(`/stock?warehouseId=${FR.id}&search=${cable.sku}`)).data[0];
  const glassFR = (await get(`/stock?warehouseId=${FR.id}&search=${glass.sku}`)).data[0];
  const cableMove = Math.floor(cableFR.quantity * 0.75);
  const glassMove = Math.floor(glassFR.quantity * 0.75);

  const leg1 = await post('/transfers', {
    sourceWarehouseId: FR.id,
    destinationWarehouseId: ES.id,
    items: [
      { productId: cable.id, quantity: cableMove },
      { productId: glass.id, quantity: glassMove },
    ],
  });
  await post(`/transfers/${leg1.id}/ship`, { carrier: 'DHL Road', trackingRef: 'DHL-ACC-FR-ES' });
  const recv1 = await post(`/transfers/${leg1.id}/receive`, {});
  if (recv1.receiptId) await validateReceipt(recv1.receiptId, 'ACC FR→ES');
  soft(['RECEIVED', 'COMPLETED'].includes(recv1.status), `accessories reached ${ES.code}`);

  const leg2 = await post('/transfers', {
    sourceWarehouseId: ES.id,
    destinationWarehouseId: DZ.id,
    items: [
      { productId: cable.id, quantity: cableMove },
      { productId: glass.id, quantity: glassMove },
    ],
  });
  await post(`/transfers/${leg2.id}/ship`, { carrier: 'Sea + road', trackingRef: 'MSC-ACC-ES-DZ' });
  const recv2 = await post(`/transfers/${leg2.id}/receive`, {});
  if (recv2.receiptId) await validateReceipt(recv2.receiptId, 'ACC ES→DZ');
  soft(['RECEIVED', 'COMPLETED'].includes(recv2.status), `accessories reached ${DZ.code}`);

  const shelf = (await get(`/stock?warehouseId=${DZ.id}`)).data;
  const cableDZ = shelf.find((s) => s.sku === cable.sku);
  check(cableDZ && cableDZ.quantity > 0, `accessories on the ${DZ.code} shelf (${cableDZ?.quantity ?? 0} cables)`);
  say(`weighted-average cost of a cable now ${money(cableDZ?.avgUnitCost ?? 0)}`);

  // A stock take finds one fewer cable than the books say.
  const counted = Math.max(0, cableDZ.quantity - 1);
  const adj = await post('/stock/adjust', {
    productId: cable.id,
    warehouseId: DZ.id,
    countedQuantity: counted,
    reason: 'Stock take — one cable missing',
  });
  check(adj.after === counted && adj.delta === -1, `stock take corrected the shelf ${adj.before} → ${adj.after} (${adj.delta})`);

  return { cable, glass, cableDZ };
};

// --- reports and the books --------------------------------------------------

const readTheBooks = async (accessory, stepNo) => {
  step(stepNo, 'The books');

  const dash = await get('/reports/dashboard');
  rule();
  say(`stock value      ${money(dash.stockValue)}`);
  say(`revenue          ${money(dash.financials.revenue)}`);
  say(`cost of sales    ${money(dash.financials.purchaseCost)}`);
  say(`gross profit     ${money(dash.financials.profit)}   ·  margin ${dash.financials.margin}%`);
  rule();
  const arith = Number(dash.financials.revenue) - Number(dash.financials.purchaseCost);
  soft(
    Math.abs(arith - Number(dash.financials.profit)) < 0.05,
    `dashboard: profit = revenue − cost (${money(dash.financials.profit)})`,
    `off by ${(arith - Number(dash.financials.profit)).toFixed(2)}`,
  );
  check(Number(dash.stockValue) >= 0, 'dashboard stock value is non-negative');

  const byProduct = (await get('/reports/profit-by-product')).data ?? [];
  soft(byProduct.length >= 3, `profit by product covers ${byProduct.length} products`);
  for (const row of byProduct.slice(0, 5)) {
    say(`   ${String(row.productName ?? row.name ?? row.sku).padEnd(34)} revenue ${money(row.revenue ?? 0)} · profit ${money(row.profit ?? 0)}`);
  }

  for (const ledger of ['stock-value', 'revenue', 'cost', 'profit']) {
    const r = await get(`/reports/ledger/${ledger}`);
    soft(Array.isArray(r.data), `ledger ${ledger.padEnd(12)} returns ${r.data?.length ?? 0} rows`);
  }

  const audit = await get('/audit-logs');
  const actions = new Set((audit.data ?? []).map((a) => a.action));
  soft((audit.meta?.total ?? 0) > 0, `audit log holds ${audit.meta?.total ?? 0} entries`);
  soft(actions.has('COMPLETE_SALE'), 'audit log records sale completions');

  // Stock explorer, the 360° view the UI drives.
  try {
    const warehouses = await list('/stock-explorer/warehouses');
    const dz = (Array.isArray(warehouses) ? warehouses : []).find((w) => w.code === DZ.code || w.id === DZ.id) ?? warehouses?.[0];
    soft(!!dz, `stock explorer knows ${DZ.code}`);
    if (dz) {
      const cats = await list(`/stock-explorer/warehouses/${dz.id}/categories`);
      soft(Array.isArray(cats), `stock explorer lists ${cats.length} categories in ${DZ.code}`);
      const cat = cats.find((c) => (c.category ?? c.name) === 'Accessory') ?? cats[0];
      if (cat) {
        const prods = await list(`/stock-explorer/warehouses/${dz.id}/categories/${encodeURIComponent(cat.category ?? cat.name)}/products`);
        soft(Array.isArray(prods), `stock explorer lists ${prods.length} accessory products`);
      }
      const detail = await get(`/stock-explorer/warehouses/${dz.id}/products/${accessory.cableDZ.productId}`);
      soft(!!detail, 'stock explorer product detail loads');
    }
  } catch (e) {
    soft(false, 'stock explorer reachable', e.message);
  }

  // IMEI search and traceability.
  const sample = (await list('/inventory/devices?status=SOLD&pageSize=5'))[0];
  if (sample) {
    const search = await list(`/imeis/search?q=${sample.imei.slice(-6)}&limit=5`);
    soft(Array.isArray(search) && search.length > 0, `IMEI search finds ${sample.imei.slice(-6)}`);
    const history = await get(`/imeis/${sample.imei}/history`);
    soft((history.movements?.length ?? 0) > 0, `traceability: sold phone has ${history.movements?.length ?? 0} movements`);
  }
};

// --- authorisation ----------------------------------------------------------

const assertAuthorisation = async (stepNo) => {
  step(stepNo, 'Who is allowed to do what');

  const adminToken = token;
  const adminFR = (await get(`/inventory?warehouseId=${FR.id}`)).data.length;

  // Amina is a warehouse user bound to DZ-01.
  token = await login('amina@phone-erp.local', STAFF_PASSWORD);
  await rejects(
    `warehouse user reading ${FR.code} stock`,
    'GET',
    `/inventory?warehouseId=${FR.id}`,
    undefined,
    'WAREHOUSE_FORBIDDEN',
  );
  const aminaAll = (await get('/inventory')).data;
  const leaked = aminaAll.filter((r) => r.warehouseId === FR.id).length;
  check(
    aminaAll.length > 0 && leaked === 0 && adminFR > 0,
    `warehouse user sees ${aminaAll.length} of their own rows and none of ${FR.code} (admin sees ${adminFR})`,
  );

  await rejects(
    'warehouse user creating a purchase (admin-only route)',
    'POST',
    '/purchases',
    { supplierId: SUPPLIER.id, warehouseId: FR.id, currency: 'EUR', items: [{ productId: products.get('apple').id, quantity: 1, unitPrice: '900.00' }] },
    'FORBIDDEN',
  );

  await rejects(
    'warehouse user transferring from France',
    'POST',
    '/transfers',
    { sourceWarehouseId: FR.id, destinationWarehouseId: DZ.id, items: [{ productId: products.get('apple').id, quantity: 1 }] },
    'WAREHOUSE_FORBIDDEN',
  );

  await rejects('warehouse user creating a brand', 'POST', '/brands', { name: 'Should Not Exist' }, 'FORBIDDEN');

  // …but they can sell from their own shop.
  const shelved = await availableImeis(products.get('apple').id, DZ.id);
  if (shelved.length > 0) {
    const { done } = await completeSale(products.get('apple'), [shelved[0]], DZ, {});
    soft(done.status === 'COMPLETED', 'warehouse user completed a sale from their own warehouse');
  }

  token = adminToken;
};

// --- optional edge cases ----------------------------------------------------

const assertTransferEdgeCases = async (product) => {
  // auto-fill, unload one device, then cancel the draft.
  const draft = await post('/transfers', {
    sourceWarehouseId: FR.id,
    destinationWarehouseId: ES.id,
    items: [{ productId: product.id, quantity: 2 }],
    autoFill: true,
    notes: 'Catalog simulation — transfer edge cases',
  });
  const full = await get(`/transfers/${draft.id}`);
  const loaded = full.devices ?? full.items?.flatMap((i) => i.devices ?? []) ?? [];
  const imei = loaded[0]?.imei ?? loaded[0]?.device?.imei;

  if (imei) {
    const afterRemove = await del(`/transfers/${draft.id}/devices/${imei}`);
    soft(!!afterRemove, 'transfer auto-fill loaded devices and one was unloaded');
  } else {
    soft(false, 'transfer auto-fill loaded devices', 'no devices surfaced in the transfer detail');
  }

  const cancelled = await post(`/transfers/${draft.id}/cancel`, {});
  soft(['CANCELLED'].includes(cancelled.status), 'draft transfer cancelled');
};

const assertSaleGuards = async (product, warehouse) => {
  const imeis = await availableImeis(product.id, warehouse.id);
  if (imeis.length < 2) return;

  const sale = await post('/sales', {
    customerId: CUSTOMER.id,
    warehouseId: warehouse.id,
    currency: 'DZD',
    items: [{ productId: product.id, quantity: 1 }],
  });

  // Selling a phone that is not in this warehouse must fail.
  const elsewhere = (
    await list(`/inventory/devices?productId=${product.id}&status=IN_STOCK&pageSize=100`)
  ).find((d) => d.currentWarehouse?.id !== warehouse.id);
  if (elsewhere) {
    await rejects(
      'sale of a phone held in another warehouse',
      'POST',
      `/sales/${sale.id}/complete`,
      { imeis: [elsewhere.imei] },
      'IMEI_WRONG_WAREHOUSE',
    );
  } else {
    soft(false, 'a phone held in another warehouse exists to test the guard', 'none found');
  }

  const done = await post(`/sales/${sale.id}/complete`, { imeis: [imeis[0]] });
  check(done.status === 'COMPLETED', 'sale completes once the right IMEI is scanned');
  await rejects(
    're-completing a completed sale',
    'POST',
    `/sales/${sale.id}/complete`,
    { imeis: [imeis[1]] },
    'INVALID_STATUS_TRANSITION',
  );

  // A draft sale can be cancelled.
  const draft = await post('/sales', {
    customerId: CUSTOMER.id,
    warehouseId: warehouse.id,
    currency: 'DZD',
    items: [{ productId: product.id, quantity: 1 }],
  });
  const cancelled = await post(`/sales/${draft.id}/cancel`, {});
  soft(cancelled.status === 'CANCELLED', 'draft sale cancelled');
};

// --- run --------------------------------------------------------------------

const run = async () => {
  console.log(`\n${C.bold}PGP — a whole catalogue, purchase order to counter${C.reset}`);
  console.log(`   ${MODELS.length} models × ${POOL}+ handsets · accessories · ${BASE}`);
  if (!process.env.CI) console.log(`   ${C.dim}expects an API with REQUIRE_RECEIPT_VALIDATION=true${C.reset}`);

  const auth = await post('/auth/login', { email: 'admin@phone-erp.local', password: PASSWORD });
  token = auth.accessToken;

  const warehouses = await get('/warehouses');
  FR = warehouses.find((w) => w.code === 'FR-01');
  ES = warehouses.find((w) => w.code === 'ES-01');
  DZ = warehouses.find((w) => w.code === 'DZ-01');
  SUPPLIER = (await list('/suppliers'))[0];
  CUSTOMER = (await list('/customers')).find((c) => c.name === 'Algiers Distributor') ?? (await list('/customers'))[0];
  say(`signed in as admin · chain ${FR.code} → ${ES.code} → ${DZ.code} · supplier ${SUPPLIER.name} · customer ${CUSTOMER.name}`);

  // ---- catalogue build ----------------------------------------------------
  step(1, 'Building the catalogue');
  const brandCache = new Map();
  const apple = (await get('/products?pageSize=100')).data.find((p) => p.sku === 'APL-IP18PM-256-BLK');
  products.set('apple', apple);
  say(`existing ${C.cyan}APL-IP18PM-256-BLK${C.reset} · ${apple.name}`);

  for (const def of MODELS) {
    if (def.sku === 'APL-IP18PM-256-BLK') {
      products.set(def.key, apple);
      continue;
    }
    const brandId = await ensureBrand(def.brand, brandCache);
    const p = await ensureProduct(def, brandId);
    products.set(def.key, p);
    say(`brand ${def.brand.padEnd(10)} product ${C.cyan}${p.sku}${C.reset} · ${p.name}`);
  }

  const accessories = (await get('/products?pageSize=100')).data.filter((p) => p.tracking === 'BULK');
  const cable = accessories.find((p) => p.sku === 'ACC-USBC-2M');
  const glass = accessories.find((p) => p.sku === 'ACC-GLASS-UNI');
  say(`accessories ready: ${accessories.map((a) => a.sku).join(', ')}`);

  // Algeria sells in dinars, so every handset needs a dinar price-list entry
  // before it can share a till with a dinar-priced accessory.
  for (const def of MODELS) {
    const p = products.get(def.key);
    if (p.tracking !== 'SERIALIZED') continue;
    await priceForAlgeria(def, p);
  }

  // ---- walk every model ---------------------------------------------------
  let n = 1;
  const walked = [];
  for (const def of MODELS) {
    n++;
    step(n, `Walk — ${def.brand} ${def.model}`);
    const result = await walkModel(def, products.get(def.key));
    walked.push({ def, ...result });
  }

  // ---- edge cases on one model -------------------------------------------
  n++;
  step(n, 'Transfer edge cases (auto-fill · unload · cancel)');
  await assertTransferEdgeCases(products.get('xiaomi-15-ultra'));

  // ---- accessories --------------------------------------------------------
  n++;
  step(n, 'Accessories — bulk stock');
  const accessory = await walkAccessories(cable, glass);

  // ---- a mixed POS sale ---------------------------------------------------
  n++;
  step(n, 'A mixed sale at the till');
  const phoneOnShelf = (await availableImeis(products.get('galaxy-ultra').id, DZ.id))[0]
    ?? (await availableImeis(products.get('apple').id, DZ.id))[0];
  if (phoneOnShelf) {
    const lookup = await post('/pos/lookup', { imei: phoneOnShelf, warehouseId: DZ.id });
    check(lookup.sellable === true, `till lookup says ${phoneOnShelf} is sellable`);
    const pos = await post('/pos/sales', {
      warehouseId: DZ.id,
      lines: [{ imei: phoneOnShelf }],
      items: [
        { productId: cable.id, quantity: 2 },
        { productId: glass.id, quantity: 1 },
      ],
      notes: 'Catalog simulation — mixed POS sale',
    });
    check(pos.number && pos.lines.length >= 3, `POS sale ${pos.number} mixes a handset and accessories`);
    say(`total ${money(pos.total, pos.currency)} · in euros ${money(pos.totalInBase)} · cost ${money(pos.cost)} · profit ${money(pos.grossProfit)}`);
  } else {
    soft(false, 'a handset is on the till shelf to sell');
  }

  // ---- sales guards -------------------------------------------------------
  n++;
  step(n, 'Sale guards');
  await assertSaleGuards(products.get('oppo-find-x8') ?? products.get('redmi-note-14'), DZ);

  // ---- the books ----------------------------------------------------------
  n++;
  await readTheBooks(accessory, n);

  // ---- authorisation ------------------------------------------------------
  n++;
  await assertAuthorisation(n);

  // ---- summary ------------------------------------------------------------
  step(++n, 'Summary');
  const dash = await get('/reports/dashboard');
  const inventory = (await get('/inventory')).data.filter((r) => r.inStock > 0);
  rule();
  say('PRODUCT'.padEnd(36), 'WAREHOUSE'.padEnd(20), 'AVAILABLE');
  for (const row of inventory) {
    say(
      String(row.productName).slice(0, 34).padEnd(36),
      String(row.warehouseName).padEnd(20),
      String(row.inStock).padStart(6),
      row.tracking === 'BULK' ? ' (counted units)' : '',
    );
  }
  rule();
  say(`models walked     ${walked.length}`);
  say(`stock value       ${money(dash.stockValue)}`);
  say(`revenue           ${money(dash.financials.revenue)}`);
  say(`gross profit      ${money(dash.financials.profit)} · margin ${dash.financials.margin}%`);
  rule();

  const colour = failures === 0 ? C.green : C.red;
  console.log(`\n${colour}${checks - failures}/${checks} assertions passed${failures ? `, ${failures} failed` : ''}${C.reset}`);
  console.log(`${C.dim}Every figure above came back from the API.${C.reset}\n`);
  if (failures > 0) process.exit(1);
};

run().catch((err) => {
  console.error(`\n${C.red}Stopped: ${err.message}${C.reset}`);
  console.error(`${C.dim}${checks} assertions ran, ${failures} failed, before the run stopped.${C.reset}\n`);
  process.exit(1);
});
