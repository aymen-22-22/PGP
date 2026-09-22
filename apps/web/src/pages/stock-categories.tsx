import { Image as ImageIcon, Layers } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { BackButton } from '@/components/page';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import type { BrandStockCards } from '@phone-erp/shared-types';
import { useI18n } from '@/i18n/provider';
import { useApiQuery } from '@/hooks/use-api';
import { isAdmin, useAuth } from '@/lib/auth';


/** Which makes are in this building. */
export default function StockCategoriesPage() {
  // Stock value is office information; the floor sees quantities.
  const showMoney = isAdmin(useAuth((s) => s.user));
  const { t, money, n } = useI18n();
  const { warehouseId } = useParams<{ warehouseId: string }>();
  const query = useApiQuery<BrandStockCards>(`/stock-explorer/warehouses/${warehouseId}/categories`);

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { warehouse, data } = query.data!;
  const total = data.reduce((sum, c) => sum + Number(c.stockValue), 0);

  return (
    <div className="space-y-5">
      <BackButton label={t('stock.allWarehouses')} />

      <header className="space-y-1">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link to="/stock" className="hover:underline">
            {t('stock.title')}
          </Link>
          <span aria-hidden> → </span>
          <span className="font-medium text-foreground">{warehouse.name}</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight">{warehouse.name}</h1>
        <p className="text-sm text-muted-foreground">
          <span className="tabular">{warehouse.code}</span> · {t('stock.brands', { count: data.length })} ·{' '}
          {showMoney ? t('stock.onShelfValue', { value: money(total.toFixed(2)) }) : ''}
        </p>
      </header>

      {data.length === 0 && (
        <EmptyState
          icon={Layers}
          title={t('stock.empty.title')}
          description={t('stock.empty.body')}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((category) => (
          <Link
            key={category.category}
            to={`/stock/${warehouseId}/${encodeURIComponent(category.category)}`}
            className="group overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {/* A product from the category stands in for it, so the grid is not
                a wall of identical placeholders. */}
            <div className="flex h-28 items-center justify-center bg-muted">
              {category.imageUrl ? (
                <img src={category.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-8 w-8 text-muted-foreground" aria-hidden />
              )}
            </div>

            <div className="space-y-3 p-4">
              <p className="truncate text-base font-bold uppercase tracking-wide">{category.category}</p>

              <dl className="space-y-1 text-sm">
                <Row label={t('common.products')} value={n(category.products)} />
                <Row label={t('common.quantity')} value={n(category.quantity)} />
                {showMoney && (
                  <div className="flex items-center justify-between border-t pt-1">
                    <dt className="text-muted-foreground">{t('stock.value')}</dt>
                    <dd className="tabular font-bold text-success">
                      {money(category.stockValue!, category.currency, { round: true })}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  );
}
