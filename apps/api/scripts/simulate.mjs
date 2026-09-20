/**
 * Walks one consignment through the whole business, start to finish.
 *
 * Phones leave China on a purchase order into France, move France → Spain →
 * Algeria picking up handling, freight and customs at each leg, and are sold
 * over the counter in Algiers alongside accessories. Everything runs through
 * the real HTTP API — there are no shortcuts into the database — so whatever
 * this prints is what the system actually does.
 *
 *   node scripts/simulate.mjs [--phones 40] [--url http://127.0.0.1:3000]
 */
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const BASE = `${arg('url', 'http://127.0.0.1:3000')}/api/v1`;
const PHONES = Number(arg('phones', 40));
const ADMIN = { email: 'admin@phone-erp.local', password: arg('password', 'Admin12345!') };

// --- plumbing ---------------------------------------------------------------

let token = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One API call, with a back-off on 429.
 *
 * A simulation fires a day's work in a few seconds and trips the rate limiter,
 * which is the limiter doing its job — a real warehouse never scans this fast.
 * So the script waits and retries rather than the limiter being loosened to
 * accommodate a script.
 */
const call = async (method, path, body, attempt = 0) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => null);

  if (res.status === 429 && attempt < 6) {
    await sleep(1000 * 2 ** attempt);
    return call(method, path, body, attempt + 1);
  }
  if (res.status >= 400) {
    throw new Error(`${method} ${path} → ${res.status} ${payload?.code ?? ''} ${payload?.message ?? ''}`);
  }
  return payload;
};
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);

