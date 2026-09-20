import { Package } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BackButton } from '@/components/page';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import type { SaleLedgerRow, StockValueLedgerRow, Ledger } from '@phone-erp/shared-types';
import { useApiQuery } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useI18n } from '@/i18n/provider';
import { buildQuery } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/utils';

const LEDGER_TITLES = {
  'stock-value': 'home.stockValue',
  revenue: 'home.revenue',
  cost: 'home.costOfSales',
  profit: 'home.profit',
} as const;

const LEDGER_LEADS = {
  'stock-value': 'ledger.lead.stockValue',
  revenue: 'ledger.lead.revenue',
  cost: 'ledger.lead.cost',
  profit: 'ledger.lead.profit',
} as const;

type LedgerKind = keyof typeof LEDGER_TITLES;

export default function LedgerPage() {
  const { t, money } = useI18n();
  const { kind } = useParams<{ kind: string }>();
  const ledger = (kind && kind in LEDGER_TITLES ? kind : 'revenue') as LedgerKind;
  const title = t(LEDGER_TITLES[ledger]);

  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const debounced = useDebounce(search);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any change to what is being asked for starts again at the first page.
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  // The scope arrives from the dashboard tile and stays editable here.
  const warehouseId = params.get('warehouseId') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const productId = params.get('productId') ?? '';
  const customerId = params.get('customerId') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? '';
  const direction = (params.get('direction') ?? 'desc') as 'asc' | 'desc';
  const page = Number(params.get('page') ?? 1);

  const query = buildQuery({
    warehouseId: warehouseId || undefined,
    from: from || undefined,
    to: to || undefined,
    productId: productId || undefined,
    customerId: customerId || undefined,
    category: category || undefined,
    search: debounced || undefined,
    sort: sort || undefined,
    direction,
    page,
    pageSize: 50,
  });

  const warehouses = useApiQuery<{ id: string; name: string }[]>('/warehouses');
  const products = useApiQuery<{ data: { id: string; name: string }[] }>('/products?pageSize=200');
  const customers = useApiQuery<{ data: { id: string; name: string }[] }>('/customers?pageSize=200');

  const result = useApiQuery<Ledger<SaleLedgerRow & StockValueLedgerRow>>(`/reports/ledger/${ledger}${query}`);

  const dateLabel = useMemo(() => {
    if (!from && !to) return t('ledger.allTime');
    const start = from ? formatDate(from) : t('ledger.beginning');
    const end = to ? formatDate(to) : t('ledger.today');
    return `${start} → ${end}`;
  }, [from, to, t]);

  const sortBy = (column: string) => {
    const next = new URLSearchParams(params);
    next.set('sort', column);
    next.set('direction', sort === column && direction === 'desc' ? 'asc' : 'desc');
    next.delete('page');
    setParams(next, { replace: true });
  };

  const totals = result.data?.totals;
  const isStock = ledger === 'stock-value';

  const headline = isStock
    ? totals?.stockValue
    : ledger === 'cost'
      ? totals?.cost
      : ledger === 'profit'
        ? totals?.profit
        : totals?.revenue;

  return (
    <div className="space-y-5">
      <BackButton label={t('home.title')} />

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{t(LEDGER_LEADS[ledger])}</p>
      </header>

      {/* The headline repeats the tile that was clicked, so the figure being
          explained is on screen beside the records explaining it. */}
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-4 p-4 sm:p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('ledger.total', { label: title })}
            </p>
            <p className="tabular text-stat">
              {headline === undefined ? '—' : money(headline, totals?.currency)}
            </p>
            <p className="text-sm text-muted-foreground">
              {isStock
                ? `${t('ledger.units', { count: totals?.quantity ?? 0 })} ${t('ledger.across')} ${t('ledger.products', { count: totals?.products ?? 0 })}`
                : `${t('ledger.transactions', { count: totals?.transactions ?? 0 })} · ${t('ledger.lines', { count: totals?.lines ?? 0 })} · ${t('ledger.units', { count: totals?.quantity ?? 0 })}`}
            </p>
          </div>

          {!isStock && ledger !== 'revenue' && (
            <dl className="flex gap-6 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('home.revenue')}</dt>
                <dd className="tabular font-semibold">{money(totals?.revenue ?? '0.00')}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('stock360.cost')}</dt>
                <dd className="tabular font-semibold">{money(totals?.cost ?? '0.00')}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('ledger.margin')}</dt>
                <dd className="tabular font-semibold">{totals?.margin ?? '0.00'}%</dd>
              </div>
            </dl>
          )}

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{dateLabel}</Badge>
            <Badge variant="secondary">
              {warehouseId
                ? (warehouses.data?.find((w) => w.id === warehouseId)?.name ?? t('ledger.oneWarehouse'))
                : t('home.filter.everyWarehouse')}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="l-search">{t('common.search')}</Label>
            <Input
              id="l-search"
              value={search}
              onChange={(e) => set('search', e.target.value)}
              placeholder={isStock ? t('ledger.searchPlaceholderStock') : t('ledger.searchPlaceholder')}
              inputMode="search"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="l-warehouse">{t('common.warehouse')}</Label>
            <Select id="l-warehouse" value={warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
              <option value="">{t('home.filter.everyWarehouse')}</option>
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="l-product">{t('common.product')}</Label>
            <Select id="l-product" value={productId} onChange={(e) => set('productId', e.target.value)}>
              <option value="">{t('ledger.everyProduct')}</option>
              {products.data?.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          {!isStock && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="l-from">{t('ledger.from')}</Label>
                <Input id="l-from" type="date" value={from.slice(0, 10)} onChange={(e) => set('from', e.target.value ? `${e.target.value}T00:00:00.000Z` : '')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="l-to">{t('ledger.to')}</Label>
                <Input id="l-to" type="date" value={to.slice(0, 10)} onChange={(e) => set('to', e.target.value ? `${e.target.value}T23:59:59.999Z` : '')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="l-customer">{t('common.customer')}</Label>
                <Select id="l-customer" value={customerId} onChange={(e) => set('customerId', e.target.value)}>
                  <option value="">{t('ledger.everyCustomer')}</option>
                  {customers.data?.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="l-category">{t('ledger.category')}</Label>
            <Input
              id="l-category"
              value={category}
              onChange={(e) => set('category', e.target.value)}
              placeholder={t('ledger.anyCategory')}
            />
          </div>
        </CardContent>
      </Card>

      {result.isLoading && <LoadingState label={t('ledger.loading')} />}
      {result.isError && <ErrorState error={result.error} onRetry={() => void result.refetch()} />}

      {result.data?.data.length === 0 && (
        <EmptyState
          icon={Package}
          title={t('ledger.emptyTitle')}
          description={t('ledger.emptyBody')}
        />
      )}

      {result.data && result.data.data.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                {isStock ? (
                  <>
                    <SortTh label={t('common.product')} column="product" {...{ sort, direction, sortBy }} />
                    <Th>{t('common.sku')}</Th>
                    <Th>{t('ledger.category')}</Th>
                    <SortTh label={t('common.warehouse')} column="warehouse" {...{ sort, direction, sortBy }} />
                    <SortTh label={t('common.quantity')} column="quantity" align="right" {...{ sort, direction, sortBy }} />
                    <Th className="text-end">{t('ledger.unitCost')}</Th>
                    <SortTh label={t('stock.stockValue')} column="value" align="right" {...{ sort, direction, sortBy }} />
                  </>
                ) : (
                  <>
                    <SortTh label={t('common.date')} column="date" {...{ sort, direction, sortBy }} />
                    <SortTh label={t('common.reference')} column="reference" {...{ sort, direction, sortBy }} />
                    <SortTh label={t('common.product')} column="product" {...{ sort, direction, sortBy }} />
                    <Th>{t('common.sku')}</Th>
                    {ledger === 'cost' && <Th>{t('ledger.arrivedOn')}</Th>}
                    {ledger === 'cost' && <Th>{t('common.supplier')}</Th>}
                    <SortTh label={t('ledger.qty')} column="quantity" align="right" {...{ sort, direction, sortBy }} />
                    {ledger !== 'cost' && <Th className="text-end">{t('ledger.unitPrice')}</Th>}
                    {ledger === 'cost' && <Th className="text-end">{t('ledger.unitCost')}</Th>}
                    {ledger !== 'cost' && (
                      <SortTh label={t('home.revenue')} column="revenue" align="right" {...{ sort, direction, sortBy }} />
                    )}
                    {ledger !== 'revenue' && (
                      <SortTh label={t('stock360.cost')} column="cost" align="right" {...{ sort, direction, sortBy }} />
                    )}
                    {ledger === 'profit' && (
                      <SortTh label={t('home.profit')} column="profit" align="right" {...{ sort, direction, sortBy }} />
                    )}
                    {ledger === 'profit' && <Th className="text-end">{t('ledger.margin')}</Th>}
                    {ledger === 'revenue' && (
                      <SortTh label={t('common.customer')} column="customer" {...{ sort, direction, sortBy }} />
                    )}
                    <SortTh label={t('common.warehouse')} column="warehouse" {...{ sort, direction, sortBy }} />
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {result.data.data.map((row) =>
                isStock ? (
                  <Tr key={`${row.warehouseId}:${row.productId}`}>
                    <Td className="max-w-[16rem] truncate font-medium">{row.productName}</Td>
                    <Td className="tabular text-muted-foreground">{row.sku}</Td>
                    <Td className="text-muted-foreground">{row.category ?? '—'}</Td>
                    <Td className="text-muted-foreground">{row.warehouseName}</Td>
                    <Td className="tabular text-end">{formatNumber(row.quantity)}</Td>
                    <Td className="tabular text-end text-muted-foreground">{money(row.unitCost)}</Td>
                    <Td className="tabular text-end font-semibold">{money(row.stockValue)}</Td>
                  </Tr>
                ) : (
                  // The row opens the sale it came from — the drill-down ends at
                  // the original document, not at another summary.
                  <Tr key={row.lineId} className="cursor-pointer hover:bg-accent/40">
                    <Td className="whitespace-nowrap text-muted-foreground">
                      {row.date ? formatDate(row.date) : '—'}
                    </Td>
                    <Td>
                      <Link to={`/sales/${row.saleId}`} className="tabular font-medium hover:underline">
                        {row.reference}
                      </Link>
                    </Td>
                    <Td className="max-w-[14rem] truncate">{row.productName}</Td>
                    <Td className="tabular text-muted-foreground">{row.sku}</Td>
                    {ledger === 'cost' && (
                      <Td>
                        {row.purchaseId ? (
                          <Link to={`/purchases/${row.purchaseId}`} className="tabular hover:underline">
                            {row.purchaseNumber}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                    )}
                    {ledger === 'cost' && (
                      <Td className="text-muted-foreground">{row.supplierName ?? '—'}</Td>
                    )}
                    <Td className="tabular text-end">{formatNumber(row.quantity)}</Td>
                    {ledger !== 'cost' && (
                      <Td className="tabular text-end text-muted-foreground">
                        {money(row.unitPrice, row.currency)}
                      </Td>
                    )}
                    {ledger === 'cost' && (
                      <Td className="tabular text-end text-muted-foreground">{money(row.unitCost)}</Td>
                    )}
                    {ledger !== 'cost' && (
                      <Td className="tabular text-end font-semibold">{money(row.revenue)}</Td>
                    )}
                    {ledger !== 'revenue' && (
                      <Td className="tabular text-end">{money(row.cost)}</Td>
                    )}
                    {ledger === 'profit' && (
                      <Td
                        className={`tabular text-end font-semibold ${
                          Number(row.profit) >= 0 ? 'text-success' : 'text-destructive'
                        }`}
                      >
                        {money(row.profit)}
                      </Td>
                    )}
                    {ledger === 'profit' && (
                      <Td className="tabular text-end text-muted-foreground">{row.margin}%</Td>
                    )}
                    {ledger === 'revenue' && (
                      <Td className="text-muted-foreground">{row.customerName ?? t('common.walkIn')}</Td>
                    )}
                    <Td className="text-muted-foreground">{row.warehouseName}</Td>
                  </Tr>
                ),
              )}
            </tbody>
          </TableWrap>

          {/* Said plainly, because a total that describes more than the page is
              the one thing a reader is most likely to get wrong. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-4">
            <p className="text-sm text-muted-foreground">
              {t('ledger.showing', {
                start: formatNumber((result.data.meta.page - 1) * result.data.meta.pageSize + 1),
                end: formatNumber(Math.min(result.data.meta.page * result.data.meta.pageSize, result.data.meta.total)),
                total: formatNumber(result.data.meta.total),
              })}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">
                {t('ledger.total', { label: title })} {t('ledger.forAllRows', { total: formatNumber(result.data.meta.total) })}{' '}
              </span>
              <strong className="tabular text-base">
                {money(headline ?? '0.00', totals?.currency)}
              </strong>
            </p>
          </div>

          <Pagination meta={result.data.meta} onPageChange={(p) => set('page', String(p))} />
        </>
      )}
    </div>
  );
}

function SortTh({
  label,
  column,
  sort,
  direction,
  sortBy,
  align = 'left',
}: {
  label: string;
  column: string;
  sort: string;
  direction: 'asc' | 'desc';
  sortBy: (column: string) => void;
  align?: 'left' | 'right';
}) {
  const active = sort === column;
  return (
    <Th className={align === 'right' ? 'text-end' : undefined}>
      <Button
        variant="ghost"
        size="sm"
        className={`-mx-2 h-7 gap-1 px-2 text-xs font-semibold uppercase tracking-wide ${
          active ? 'text-foreground' : 'text-muted-foreground'
        }`}
        onClick={() => sortBy(column)}
      >
        {label}
        {active && <span aria-hidden>{direction === 'asc' ? '↑' : '↓'}</span>}
      </Button>
    </Th>
  );
}