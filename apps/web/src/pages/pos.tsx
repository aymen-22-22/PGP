import { Banknote, Minus, Plus, Receipt, Trash2, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BackButton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { CodeScanInput } from '@/features/scanner/code-scan-input';
import type { CodeOutcome } from '@/features/scanner/use-code-buffer';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n/provider';
import { isAdmin, useAuth } from '@/lib/auth';
import { formatScanCode } from '@/lib/utils';

interface LookupResult {
  imei: string;
  sellable: boolean;
  code?: string;
  message?: string;
  price?: string;
  currency?: string;
  device?: { id: string; imei: string; product: { id: string; name: string; sku: string } };
}

interface BasketLine {
  imei: string;
  productName: string;
  unitPrice: string;
  currency: string;
}

/** An accessory line: a product and a count, with no IMEI to show. */
interface AccessoryLine {
  productId: string;
  name: string;
  unitPrice: string;
  currency: string;
  quantity: number;
}

interface Accessory {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  available: number;
  unitPrice: string;
  currency: string;
}

interface TodayResult {
  sales: number;
  revenue: string;
  revenueInBase: string;
  cost: string;
  grossProfit: string;
  baseCurrency: string;
  recent: {
    id: string;
    number: string;
    totalAmount: string;
    currency: string;
    completedAt: string;
    units: number;
    createdBy: { name: string } | null;
  }[];
}

interface Customer {
  id: string;
  name: string;
}

/**
 * The counter till.
 *
 * Scan, see the price, take the money. Every scan is checked against the server
 * before it enters the basket, so a phone that belongs to another shop or is
 * already sold is refused at the counter rather than at payment.
 */
export default function PosPage() {
  const { t, money, dateTime } = useI18n();
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [outcome, setOutcome] = useState<CodeOutcome | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const [accessories, setAccessories] = useState<AccessoryLine[]>([]);

  // An administrator is not behind any one counter, so they must say which
  // till is taking the money — the API refuses to guess, and rightly: the shop
  // decides both the price and which shelf the goods leave.
  const admin = isAdmin(user);
  const warehouses = useApiQuery<{ id: string; name: string; code: string }[]>('/warehouses', {
    enabled: admin,
  });
  const [tillId, setTillId] = useState('');
  const shopId = admin ? tillId : (user?.warehouseId ?? '');

  const today = useApiQuery<TodayResult>(
    shopId ? `/pos/today?warehouseId=${shopId}` : '/pos/today',
    { enabled: !admin || Boolean(tillId) },
  );
  const shelf = useApiQuery<{ data: Accessory[] }>(
    shopId ? `/pos/accessories?warehouseId=${shopId}` : '/pos/accessories',
    { enabled: !admin || Boolean(tillId) },
  );
  const customers = useApiQuery<{ data: Customer[] }>('/customers?pageSize=200');

  const currency = basket[0]?.currency ?? accessories[0]?.currency ?? 'DZD';
  const total = useMemo(
    () =>
      basket.reduce((sum, line) => sum + Number(line.unitPrice), 0) +
      accessories.reduce((sum, line) => sum + Number(line.unitPrice) * line.quantity, 0),
    [basket, accessories],
  );
  const itemCount = basket.length + accessories.reduce((sum, l) => sum + l.quantity, 0);

  /** Taps add one; the same accessory tapped twice is two of it, not an error. */
  const addAccessory = (item: Accessory) =>
    setAccessories((current) => {
      const existing = current.find((l) => l.productId === item.productId);
      if (!existing) {
        return [...current, { ...item, quantity: 1 }];
      }
      if (existing.quantity >= item.available) return current;
      return current.map((l) =>
        l.productId === item.productId ? { ...l, quantity: l.quantity + 1 } : l,
      );
    });

  const changeAccessory = (productId: string, delta: number) =>
    setAccessories((current) =>
      current
        .map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );

  const scan = async (payload: string) => {
    setRejected(null);

    // Whatever was read goes to the server as-is: a printed unit label, or a
    // legacy IMEI. Only the server knows which codes exist, and guessing here
    // is what used to make a perfectly good label look like a broken scanner.
    const imei = payload.trim().toUpperCase();
    if (!imei) return;

    if (basket.some((l) => l.imei === imei)) {
      setOutcome({ kind: 'duplicate', code: imei });
      return;
    }
    try {
      const result = await api.post<LookupResult>('/pos/lookup', {
        imei,
        ...(admin && tillId ? { warehouseId: tillId } : {}),
      });
      if (!result.sellable || !result.device || !result.price) {
        setOutcome({ kind: 'stray', code: imei, reason: result.message ?? t('pos.cannotSellHere') });
        setRejected(result.message ?? t('pos.cannotSellHere'));
        return;
      }
      setOutcome({ kind: 'accepted', code: imei });
      setBasket((current) => [
        ...current,
        {
          imei,
          productName: result.device!.product.name,
          unitPrice: result.price!,
          currency: result.currency ?? 'DZD',
        },
      ]);
    } catch {
      setOutcome({ kind: 'stray', code: imei, reason: t('pos.offline') });
      setRejected(t('pos.offline'));
    }
  };

  const sell = useApiMutation(
    (body: unknown) => api.post<Record<string, unknown>>('/pos/sales', body),
    ['/pos', '/inventory', '/reports', '/sales'],
  );

  const takePayment = () => {
    setBusy(true);
    sell.mutate(
      {
        ...(admin && tillId ? { warehouseId: tillId } : {}),
        ...(basket.length ? { lines: basket.map((l) => ({ imei: l.imei })) } : {}),
        ...(accessories.length
          ? { items: accessories.map((l) => ({ productId: l.productId, quantity: l.quantity })) }
          : {}),
        ...(customerId ? { customerId } : {}),
      },
      {
        onSuccess: (result) => {
          toast.push('success', t('pos.sold', { count: itemCount, number: String(result.number) }));
          setReceipt(result);
          setBasket([]);
          setAccessories([]);
          setCustomerId('');
          setOutcome(null);
          setBusy(false);
        },
        onError: (error) => {
          toast.push('error', error.message);
          setBusy(false);
        },
      },
    );
  };

  if (receipt) {
    return <ReceiptView receipt={receipt} onNext={() => setReceipt(null)} />;
  }

  return (
    <div className="space-y-5">
      <BackButton />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('pos.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {admin
              ? (warehouses.data?.find((w) => w.id === tillId)?.name ?? t('pos.chooseTill'))
              : (user?.warehouseName ?? t('app.shop'))}
          </p>
        </div>
        {today.data && (
          <div className="text-end">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('pos.today')}</p>
            <p className="tabular text-lg font-bold">
              {money(today.data.revenue, today.data.recent[0]?.currency ?? 'DZD')}
            </p>
            <p className="text-xs text-muted-foreground">{t('pos.salesCount', { count: today.data.sales })}</p>
          </div>
        )}
      </header>

      {admin && (
        <Card>
          <CardContent className="space-y-1.5 p-4 sm:p-5">
            <Label htmlFor="pos-till">{t('pos.sellingFrom')}</Label>
            <Select
              id="pos-till"
              value={tillId}
              onChange={(e) => {
                setTillId(e.target.value);
                setBasket([]);
                setAccessories([]);
              }}
            >
              <option value="">{t('pos.chooseTillPrompt')}</option>
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </CardContent>
        </Card>
      )}

      {(!admin || tillId) && (
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <CodeScanInput onScan={scan} outcome={outcome} label={t('pos.scanPhone')} />
          {rejected && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium text-destructive"
            >
              {rejected}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {shelf.data && shelf.data.data.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('pos.accessories')}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Tap targets rather than a search box: at a counter these are a
                dozen known items, and typing is slower than pointing. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shelf.data.data.map((item) => {
                const inBasket = accessories.find((l) => l.productId === item.productId)?.quantity ?? 0;
                const soldOut = inBasket >= item.available;
                return (
                  <button
                    key={item.productId}
                    type="button"
                    disabled={soldOut}
                    aria-label={t('pos.addOne', { name: item.name })}
                    onClick={() => addAccessory(item)}
                    className="touch-target relative rounded-lg border-2 p-3 text-start transition-colors hover:border-primary disabled:opacity-40"
                  >
                    {item.imageUrl && (
                      // A picture is read faster than a name at a busy counter.
                      <img
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                        className="mb-2 h-16 w-full rounded object-cover"
                      />
                    )}
                    <span className="block truncate text-sm font-semibold">{item.name}</span>
                    <span className="tabular mt-0.5 block text-sm">
                      {money(item.unitPrice, item.currency)}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t('pos.inStock', { count: item.available })}
                    </span>
                    {inBasket > 0 && (
                      <span className="tabular absolute end-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                        {inBasket}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {basket.length === 0 && accessories.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title={t('pos.nothingScanned')}
          description={t('pos.startSale')}
        />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('pos.inThisSale', { count: itemCount })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="divide-y rounded-md border">
              {basket.map((line) => (
                <li key={line.imei} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="tabular font-medium">{formatScanCode(line.imei)}</p>
                    <p className="truncate text-xs text-muted-foreground">{line.productName}</p>
                  </div>
                  <span className="tabular font-semibold">
                    {money(line.unitPrice, line.currency)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    aria-label={t('pos.removeImei', { imei: line.imei })}
                    onClick={() => setBasket((c) => c.filter((l) => l.imei !== line.imei))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
              {accessories.map((line) => (
                <li key={line.productId} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{line.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('pos.each', { amount: money(line.unitPrice, line.currency) })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={t('pos.oneLess', { name: line.name })}
                      onClick={() => changeAccessory(line.productId, -1)}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="tabular w-8 text-center font-semibold">{line.quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={t('pos.oneMore', { name: line.name })}
                      onClick={() => changeAccessory(line.productId, 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <span className="tabular w-20 text-end font-semibold">
                    {money((Number(line.unitPrice) * line.quantity).toFixed(2), line.currency)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="space-y-1.5">
              <Label htmlFor="pos-customer">{t('pos.customerOptional')}</Label>
              <Select
                id="pos-customer"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">{t('common.walkIn')}</option>
                {customers.data?.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-baseline justify-between rounded-md bg-muted/50 px-4 py-3">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('common.total')}
              </span>
              <span className="tabular text-stat">{money(total.toFixed(2), currency)}</span>
            </div>

            <FormError error={sell.error} />

            <Button
              size="xl"
              variant="success"
              className="w-full gap-2"
              disabled={busy || itemCount === 0}
              onClick={takePayment}
            >
              <Banknote className="h-6 w-6" />
              {busy ? t('pos.takingPayment') : t('pos.take', { amount: money(total.toFixed(2), currency) })}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setBasket([])} disabled={busy}>
              {t('pos.clear')}
            </Button>
          </CardContent>
        </Card>
      )}

      {today.isLoading && <LoadingState />}
      {today.isError && <ErrorState error={today.error} onRetry={() => void today.refetch()} />}

      {today.data && today.data.recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <TrendingUp className="h-5 w-5" aria-hidden />
            {t('pos.todaySales')}
          </h2>
          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-card p-3 text-center">
            <Figure label={t('pos.salesLabel')} value={String(today.data.sales)} />
            <Figure
              label={t('pos.revenueLabel', { currency: today.data.baseCurrency })}
              value={money(today.data.revenueInBase, today.data.baseCurrency, { round: true })}
            />
            <Figure
              label={t('pos.grossProfit')}
              value={money(today.data.grossProfit, today.data.baseCurrency, { round: true })}
              tone="success"
            />
          </div>
          <ul className="divide-y rounded-lg border bg-card">
            {today.data.recent.map((sale) => (
              <li key={sale.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="tabular font-medium">{sale.number}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('pos.lineItems', { count: sale.units })} · {dateTime(sale.completedAt)}
                    {sale.createdBy && ` · ${sale.createdBy.name}`}
                  </p>
                </div>
                <span className="tabular font-semibold">
                  {money(sale.totalAmount, sale.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ReceiptView({ receipt, onNext }: { receipt: Record<string, unknown>; onNext: () => void }) {
  const { t, money } = useI18n();
  const currency = String(receipt.currency ?? 'DZD');
  const lines = (receipt.lines ?? []) as {
    productId: string;
    name: string | null;
    quantity: number;
    unitPrice: string;
    total: string;
    imeis: string[];
  }[];

  return (
    <div className="mx-auto max-w-md space-y-5">
      <Card className="border-success/40">
        <CardContent className="space-y-4 p-5 text-center">
          <Receipt className="mx-auto h-12 w-12 text-success" aria-hidden />
          <div>
            <h1 className="text-xl font-bold">{t('pos.saleComplete')}</h1>
            <p className="tabular text-sm text-muted-foreground">{String(receipt.number)}</p>
          </div>

          <p className="tabular text-stat-lg">
            {money(String(receipt.total), currency)}
          </p>

          <ul className="divide-y rounded-md border text-start">
            {lines.flatMap((line) =>
              // A phone is listed by its IMEI, which is the one thing that
              // identifies it. An accessory has no such thing, so it is listed
              // the way a shop receipt lists it: name and a count.
              line.imeis.length > 0
                ? line.imeis.map((imei) => (
                    <li key={imei} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="tabular">{formatScanCode(imei)}</span>
                      <span className="tabular font-medium">{money(line.unitPrice, currency)}</span>
                    </li>
                  ))
                : [
                    <li
                      key={line.productId}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="truncate">
                        {line.quantity} × {line.name ?? t('pos.accessory')}
                      </span>
                      <span className="tabular font-medium">{money(line.total, currency)}</span>
                    </li>,
                  ],
            )}
          </ul>

          <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t('pos.grossProfit')}</span>
            <span className="tabular font-semibold text-success">
              {money(String(receipt.grossProfit), String(receipt.baseCurrency ?? 'EUR'))}
            </span>
          </div>

          {/* Not a Badge: badges upper-case their text, which turned "at" into "AT". */}
          <p className="tabular text-xs text-muted-foreground">
            {money(String(receipt.totalInBase), String(receipt.baseCurrency ?? 'EUR'))} at a rate of{' '}
            {Number(receipt.exchangeRate).toFixed(6)}
          </p>

          <Button size="xl" className="w-full" onClick={onNext}>
            {t('pos.nextSale')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div>
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`tabular text-lg font-bold ${tone === 'success' ? 'text-success' : ''}`}>{value}</p>
    </div>
  );
}
