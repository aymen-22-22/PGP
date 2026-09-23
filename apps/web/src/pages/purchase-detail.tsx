import { ArrowLeft, PackageCheck, ScanLine, ShoppingCart, Tags, Truck } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CancelAction } from '@/components/cancel-action';
import { RouteLine, Steps } from '@/components/journey';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/utils';

interface PurchaseDetail {
  id: string;
  number: string;
  status: string;
  currency: string;
  /** Absent for a warehouse account — pricing is admin-only. */
  totalAmount?: string;
  purchaseDate: string;
  notes: string | null;
  supplier: { name: string; country: string | null };
  warehouse: { id: string; name: string; code?: string };
  createdBy: { name: string } | null;
  items: {
    id: string;
    quantity: number;
    receivedQuantity: number;
    remainingQuantity: number;
    unitPrice?: string;
    totalPrice?: string;
    product: { id: string; name: string; sku: string; tracking: 'SERIALIZED' | 'BULK' };
  }[];
  receipts: {
    id: string;
    number: string;
    status: string;
    scannedCount: number;
    createdAt: string;
    createdBy: { name: string } | null;
    validatedBy: { name: string } | null;
  }[];
}

export default function PurchaseDetailPage() {
  const { t, dateTime, money } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const query = useApiQuery<PurchaseDetail>(`/purchases/${id}`);

  // Reserving is idempotent, so the button stays available: a line whose
  // quantity grew needs topping up, and pressing it again is how that happens.
  const labels = useApiMutation(() => api.post(`/purchases/${id}/labels`, {}), ['/purchases']);

  if (query.isLoading) return <LoadingState label={t('purchase.loading')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const purchase = query.data!;
  const ordered = purchase.items.reduce((sum, item) => sum + item.quantity, 0);
  const received = purchase.items.reduce((sum, item) => sum + item.receivedQuantity, 0);
  const showPricing = purchase.totalAmount !== undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ms-2 gap-1">
        <Link to="/purchases">
          <ArrowLeft className="h-4 w-4" />
          {t('purchase.all')}
        </Link>
      </Button>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="tabular text-xs font-medium text-muted-foreground">
                {purchase.number} · {formatDate(purchase.purchaseDate)}
              </p>
              <h1 className="text-xl font-bold">
                {t(`journey.purchase.${purchase.status}`, { from: purchase.supplier.name, to: purchase.warehouse.name })}
              </h1>
            </div>
            <StatusBadge status={purchase.status} />
          </div>

          <RouteLine
            from={{ name: purchase.supplier.name }}
            to={{ name: purchase.warehouse.name, code: purchase.warehouse.code }}
            progress={ordered ? received / ordered : 0}
            cancelled={purchase.status === 'CANCELLED'}
          />

          <Steps
            className="border-t pt-4"
            steps={[
              {
                label: t('journey.step.ordered'),
                icon: ShoppingCart,
                state: purchase.status === 'DRAFT' ? 'current' : 'done',
                detail: [formatDate(purchase.purchaseDate), purchase.createdBy?.name].filter(Boolean).join(' · '),
              },
              {
                label: t('journey.step.arriving'),
                icon: Truck,
                state:
                  purchase.status === 'CANCELLED'
                    ? 'failed'
                    : received >= ordered && ordered > 0
                      ? 'done'
                      : purchase.status === 'DRAFT'
                        ? 'todo'
                        : 'current',
                detail: t('journey.units', { done: received, total: ordered }),
              },
              {
                label: t('journey.step.inStock'),
                icon: PackageCheck,
                state: purchase.status === 'RECEIVED' ? 'done' : 'todo',
                detail: purchase.warehouse.name,
              },
            ]}
          />

          {purchase.status !== 'CANCELLED' && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="gap-2"
                disabled={labels.isPending}
                onClick={() =>
                  labels.mutate(undefined, {
                    onSuccess: () => navigate(`/purchases/${id}/labels`),
                    onError: (error) => toast.push('error', error.message),
                  })
                }
              >
                <Tags className="h-4 w-4" />
                {t('labels.generate')}
              </Button>
              {purchase.status !== 'RECEIVED' && (
                <Button asChild className="gap-2">
                  <Link to={`/purchases/${id}/receive-scan`}>
                    <ScanLine className="h-4 w-4" />
                    {t('receiveScan.button')}
                  </Link>
                </Button>
              )}
              {(purchase.status === 'DRAFT' || purchase.status === 'ORDERED') && (
                <CancelAction
                  path={`/purchases/${id}/cancel`}
                  confirmLabel={t('purchase.cancelConfirm')}
                  invalidatePrefixes={['/purchases']}
                  onDone={() => {
                    toast.push('success', t('purchase.cancelled'));
                    void query.refetch();
                  }}
                />
              )}
            </div>
          )}

          <TableWrap className="border-x-0">
            <thead>
              <tr>
                <Th>{t('common.product')}</Th>
                <Th className="text-end">{t('purchase.ordered')}</Th>
                <Th className="text-end">{t('purchase.receivedHeader')}</Th>
                {/* Pricing is admin-only — the API omits it entirely for a
                    warehouse account, so these columns have nothing to show. */}
                {showPricing && (
                  <>
                    <Th className="text-end">{t('ledger.unitPrice')}</Th>
                    <Th className="text-end">{t('common.total')}</Th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((item) => (
                <Tr key={item.id}>
                  <Td className="max-w-[14rem] truncate font-medium">{item.product.name}</Td>
                  <Td className="tabular text-end">{formatNumber(item.quantity)}</Td>
                  <Td className="tabular text-end font-semibold">{formatNumber(item.receivedQuantity)}</Td>
                  {showPricing && (
                    <>
                      <Td className="tabular text-end">{money(item.unitPrice!, purchase.currency)}</Td>
                      <Td className="tabular text-end">{money(item.totalPrice!, purchase.currency)}</Td>
                    </>
                  )}
                </Tr>
              ))}
            </tbody>
          </TableWrap>

          {showPricing && (
            <p className="text-end text-base font-bold">
              {money(purchase.totalAmount!, purchase.currency)}
            </p>
          )}
        </CardContent>
      </Card>

      {purchase.receipts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('purchase.goodsIn')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {purchase.receipts.map((receipt) => (
                <li key={receipt.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="tabular font-medium">{receipt.number}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('purchase.scannedPhones', { count: receipt.scannedCount })} · {receipt.createdBy?.name ?? '—'} ·{' '}
                      {dateTime(receipt.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={receipt.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
