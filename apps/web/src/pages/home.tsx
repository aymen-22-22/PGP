import { ArrowDownToLine, Package, ScanLine, Truck, Wallet } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Stat, StatGrid } from '@/components/ui/stat';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import type { Dashboard } from '@phone-erp/shared-types';
import { useI18n } from '@/i18n/provider';
import { useApiQuery } from '@/hooks/use-api';
import { buildQuery } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import { formatNumber, plural } from '@/lib/utils';


export default function HomePage() {
  const user = useAuth((s) => s.user);
  const admin = isAdmin(user);

  // The filters live in the URL rather than in component state, so the context
  // that produced a figure can be handed to the ledger that explains it — and
  // so a dashboard someone has narrowed down can be shared or reloaded.
  const { t, money } = useI18n();
  const [params, setParams] = useSearchParams();
  const filters = {
    warehouseId: params.get('warehouseId') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
  const setFilter = (key: keyof typeof filters, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const scope = buildQuery({
    warehouseId: filters.warehouseId || undefined,
    // A plain date means the whole of that day, which is what someone picking
    // "to: today" means — not midnight this morning.
    from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
    to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
  });

  const warehouses = useApiQuery<{ id: string; name: string }[]>('/warehouses', { enabled: admin });
  const query = useApiQuery<Dashboard>(`/reports/dashboard${scope}`);
  /** Ledgers open with exactly the filters that produced the figure. */
  const ledger = (name: string) => `/ledger/${name}${scope}`;

  if (query.isLoading) return <LoadingState label="Loading your dashboard…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const data = query.data!;
  const { totals, financials, movement } = data;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {admin ? t('home.title') : (user?.warehouseName ?? t('home.myWarehouse'))}
          </h1>
          <p className="text-sm text-muted-foreground">
            {admin ? t('home.leadAdmin') : t('home.leadUser')}
          </p>
        </div>
        <Button asChild size="lg" className="gap-2 lg:hidden">
          <Link to="/scan">
            <ScanLine className="h-5 w-5" />
            {t('home.scanCta')}
          </Link>
        </Button>
      </header>

      {/* Narrowing the dashboard narrows every ledger opened from it. */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          {admin && (
            <div className="space-y-1.5">
              <Label htmlFor="f-warehouse">{t('home.filter.warehouse')}</Label>
              <Select
                id="f-warehouse"
                value={filters.warehouseId}
                onChange={(e) => setFilter('warehouseId', e.target.value)}
              >
                <option value="">{t('home.filter.everyWarehouse')}</option>
                {warehouses.data?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="f-from">{t('home.filter.from')}</Label>
            <Input id="f-from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-to">{t('home.filter.to')}</Label>
            <Input id="f-to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
          </div>
          {(filters.warehouseId || filters.from || filters.to) && (
            <div className="sm:col-span-3">
              <Button variant="ghost" size="sm" className="-ms-2 gap-1" onClick={() => setParams({}, { replace: true })}>
                {t('home.filter.clear')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <StatGrid>
        {/* These open the existing lists rather than new ones: the records
            behind a count of devices are the devices themselves. */}
        <Stat
          label={t('home.available')}
          value={totals.available}
          tone="success"
          icon={Package}
          sub={t('home.availableSub')}
          to="/stock?status=IN_STOCK"
        />
        <Stat
          label={t('home.sold')}
          value={totals.sold}
          tone="muted"
          sub={plural(financials.completedSales, 'order')}
          to="/sales"
        />
        <Stat
          label={t('home.send')}
          value={movement.outgoing}
          tone="warning"
          icon={Truck}
          sub={t('home.sendSub')}
          to="/send"
        />
        <Stat
          label={t('home.receive')}
          value={movement.pendingReceipts}
          tone="warning"
          icon={ArrowDownToLine}
          sub={t('home.receiveSub')}
          to="/receive"
        />
      </StatGrid>

      {totals.pendingValidation > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-semibold">{formatNumber(totals.pendingValidation)} phones await validation</p>
              <p className="text-sm text-muted-foreground">They are not sellable until a receipt is validated.</p>
            </div>
            <Button asChild variant="outline">
              <Link to="/receipts">Review</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {admin && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Money</h2>
          <StatGrid>
            <Stat
              label={t('home.stockValue')}
              value={money(data.stockValue, 'EUR', { round: true })}
              icon={Wallet}
              sub={t('home.stockValueSub')}
              to={ledger('stock-value')}
            />
            <Stat
              label={t('home.revenue')}
              value={money(financials.revenue, 'EUR', { round: true })}
              sub={plural(financials.completedSales, 'completed sale')}
              to={ledger('revenue')}
            />
            <Stat
              label={t('home.costOfSales')}
              value={money(financials.purchaseCost, 'EUR', { round: true })}
              sub={t('home.costOfSalesSub')}
              to={ledger('cost')}
            />
            <Stat
              label={t('home.profit')}
              value={money(financials.profit, 'EUR', { round: true })}
              tone={Number(financials.profit) >= 0 ? 'success' : 'default'}
              to={ledger('profit')}
              sub={`${financials.margin}% margin`}
            />
          </StatGrid>
        </section>
      )}

      {admin && data.byWarehouse.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">By warehouse</h2>
          <TableWrap>
            <thead>
              <tr>
                <Th>Warehouse</Th>
                <Th className="text-end">Available</Th>
                <Th className="text-end">In transfer</Th>
                <Th className="text-end">Sold</Th>
                <Th className="text-end">Total</Th>
              </tr>
            </thead>
            <tbody>
              {data.byWarehouse.map((row) => (
                <Tr key={row.warehouseId}>
                  <Td className="font-medium">{row.warehouseName}</Td>
                  <Td className="tabular text-end font-semibold">{formatNumber(row.available)}</Td>
                  <Td className="tabular text-end">{formatNumber(row.inTransfer)}</Td>
                  <Td className="tabular text-end">{formatNumber(row.sold)}</Td>
                  <Td className="tabular text-end text-muted-foreground">{formatNumber(row.total)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </section>
      )}

      {!admin && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('home.today')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button asChild variant="outline" size="lg" className="justify-between">
              <Link to="/receive">
                {t('home.incomingShipments')}
                <span className="tabular font-bold">{formatNumber(movement.pendingReceipts)}</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="justify-between">
              <Link to="/stock">
                {t('home.myStock')}
                <span className="tabular font-bold">{formatNumber(totals.available)}</span>
              </Link>
            </Button>
            {/* Not Sales: this account cannot open it, and what it actually
                does with stock on the way out is send it. */}
            <Button asChild variant="outline" size="lg" className="justify-between">
              <Link to="/send">
                {t('nav.send')}
                <span className="tabular font-bold">{formatNumber(movement.outgoing)}</span>
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