const money = (amount, currency = 'EUR') =>
  `${currency} ${Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const step = (n, title) => console.log(`\n\x1b[1m${n}. ${title}\x1b[0m`);

/** Times one call so the heavy steps report what they actually cost. */
const timed = async (label, fn) => {
  const started = Date.now();
  const result = await fn();
  console.log(`   \x1b[2m${label} took ${Date.now() - started} ms\x1b[0m`);
  return result;
};
const say = (...parts) => console.log('   ' + parts.join(' '));
const rule = () => console.log('   ' + '─'.repeat(64));

/** Luhn check digit, so the simulation scans IMEIs a real handset could carry. */
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

/** Landed cost of one named handset, straight from the traceability endpoint. */
const landedCost = async (imei) => (await get(`/imeis/${imei}/history`)).device.landedCost;

// --- the walk ---------------------------------------------------------------

const run = async () => {
  console.log('\x1b[1m\nPGP — one consignment, end to end\x1b[0m');
  console.log(`   ${PHONES} handsets · ${BASE}`);

  const auth = await post('/auth/login', ADMIN);
  token = auth.accessToken;

  const warehouses = await get('/warehouses');
  const FR = warehouses.find((w) => w.code === 'FR-01');
  const ES = warehouses.find((w) => w.code === 'ES-01');
  const DZ = warehouses.find((w) => w.code === 'DZ-01');

  const suppliers = await get('/suppliers');
  const supplier = (suppliers.data ?? suppliers)[0];
  const products = (await get('/products?pageSize=100')).data;
  const phone = products.find((p) => p.tracking === 'SERIALIZED');
  const cable = products.find((p) => p.sku === 'ACC-USBC-2M');
  const glass = products.find((p) => p.sku === 'ACC-GLASS-UNI');

  // Start the IMEI run past anything the seed already used.
  const existing = (await get(`/inventory/devices?pageSize=1`)).meta.total;
  const firstImei = 5000 + existing;
  const imeis = Array.from({ length: PHONES }, (_, i) => imeiFor(firstImei + i));

  // ---------------------------------------------------------------- 1. order
  step(1, `Purchase order — ${supplier.name} → ${FR.name}`);
  const unitPrice = '900.00';
  const po = await post('/purchases', {
    supplierId: supplier.id,
    warehouseId: FR.id,
    purchaseDate: new Date().toISOString(),
    currency: 'EUR',
    items: [
      { productId: phone.id, quantity: PHONES, unitPrice },
      { productId: cable.id, quantity: 200, unitPrice: '2.10' },
    ],
  });
  say(po.number, '·', `${PHONES} × ${phone.name}`, 'at', money(unitPrice));
  say(' '.repeat(po.number.length), '·', `200 × ${cable.name}`, 'at', money('2.10'));
  say('total', money(po.totalAmount), '· status', po.status);

  const phoneLine = po.items.find((i) => i.productId === phone.id);
  const cableLine = po.items.find((i) => i.productId === cable.id);

  // ------------------------------------------------------------- 2. goods-in
  step(2, `Goods-in at ${FR.name} — a short delivery`);
  const arrived = Math.max(1, PHONES - 3);
  const receipt = await timed(`receiving ${arrived} IMEIs and 200 counted units`, () =>
    post(`/purchases/${po.id}/receive`, {
      lines: [
        // Phones are scanned one by one; the cables are counted.
        { purchaseItemId: phoneLine.id, imeis: imeis.slice(0, arrived) },
        { purchaseItemId: cableLine.id, quantity: 200 },
      ],
      allowPartial: true,
    }),
  );
  say(receipt.receiptNumber, '· expected', receipt.expected, '· received', receipt.scanned, '· missing', receipt.missing);
  say('purchase is now', receipt.purchaseStatus, '— the 3 short can still arrive');
  say('landed cost of', imeis[0], 'so far:', money(await landedCost(imeis[0])), '(the purchase price, nothing else yet)');

  // ------------------------------------------------- 3. costs on the French leg
  step(3, `Costs at ${FR.name}`);
  const postCost = async (label, type, amount, currency, scope, scopeId, method = 'QUANTITY') => {
    const doc = await post('/cost-documents', {
      type,
      description: label,
      amount,
      currency,
      allocation: method,
      scope,
      scopeId,
      post: true,
    });
    say(`${label.padEnd(34)} ${money(amount, currency).padStart(16)}  spread by ${method.toLowerCase()}`);
    return doc;
  };
  await postCost('Unloading and inspection', 'HANDLING', '420.00', 'EUR', 'RECEIPT', receipt.receiptId);
  const afterFrance = await landedCost(imeis[0]);
  say('→ landed cost now', money(afterFrance));

  // --------------------------------------------------------- 4. France → Spain
  step(4, `Transfer ${FR.name} → ${ES.name}`);
  const half = Math.floor(arrived / 2);
  const legOne = await post('/transfers', {
    sourceWarehouseId: FR.id,
    destinationWarehouseId: ES.id,
    items: [
      { productId: phone.id, quantity: half },
      { productId: cable.id, quantity: 120 },
    ],
    imeis: imeis.slice(0, half),
  });
  say(legOne.number, '· loading', half, 'handsets and 120 cables');

  const shipped1 = await timed('despatch', () =>
    post(`/transfers/${legOne.id}/ship`, { carrier: 'DHL Road', trackingRef: 'DHL-FR-ES-0091' }),
  );
  say('shipped', '·', shipped1.shipmentNumber, '·', shipped1.shippedDevices, 'units left France');

  const inTransit = (await get(`/inventory?warehouseId=${FR.id}&productId=${phone.id}`)).data[0];
  say(`France now holds ${inTransit.inStock} available, ${inTransit.inTransfer} in transfer — the stock is in neither place`);

  await postCost('Road freight Lyon → Barcelona', 'FREIGHT', '1250.00', 'EUR', 'SHIPMENT', legOne.id, 'VALUE');

  const arrivedES = await timed(`scanning ${half} IMEIs in`, () =>
    post(`/transfers/${legOne.id}/receive`, { imeis: imeis.slice(0, half) }),
  );
  say('received at', ES.name, '·', arrivedES.receiptNumber, '· expected', arrivedES.expected, '· scanned', arrivedES.scanned);
  say('→ landed cost now', money(await landedCost(imeis[0])));

  // -------------------------------------------------------- 5. Spain → Algeria
  step(5, `Transfer ${ES.name} → ${DZ.name}`);
  const legTwo = await post('/transfers', {
    sourceWarehouseId: ES.id,
    destinationWarehouseId: DZ.id,
    items: [
      { productId: phone.id, quantity: half },
      { productId: cable.id, quantity: 120 },
    ],
    imeis: imeis.slice(0, half),
  });
  const shipped2 = await post(`/transfers/${legTwo.id}/ship`, { carrier: 'Sea + road', trackingRef: 'MSC-ES-DZ-4417' });
  say(legTwo.number, '·', shipped2.shipmentNumber, '·', shipped2.shippedDevices, 'units left Spain');

  await timed('allocating sea freight', () =>
    postCost('Sea freight Barcelona → Algiers', 'FREIGHT', '2100.00', 'EUR', 'SHIPMENT', legTwo.id, 'VALUE'),
  );
  // Algerian customs bills in dinars; the system converts at the stored rate.
  await postCost('Algerian customs duty', 'CUSTOMS', '1680000.00', 'DZD', 'SHIPMENT', legTwo.id, 'VALUE');

  const arrivedDZ = await post(`/transfers/${legTwo.id}/receive`, { imeis: imeis.slice(0, half) });
  say('received at', DZ.name, '·', arrivedDZ.receiptNumber, '· status', arrivedDZ.status);

  // ------------------------------------------------------ 6. the cost build-up
  step(6, `What one handset cost to get to Algiers`);
  const traced = await get(`/imeis/${imeis[0]}/history`);
  rule();
  say(`IMEI ${imeis[0]}  ·  ${traced.device.product.name}`);
  say(`purchase price${' '.repeat(20)}${money(traced.device.purchaseCost).padStart(12)}`);
  say(`landed cost in Algiers${' '.repeat(12)}${money(traced.device.landedCost).padStart(12)}`);
  const added = (Number(traced.device.landedCost) - Number(traced.device.purchaseCost)).toFixed(2);
  say(`added by the journey${' '.repeat(14)}${money(added).padStart(12)}`);
  rule();
  say('movements recorded:');
  for (const m of traced.movements) {
    const where = [m.fromWarehouse?.name, m.toWarehouse?.name].filter(Boolean).join(' → ');
    say(`   ${m.type.padEnd(18)} ${where}`);
  }

  // ----------------------------------------------------------- 7. counter sale
  step(7, `Counter sale at ${DZ.name}`);
  const shelf = (await get(`/pos/accessories?warehouseId=${DZ.id}`)).data;
  const cableOnShelf = shelf.find((a) => a.productId === cable.id);
  const glassOnShelf = shelf.find((a) => a.productId === glass.id);
  say('accessories on the shelf:', shelf.map((a) => `${a.name} ×${a.available}`).join(', '));

  const lookup = await post('/pos/lookup', { imei: imeis[0], warehouseId: DZ.id });
  say('scanned', imeis[0], '→', lookup.sellable ? 'sellable' : 'NOT sellable', 'at', money(lookup.price, lookup.currency));

  const sale = await post('/pos/sales', {
    warehouseId: DZ.id,
    lines: [{ imei: imeis[0] }, { imei: imeis[1] }],
    items: [
      { productId: cableOnShelf.productId, quantity: 2 },
      { productId: glassOnShelf.productId, quantity: 1 },
    ],
  });
  rule();
  say(sale.number);
  for (const line of sale.lines) {
    const what = line.imeis.length > 0 ? `${line.quantity} × ${line.name}` : `${line.quantity} × ${line.name}`;
    say(`   ${what.padEnd(40)} ${money(line.total, sale.currency).padStart(18)}`);
  }
  say(`   ${'TOTAL'.padEnd(40)} ${money(sale.total, sale.currency).padStart(18)}`);
  rule();
  say('in euros', money(sale.totalInBase), 'at a rate of', Number(sale.exchangeRate).toFixed(6));
  say('cost of what was sold', money(sale.cost));
  say('gross profit', money(sale.grossProfit));

  // --------------------------------------------------------------- 8. the books
  step(8, 'Where everything ended up');
  const soldPhone = await get(`/imeis/${imeis[0]}/history`);
  say(`${imeis[0]} is now`, soldPhone.device.status, '· sold on', soldPhone.device.sale?.number ?? '—');

  const stock = (await get(`/inventory`)).data.filter((r) => r.inStock > 0);
  rule();
  say('PRODUCT'.padEnd(34), 'WAREHOUSE'.padEnd(22), 'AVAILABLE');
  for (const row of stock) {
    say(
      row.productName.slice(0, 32).padEnd(34),
      row.warehouseName.padEnd(22),
      String(row.inStock).padStart(6),
      row.tracking === 'BULK' ? ' (counted)' : '',
    );
  }
  rule();

  const dashboard = await get('/reports/dashboard');
  say('stock value', money(dashboard.stockValue));
  say('revenue', money(dashboard.financials.revenue), '· cost', money(dashboard.financials.purchaseCost));
  say('profit', money(dashboard.financials.profit), `· margin ${dashboard.financials.margin}%`);

  console.log('\n\x1b[32mSimulation complete — every figure above came back from the API.\x1b[0m\n');
};

run().catch((err) => {
  console.error(`\n\x1b[31mStopped: ${err.message}\x1b[0m\n`);
  process.exit(1);
});
