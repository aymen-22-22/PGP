import { Image as ImageIcon, Package } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { BackButton } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import type { ProductStockCard, ProductStockCards } from '@phone-erp/shared-types';
import { useI18n } from '@/i18n/provider';
import { useApiQuery } from '@/hooks/use-api';
import { isAdmin, useAuth } from '@/lib/auth';
import { formatNumber } from '@/lib/utils';


/** Phrase keys, not phrases: the chips are drawn in three languages. */
export const STOCK_STATUS: Record<ProductStockCard['status'], { label: string; tone: string }> = {
  IN_STOCK: { label: 'stock.status.inStock', tone: 'bg-success/10 text-success border-success/30' },
  LOW: { label: 'stock.status.low', tone: 'bg-warning/10 text-warning border-warning/30' },
  OUT_OF_STOCK: { label: 'stock.status.out', tone: 'bg-muted text-muted-foreground border-border' },
};

/** What is actually on the shelf, in this category, in this warehouse. */
export default function StockProductsPage() {
  // Stock value is office information; the floor sees quantities.
  const showMoney = isAdmin(useAuth((s) => s.user));
  const { t, money } = useI18n();
  const { warehouseId, category } = useParams<{ warehouseId: string; category: string }>();
  const query = useApiQuery<ProductStockCards>(
    `/stock-explorer/warehouses/${warehouseId}/categories/${encodeURIComponent(category ?? '')}/products`,
  );

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { warehouse, data } = query.data!;
  const total = data.reduce((sum, p) => sum + Number(p.stockValue), 0);

  return (
    <div className="space-y-5">
      <BackButton label={warehouse.name} />

      <header className="space-y-1">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link to="/stock" className="hover:underline">
            {t('stock.title')}
          </Link>
          <span aria-hidden> → </span>
          <Link to={`/stock/${warehouseId}`} className="hover:underline">
            {warehouse.name}
          </Link>
          <span aria-hidden> → </span>
          <span className="font-medium text-foreground">{category}</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight">{category}</h1>
        <p className="text-sm text-muted-foreground">
          {t('common.products')} · {data.length}
          {showMoney && <> · {t('stock.onShelfValue', { value: money(total.toFixed(2)) })}</>}
        </p>
      </header>

      {data.length === 0 && (
        <EmptyState icon={Package} title={t('stock.noProducts.title')} description={t('stock.noProducts.body')} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((product) => {
          const status = STOCK_STATUS[product.status];
          return (
            <Link
              key={product.productId}
              to={`/stock/${warehouseId}/product/${product.productId}`}
              className="group flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="flex h-36 items-center justify-center bg-muted">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-9 w-9 text-muted-foreground" aria-hidden />
                )}
              </div>

              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-bold leading-tight">{product.name}</p>
                  <p className="tabular text-xs text-muted-foreground">SKU {product.sku}</p>
                  {product.barcode && (
                    <p className="tabular text-xs text-muted-foreground">Barcode {product.barcode}</p>
                  )}
                </div>

                <dl className="grid grid-cols-3 gap-2 border-t pt-3 text-center text-sm">
                  <Count label={t('stock.available')} value={product.quantity} tone="text-success" />
                  <Count label={t('stock.inShipment')} value={product.inShipment} />
                  <Count label={t('stock.soldLabel')} value={product.sold} tone="text-muted-foreground" />
                </dl>

                <div className="mt-auto flex items-end justify-between gap-2 border-t pt-3">
                  {showMoney ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('stock.stockValue')}</p>
                      <p className="tabular font-bold">{money(product.stockValue!)}</p>
                    </div>
                  ) : (
                    <span />
                  )}
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${status.tone}`}>
                    {t(status.label)}
                  </span>
                </div>

                {product.tracking === 'BULK' && (
                  <Badge variant="secondary" className="self-start">
                    {t('stock.countedByQuantity')}
                  </Badge>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <dt className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`tabular text-lg font-bold ${tone ?? ''}`}>{formatNumber(value)}</dd>
    </div>
  );
}
