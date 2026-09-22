import { ArrowDownToLine, Package, ScanLine, Truck, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Stat, StatGrid } from '@/components/ui/stat';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import type { Dashboard } from '@phone-erp/shared-types';
import { useI18n } from '@/i18n/provider';
import { useApiQuery } from '@/hooks/use-api';
import { isAdmin, useAuth } from '@/lib/auth';
import { formatNumber, plural } from '@/lib/utils';


export default function HomePage() {
  const user = useAuth((s) => s.user);
  const admin = isAdmin(user);

  const { t, money } = useI18n();
  const query = useApiQuery<Dashboard>('/reports/dashboard');
  const ledger = (name: string) => `/ledger/${name}`;

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
