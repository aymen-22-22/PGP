import { Image as ImageIcon, Package, Truck } from 'lucide-react';
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

      {/* Same cards as the scanner: the photo first, the numbers as icon badges on it. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {data.map((product) => {
          const status = STOCK_STATUS[product.status];
          return (
            <Link
              key={product.productId}
              to={`/stock/${warehouseId}/product/${product.productId}`}
              className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition hover:border-primary/50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="relative flex aspect-square items-center justify-center bg-muted">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-10 w-10 text-muted-foreground" aria-hidden />
                )}
                <span
                  className="absolute start-2 top-2 flex h-9 items-center gap-1 rounded-full bg-emerald-600 px-2.5 text-lg font-black text-white shadow"
                  title={t('stock.available')}
                >
                  <Package className="h-4 w-4" strokeWidth={3} aria-hidden />
                  {formatNumber(product.quantity)}
                </span>
                {product.inShipment > 0 && (
                  <span
                    className="absolute end-2 top-2 flex h-9 items-center gap-1 rounded-full bg-orange-500 px-2.5 text-lg font-black text-white shadow"
                    title={t('stock.inShipment')}
                  >
                    <Truck className="h-4 w-4" strokeWidth={3} aria-hidden />
                    {formatNumber(product.inShipment)}
                  </span>
                )}
                <span className={`absolute bottom-2 start-2 rounded-md border bg-card/90 px-2 py-0.5 text-xs font-medium ${status.tone}`}>
                  {t(status.label)}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="line-clamp-2 text-sm font-bold leading-tight">{product.name}</p>
                {showMoney && (
                  <p className="tabular mt-auto text-sm font-semibold text-muted-foreground">{money(product.stockValue!)}</p>
                )}
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

