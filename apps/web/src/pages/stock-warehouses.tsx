import { Boxes, Layers, Package, Warehouse as WarehouseIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import type { Listed, WarehouseStockCard } from '@phone-erp/shared-types';
import { useI18n } from '@/i18n/provider';
import { useApiQuery } from '@/hooks/use-api';
import { isAdmin, useAuth } from '@/lib/auth';
import { countryName, flagOf, groupByCountry } from '@/lib/countries';



/**
 * The way into the stock: which building, then what is in it.
 *
 * This list comes back already filtered by the API — a warehouse someone may
 * not open is never sent, rather than sent and hidden.
 */
export default function StockWarehousesPage() {
  // Stock value is office information; the floor sees quantities.
  const showMoney = isAdmin(useAuth((s) => s.user));
  const { t, money, n, locale } = useI18n();
  const query = useApiQuery<Listed<WarehouseStockCard>>('/stock-explorer/warehouses');

  if (query.isLoading) return <LoadingState label={t('common.loading')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const warehouses = query.data!.data;
  const total = warehouses.reduce((sum, w) => sum + Number(w.stockValue), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('stock.title')}
        description={
          warehouses.length === 1
            ? t('stock.oneWarehouse')
            : showMoney
              ? t('stock.manyWarehouses', { count: warehouses.length, value: money(total.toFixed(2)) })
              : t('stock.manyWarehousesPlain', { count: warehouses.length })
        }
        action={
          <Button asChild variant="outline">
            <Link to="/scan">{t('stock.findOne')}</Link>
          </Button>
        }
      />

      {warehouses.length === 0 && (
        <EmptyState
          icon={WarehouseIcon}
          title={t('stock.noWarehouse.title')}
          description={t('stock.noWarehouse.body')}
        />
      )}

      {groupByCountry(warehouses, (w) => w.countryCode, (w) => w.name, locale).map((group) => {
        const groupQty = group.items.reduce((sum, w) => sum + w.quantity, 0);
        const groupValue = group.items.reduce((sum, w) => sum + Number(w.stockValue ?? 0), 0);
        return (
          <section key={group.code ?? 'none'} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 border-b pb-1.5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="me-2" aria-hidden>
                  {flagOf(group.code)}
                </span>
                {countryName(group.code, locale)}
              </h2>
              <p className="tabular text-xs text-muted-foreground">
                {t('common.quantity')}: {n(groupQty)}
                {showMoney && ` · ${money(groupValue.toFixed(2), group.items[0]?.currency, { round: true })}`}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {group.items.map((warehouse) => (
                <Link
                  key={warehouse.id}
                  to={`/stock/${warehouse.id}`}
                  className="group flex flex-col gap-3 rounded-md border bg-card p-4 shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <div className="flex items-center gap-3">
                    {/* The building's photo when there is one — staff know their own
                        yard at a glance; otherwise the flag. */}
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                      {warehouse.imageUrl ? (
                        <img src={warehouse.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xl" aria-hidden>
                          {flagOf(warehouse.countryCode)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold leading-tight">{warehouse.name}</p>
                      <p className="tabular truncate text-xs text-muted-foreground">
                        {warehouse.code}
                        {warehouse.location && ` · ${warehouse.location}`}
                      </p>
                    </div>
                    {warehouse.quantity === 0 && <Badge variant="secondary">{t('stock.card.empty')}</Badge>}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-sm sm:grid-cols-4">
                    <Figure icon={Package} label={t('common.products')} value={n(warehouse.products)} />
                    <Figure icon={Layers} label={t('stock.card.brands')} value={n(warehouse.categories)} />
                    <Figure icon={Boxes} label={t('common.quantity')} value={n(warehouse.quantity)} />
                    {showMoney && (
                      <div className="min-w-0">
                        <dt className="truncate text-[0.68rem] uppercase tracking-wide text-muted-foreground">
                          {t('stock.stockValue')}
                        </dt>
                        <dd className="tabular truncate font-semibold">
                          {money(warehouse.stockValue!, warehouse.currency, { round: true })}
                        </dd>
                      </div>
                    )}
                  </dl>

                  <span className="text-sm font-medium text-primary group-hover:underline">
                    {t('stock.card.viewStock')} →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Figure({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Package;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[0.68rem] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden />
        {label}
      </dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  );
}
