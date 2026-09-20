import { Boxes, Layers, Package, Warehouse as WarehouseIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import type { Listed, WarehouseStockCard } from '@phone-erp/shared-types';
import { useI18n } from '@/i18n/provider';
import { useApiQuery } from '@/hooks/use-api';


/** A flag for the country, which reads faster than the country's name. */
const FLAGS: Record<string, string> = { FR: '🇫🇷', ES: '🇪🇸', DZ: '🇩🇿', NL: '🇳🇱', CN: '🇨🇳' };

/**
 * The way into the stock: which building, then what is in it.
 *
 * This list comes back already filtered by the API — a warehouse someone may
 * not open is never sent, rather than sent and hidden.
 */
export default function StockWarehousesPage() {
  const { t, money, n } = useI18n();
  const query = useApiQuery<Listed<WarehouseStockCard>>('/stock-explorer/warehouses');

  if (query.isLoading) return <LoadingState label={t('common.loading')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const warehouses = query.data!.data;
  const total = warehouses.reduce((sum, w) => sum + Number(w.stockValue), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('stock.title')}
        description={
          warehouses.length === 1
            ? t('stock.oneWarehouse')
            : t('stock.manyWarehouses', { count: warehouses.length, value: money(total.toFixed(2)) })
        }
        action={
          <Button asChild variant="outline">
            <Link to="/stock/search">{t('stock.findOne')}</Link>
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {warehouses.map((warehouse) => (
          <Link
            key={warehouse.id}
            to={`/stock/${warehouse.id}`}
            className="group flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {/* A photo of the actual building when there is one. The flag is
                the fallback, not the intent: staff recognise their own yard
                faster than they read a code. */}
            <div className="relative flex h-32 items-center justify-center bg-muted">
              {warehouse.imageUrl ? (
                <img src={warehouse.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <span className="text-4xl" aria-hidden>
                  {warehouse.countryCode ? (FLAGS[warehouse.countryCode] ?? '🏭') : '🏭'}
                </span>
              )}
              {warehouse.imageUrl && warehouse.countryCode && (
                <span
                  className="absolute end-2 top-2 rounded-md bg-background/85 px-1.5 py-0.5 text-base shadow-sm backdrop-blur"
                  aria-hidden
                >
                  {FLAGS[warehouse.countryCode] ?? '🏭'}
                </span>
              )}
            </div>

            <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="truncate text-base font-bold leading-tight">{warehouse.name}</p>
              <p className="tabular text-xs text-muted-foreground">
                {warehouse.code}
                {warehouse.location && ` · ${warehouse.location}`}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-sm">
              <Figure icon={Package} label={t('common.products')} value={n(warehouse.products)} />
              <Figure icon={Layers} label={t('stock.card.brands')} value={n(warehouse.categories)} />
              <Figure icon={Boxes} label={t('common.quantity')} value={n(warehouse.quantity)} />
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('stock.stockValue')}</dt>
                <dd className="tabular font-bold text-success">
                  {money(warehouse.stockValue, warehouse.currency, { round: true })}
                </dd>
              </div>
            </dl>

            <div className="mt-auto flex items-center justify-between border-t pt-3">
              {warehouse.quantity === 0 ? (
                <Badge variant="secondary">{t('stock.card.empty')}</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('stock.card.onShelf', { count: warehouse.quantity })}
                </span>
              )}
              <span className="text-sm font-medium text-primary group-hover:underline">
                {t('stock.card.viewStock')} →
              </span>
            </div>
            </div>
          </Link>
        ))}
      </div>
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
      <dt className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden />
        {label}
      </dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  );
}
