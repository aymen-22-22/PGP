import {
  Building2,
  Image as ImageIcon,
  PackageCheck,
  ShoppingCart,
  Truck,
  Undo2,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { BackButton } from '@/components/page';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import type { Product360 } from '@phone-erp/shared-types';
import { useI18n } from '@/i18n/provider';
import { useApiQuery } from '@/hooks/use-api';
import { formatImei } from '@/lib/utils';
import { STOCK_STATUS } from './stock-products';


const MOVEMENT_ICON: Record<string, typeof Truck> = {
  PURCHASE_RECEIPT: PackageCheck,
  TRANSFER_OUT: Truck,
  TRANSFER_IN: Truck,
  SALE: ShoppingCart,
  RETURN: Undo2,
  ADJUSTMENT: Building2,
};

/** Where a movement's reference document lives, when it has one. */
const REFERENCE_LINK: Record<string, (id: string) => string> = {
  Purchase: (id) => `/purchases/${id}`,
  Transfer: (id) => `/transfers/${id}`,
  Sale: (id) => `/sales/${id}`,
};

/**
 * Everything that has happened to one product in one warehouse.
 *
 * Deliberately long: the promise of the page is that nobody has to go hunting
 * through purchases, transfers, sales and costing to understand a figure on a
 * card. Every section links out to the original document rather than restating
 * it, so this stays a map, not a copy.
 */
export default function StockProduct360Page() {
  const { t, date, dateTime, money, n } = useI18n();
  const { warehouseId, productId } = useParams<{ warehouseId: string; productId: string }>();
  const query = useApiQuery<Product360>(
    `/stock-explorer/warehouses/${warehouseId}/products/${productId}`,
  );

  if (query.isLoading) return <LoadingState label={t('stock360.loading')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { warehouse, product, stock, sellingPrice, units, purchases, sales, movements } = query.data!;
  const status = STOCK_STATUS[stock.status];
  const serialised = product.tracking === 'SERIALIZED';

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <BackButton label={product.category} />

      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link to="/stock" className="hover:underline">
          {t('nav.stock')}
        </Link>
        <span aria-hidden> → </span>
        <Link to={`/stock/${warehouseId}`} className="hover:underline">
          {warehouse.name}
        </Link>
        <span aria-hidden> → </span>
        <Link to={`/stock/${warehouseId}/${encodeURIComponent(product.category)}`} className="hover:underline">
          {product.category}
        </Link>
        <span aria-hidden> → </span>
        <span className="font-medium text-foreground">{product.name}</span>
      </nav>

      {/* ── identity ─────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
          <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-9 w-9 text-muted-foreground" aria-hidden />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-xl font-bold leading-snug">{product.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {product.brand.name} · {product.model}
                  {product.storage && ` · ${product.storage}`}
                  {product.color && ` · ${product.color}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${status.tone}`}>
                  {t(status.label)}
                </span>
                {!product.isActive && <Badge variant="secondary">{t('stock360.retired')}</Badge>}
                <Badge variant={serialised ? 'outline' : 'secondary'}>
                  {serialised ? t('stock.trackedByImei') : t('stock.countedByQuantity')}
                </Badge>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-sm sm:grid-cols-4">
              <Field label={t('common.sku')} value={product.sku} mono />
              <Field label={t('common.barcode')} value={product.barcode ?? t('common.notRecorded')} mono />
              {/* The browser groups by make, so this is the brand. */}
              <Field label={t('common.brand')} value={product.category} />
              <Field label={t('common.warehouse')} value={`${warehouse.name} · ${warehouse.code}`} />
            </dl>
          </div>
        </CardContent>
      </Card>

      {/* ── where the units are ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('stock360.whereUnits')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tally label={t('stock.available')} value={n(stock.available)} tone="text-success" />
            <Tally label={t('stock.inShipment')} value={n(stock.inShipment)} />
            <Tally label={t('stock.soldLabel')} value={n(stock.sold)} tone="text-muted-foreground" />
            <Tally label={t('stock360.returned')} value={n(stock.returned)} tone="text-muted-foreground" />
          </div>

          {serialised && (stock.awaitingValidation > 0 || stock.damaged > 0 || stock.lost > 0) && (
            <div className="grid grid-cols-3 gap-3 border-t pt-3">
              <Tally label={t('stock360.awaitingCheck')} value={n(stock.awaitingValidation)} tone="text-warning" />
              <Tally label={t('status.damaged')} value={n(stock.damaged)} tone="text-destructive" />
              <Tally label={t('status.lost')} value={n(stock.lost)} tone="text-destructive" />
            </div>
          )}

          <dl className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-3">
            <Field label={t('stock.stockValue')} value={money(stock.stockValue, stock.currency)} />
            <Field
              label={serialised ? t('stock360.avgLandedCost') : t('stock360.avgUnitCost')}
              value={money(stock.unitCost, stock.currency)}
            />
            <Field
              label={t('stock360.sellsFor')}
              value={
                sellingPrice
                  ? `${money(sellingPrice.price, sellingPrice.currency)} · ${sellingPrice.market}`
                  : money(product.defaultSalePrice, product.currency)
              }
            />
          </dl>

          {!serialised && stock.countedAt && (
            <p className="text-xs text-muted-foreground">
              {t('stock360.countedAt', { date: dateTime(stock.countedAt) })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── the units themselves ─────────────────────────────────────────── */}
      {serialised && units.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {stock.available > units.length
                ? t('stock360.onShelfMore', { shown: String(units.length), total: String(stock.available) })
                : t('stock360.onShelf')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {units.map((unit) => (
                <li key={unit.id}>
                  <Link
                    to={`/imei/${unit.imei}`}
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40"
                  >
                    <span className="tabular flex-1 truncate font-medium">{formatImei(unit.imei)}</span>
                    {unit.receivedAt && (
                      <span className="text-xs text-muted-foreground">{date(unit.receivedAt)}</span>
                    )}
                    <span className="tabular text-sm font-semibold">
                      {unit.landedCost ? money(unit.landedCost) : '—'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── how it arrived ───────────────────────────────────────────────── */}
      {purchases.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('stock360.howArrived')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TableWrap>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('stock360.purchase')}</Th>
                  <Th>{t('common.supplier')}</Th>
                  <Th className="text-end">{t('stock360.ordered')}</Th>
                  <Th className="text-end">{t('common.received')}</Th>
                  <Th className="text-end">{t('stock360.unitPrice')}</Th>
                  <Th className="text-end">{t('common.total')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {purchases.map((line) => (
                  <Tr key={line.purchaseId}>
                    <Td className="whitespace-nowrap text-muted-foreground">{date(line.date)}</Td>
                    <Td>
                      <Link to={`/purchases/${line.purchaseId}`} className="tabular font-medium hover:underline">
                        {line.number}
                      </Link>
                    </Td>
                    <Td className="text-muted-foreground">{line.supplier}</Td>
                    <Td className="tabular text-end">{n(line.ordered)}</Td>
                    <Td className="tabular text-end">{n(line.received)}</Td>
                    <Td className="tabular text-end text-muted-foreground">
                      {money(line.unitPrice, line.currency)}
                    </Td>
                    <Td className="tabular text-end font-semibold">
                      {money(line.totalPrice, line.currency)}
                    </Td>
                    <Td>
                      <StatusBadge status={line.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </CardContent>
        </Card>
      )}

      {/* ── how it left ──────────────────────────────────────────────────── */}
      {sales.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('stock360.howLeft')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TableWrap>
              <thead>
                <tr>
                  <Th>{t('common.date')}</Th>
                  <Th>{t('stock360.sale')}</Th>
                  <Th>{t('common.customer')}</Th>
                  <Th className="text-end">{t('stock360.qty')}</Th>
                  <Th className="text-end">{t('stock360.unitPrice')}</Th>
                  <Th className="text-end">{t('home.revenue')}</Th>
                  <Th className="text-end">{t('stock360.cost')}</Th>
                </tr>
              </thead>
              <tbody>
                {sales.map((line) => (
                  <Tr key={line.saleId}>
                    <Td className="whitespace-nowrap text-muted-foreground">
                      {line.date ? date(line.date) : '—'}
                    </Td>
                    <Td>
                      <Link to={`/sales/${line.saleId}`} className="tabular font-medium hover:underline">
                        {line.number}
                      </Link>
                    </Td>
                    <Td className="text-muted-foreground">{line.customer ?? t('common.walkIn')}</Td>
                    <Td className="tabular text-end">{n(line.quantity)}</Td>
                    <Td className="tabular text-end text-muted-foreground">
                      {money(line.unitPrice, line.currency)}
                    </Td>
                    <Td className="tabular text-end font-semibold">
                      {money(line.totalPrice, line.currency)}
                    </Td>
                    <Td className="tabular text-end">{money(line.cost)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </CardContent>
        </Card>
      )}

      {/* ── everything, in order ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('stock360.everything')}</CardTitle>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('stock360.noMovements')}</p>
          ) : (
            <ol className="relative space-y-0 border-s-2 border-border ps-6">
              {movements.map((movement) => {
                const Icon = MOVEMENT_ICON[movement.type] ?? Building2;
                const href =
                  movement.referenceType && movement.referenceId
                    ? REFERENCE_LINK[movement.referenceType]?.(movement.referenceId)
                    : undefined;
                return (
                  <li key={movement.id} className="relative pb-5 last:pb-0">
                    <span className="absolute -start-[2.15rem] flex h-7 w-7 items-center justify-center rounded-full border-2 border-border bg-card">
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="font-semibold leading-tight">{t(`movement.type.${movement.type}`)}</p>
                      <span className="tabular text-sm text-muted-foreground">
                        {movement.kind === 'QUANTITY'
                          ? `${movement.quantity > 0 ? '+' : ''}${n(movement.quantity)}`
                          : formatImei(movement.imei ?? '')}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {[movement.from, movement.to].filter(Boolean).join(' → ') || warehouse.name}
                      {movement.reference &&
                        (href ? (
                          <>
                            {' · '}
                            <Link to={href} className="tabular hover:underline">
                              {movement.reference}
                            </Link>
                          </>
                        ) : (
                          ` · ${movement.reference}`
                        ))}
                    </p>
                    {movement.notes && <p className="text-xs text-muted-foreground">{movement.notes}</p>}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {dateTime(movement.at)}
                      {movement.by && ` · ${movement.by}`}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`font-medium ${mono ? 'tabular' : ''}`}>{value}</dd>
    </div>
  );
}

function Tally({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`tabular text-2xl font-bold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}
