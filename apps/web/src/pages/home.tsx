import {
  ArrowDownToLine,
  ArrowRight,
  Inbox,
  Package,
  ScanLine,
  ShoppingBag,
  ShoppingCart,
  Tags,
  Truck,
  Wallet,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Stat, StatGrid } from '@/components/ui/stat';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import type { Dashboard } from '@phone-erp/shared-types';
import { useI18n } from '@/i18n/provider';
import { useApiQuery } from '@/hooks/use-api';
import { isAdmin, useAuth } from '@/lib/auth';
import { countryFromWarehouseCode, countryName, flagOf, groupByCountry } from '@/lib/countries';
import { cn, formatNumber, plural } from '@/lib/utils';

type WarehouseRow = Dashboard['byWarehouse'][number];

export default function HomePage() {
  const user = useAuth((s) => s.user);
  const admin = isAdmin(user);

  const { t, money, locale, date } = useI18n();
  const query = useApiQuery<Dashboard>('/reports/dashboard');
  const ledger = (name: string) => `/ledger/${name}`;

  if (query.isLoading) return <LoadingState label="Loading your dashboard…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const data = query.data!;
  const { totals, financials, movement } = data;
  const empty = totals.totalDevices === 0 && totals.available === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{date(new Date())}</p>
          <h1 className="text-2xl font-bold tracking-tight">
            {admin ? t('home.title') : (user?.warehouseName ?? t('home.myWarehouse'))}
          </h1>
          <p className="text-sm text-muted-foreground">{admin ? t('home.leadAdmin') : t('home.leadUser')}</p>
        </div>
        <Button asChild size="lg" className="gap-2 lg:hidden">
          <Link to="/scan">
            <ScanLine className="h-5 w-5" />
            {t('home.scanCta')}
          </Link>
        </Button>
      </header>

      {empty && admin && <GetStarted />}

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
          tone="default"
          icon={ShoppingBag}
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
        <div className="grid gap-4 lg:grid-cols-5">
          <StockChart rows={data.byWarehouse} className="lg:col-span-3" />

          <section className="rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.05)] lg:col-span-2">
            <h2 className="font-semibold">{t('home.money')}</h2>
            <Link to={ledger('stock-value')} className="group mt-4 block">
              <span className="flex items-center gap-2 text-[0.8rem] font-medium text-muted-foreground">
                <Wallet className="h-4 w-4" aria-hidden />
                {t('home.stockValue')}
              </span>
              <span className="tabular block text-stat-lg text-foreground group-hover:text-primary">
                {money(data.stockValue, 'EUR', { round: true })}
              </span>
              <span className="text-xs text-muted-foreground">{t('home.stockValueSub')}</span>
            </Link>

            <dl className="mt-5 divide-y border-t">
              <MoneyRow label={t('home.revenue')} to={ledger('revenue')} value={money(financials.revenue, 'EUR', { round: true })} />
              <MoneyRow label={t('home.costOfSales')} to={ledger('cost')} value={money(financials.purchaseCost, 'EUR', { round: true })} />
              <MoneyRow
                label={t('home.profit')}
                to={ledger('profit')}
                value={money(financials.profit, 'EUR', { round: true })}
                strong
              />
            </dl>

            <div className="mt-4">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-muted-foreground">{t('home.margin')}</span>
                <span className="tabular font-semibold">{financials.margin}%</span>
              </div>
              {/* A meter against 0–100%: the track is the same hue, so the fill
                  reads as a share, not as a second series. */}
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-success/15" role="presentation">
                <div
                  className="h-full rounded-full bg-success transition-[width]"
                  style={{ width: `${Math.max(0, Math.min(100, Number(financials.margin) || 0))}%` }}
                />
              </div>
            </div>
          </section>
        </div>
      )}

      {admin && data.byWarehouse.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('home.details')}</h2>
          <TableWrap stack={false}>
            <thead>
              <tr>
                <Th>Warehouse</Th>
                <Th className="text-end">Available</Th>
                <Th className="hidden text-end sm:table-cell">In transfer</Th>
                <Th className="hidden text-end sm:table-cell">Sold</Th>
                <Th className="hidden text-end sm:table-cell">Total</Th>
              </tr>
            </thead>
            <tbody>
              {groupByCountry(
                data.byWarehouse,
                (row) => countryFromWarehouseCode(row.warehouseCode),
                (row) => row.warehouseName,
                locale,
              ).map((group) => {
                const sum = (key: 'available' | 'inTransfer' | 'sold' | 'total') =>
                  group.items.reduce((acc, row) => acc + row[key], 0);
                return (
                  <Fragment key={group.code ?? 'none'}>
                    <tr className="bg-muted/60">
                      <Td className="font-semibold">
                        <span className="me-2" aria-hidden>
                          {flagOf(group.code)}
                        </span>
                        {countryName(group.code, locale)}
                      </Td>
                      <Td className="tabular text-end font-semibold">{formatNumber(sum('available'))}</Td>
                      <Td className="hidden sm:table-cell tabular text-end font-semibold">{formatNumber(sum('inTransfer'))}</Td>
                      <Td className="hidden sm:table-cell tabular text-end font-semibold">{formatNumber(sum('sold'))}</Td>
                      <Td className="hidden sm:table-cell tabular text-end font-semibold">{formatNumber(sum('total'))}</Td>
                    </tr>
                    {group.items.map((row) => (
                      <Tr key={row.warehouseId}>
                        <Td className="ps-10">
                          {row.warehouseName}
                          <span className="tabular ms-2 text-xs text-muted-foreground">{row.warehouseCode}</span>
                        </Td>
                        <Td className="tabular text-end">{formatNumber(row.available)}</Td>
                        <Td className="hidden sm:table-cell tabular text-end">{formatNumber(row.inTransfer)}</Td>
                        <Td className="hidden sm:table-cell tabular text-end">{formatNumber(row.sold)}</Td>
                        <Td className="hidden sm:table-cell tabular text-end text-muted-foreground">{formatNumber(row.total)}</Td>
                      </Tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </TableWrap>
        </section>
      )}
    </div>
  );
}

function MoneyRow({ label, value, to, strong }: { label: string; value: string; to: string; strong?: boolean }) {
  return (
    <Link to={to} className="group flex items-center justify-between py-2.5 text-sm">
      <dt className="text-muted-foreground group-hover:text-foreground">{label}</dt>
      <dd className={cn('tabular', strong ? 'font-bold' : 'font-medium', 'group-hover:text-primary')}>{value}</dd>
    </Link>
  );
}

/** First run: no phone has ever been received, so say how to get the first ones in. */
function GetStarted() {
  const { t } = useI18n();
  const steps = [
    { to: '/purchases', icon: ShoppingCart, label: t('home.step.purchase') },
    { to: '/receive', icon: Inbox, label: t('home.step.receive') },
    { to: '/purchases', icon: Tags, label: t('home.step.labels') },
  ];
  return (
    <section className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5">
      <h2 className="font-semibold">{t('home.getStarted.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('home.getStarted.body')}</p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.label}>
            <Link
              to={step.to}
              className="group flex h-full items-center gap-3 rounded-lg border bg-card p-3 text-sm font-medium transition-colors hover:border-primary/40"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {i + 1}
              </span>
              <step.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1">{step.label}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Available phones per warehouse as horizontal bars, grouped by country.
 *
 * One series, so one hue and no legend — the heading names it. Each bar carries
 * its value as a label in text ink, and hovering a row shows the full breakdown.
 * The table below is the accessible view of the same numbers.
 */
function StockChart({ rows, className }: { rows: WarehouseRow[]; className?: string }) {
  const { t, locale } = useI18n();
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(0, ...rows.map((r) => r.available));
  const groups = groupByCountry(rows, (r) => countryFromWarehouseCode(r.warehouseCode), (r) => r.warehouseName, locale);

  return (
    <section
      className={cn('rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]', className)}
      aria-label={t('home.stockByWarehouse')}
    >
      <h2 className="font-semibold">{t('home.stockByWarehouse')}</h2>
      <p className="text-xs text-muted-foreground">{t('home.stockByWarehouseSub')}</p>

      {max === 0 && <p className="mt-6 text-sm text-muted-foreground">{t('home.noStockChart')}</p>}

      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.code ?? 'none'} className="space-y-1">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="me-1.5" aria-hidden>
                {flagOf(group.code)}
              </span>
              {countryName(group.code, locale)}
            </p>
            {group.items.map((row) => (
              <div
                key={row.warehouseId}
                className="relative grid grid-cols-[9.5rem_1fr_2.75rem] items-center gap-3 rounded-md px-1 py-1 hover:bg-accent/50 sm:grid-cols-[10rem_1fr_3.5rem]"
                onMouseEnter={() => setHover(row.warehouseId)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="truncate text-sm">{row.warehouseName}</span>
                <div className="h-2.5 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-chart-1 transition-[width] duration-500"
                    style={{ width: max ? `${(row.available / max) * 100}%` : 0, minWidth: row.available ? 4 : 0 }}
                  />
                </div>
                <span className="tabular text-end text-sm font-semibold">{formatNumber(row.available)}</span>

                {hover === row.warehouseId && (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute end-0 top-full z-10 mt-1 w-52 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
                  >
                    <p className="font-semibold">
                      {row.warehouseName} <span className="text-muted-foreground">{row.warehouseCode}</span>
                    </p>
                    <dl className="mt-1.5 space-y-0.5">
                      {(
                        [
                          [t('home.available'), row.available],
                          ['In transfer', row.inTransfer],
                          [t('home.sold'), row.sold],
                          ['Total', row.total],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="flex justify-between">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="tabular font-medium">{formatNumber(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
