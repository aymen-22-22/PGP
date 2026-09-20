import { ArrowLeft, PackageCheck, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { CameraScanner } from '@/features/scanner/camera-scanner';
import { ScanInput } from '@/features/scanner/scan-input';
import { ScanList, ScanProgress } from '@/features/scanner/scan-list';
import { useScanBuffer } from '@/features/scanner/use-scan-buffer';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { formatImei, formatNumber } from '@/lib/utils';

interface SaleDetail {
  id: string;
  number: string;
  status: string;
  currency: string;
  totalAmount: string;
  totalCost: string;
  completedAt: string | null;
  // Null for a counter sale to a walk-in.
  customer: { name: string; country: string | null } | null;
  warehouse: { id: string; name: string };
  createdBy: { name: string } | null;
  items: {
    id: string;
    quantity: number;
    pickedCount: number;
    unitPrice: string;
    totalPrice: string;
    product: { id: string; name: string; sku: string };
  }[];
  devices: { id: string; imei: string; status: string; product: { name: string } }[];
}

export default function SaleDetailPage() {
  const { t, dateTime, money } = useI18n();
  const { id } = useParams<{ id: string }>();
  const query = useApiQuery<SaleDetail>(`/sales/${id}`);

  if (query.isLoading) return <LoadingState label={t('sale.loading')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const sale = query.data!;
  const outstanding = sale.items.reduce((sum, i) => sum + (i.quantity - i.pickedCount), 0);
  const canComplete = outstanding > 0 && ['DRAFT', 'CONFIRMED'].includes(sale.status);
  const profit = (Number(sale.totalAmount) - Number(sale.totalCost)).toFixed(2);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ms-2 gap-1">
        <Link to="/sales">
          <ArrowLeft className="h-4 w-4" />
          {t('sale.all')}
        </Link>
      </Button>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="tabular text-xl font-bold">{sale.number}</h1>
              <p className="text-base font-medium">{sale.customer?.name ?? t('sale.walkInCustomer')}</p>
              <p className="text-sm text-muted-foreground">
                {t('sale.from', { warehouse: sale.warehouse.name })}
                {sale.completedAt && <> · {t('sale.completed', { date: dateTime(sale.completedAt) })}</>}
              </p>
            </div>
            <StatusBadge status={sale.status} />
          </div>

          <TableWrap className="border-x-0">
            <thead>
              <tr>
                <Th>{t('common.product')}</Th>
                <Th className="text-end">{t('sale.qty')}</Th>
                <Th className="text-end">{t('sale.picked')}</Th>
                <Th className="text-end">{t('ledger.unitPrice')}</Th>
                <Th className="text-end">{t('common.total')}</Th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((item) => (
                <Tr key={item.id}>
                  <Td className="max-w-[14rem] truncate font-medium">{item.product.name}</Td>
                  <Td className="tabular text-end">{formatNumber(item.quantity)}</Td>
                  <Td className="tabular text-end font-semibold">{formatNumber(item.pickedCount)}</Td>
                  <Td className="tabular text-end">{money(item.unitPrice, sale.currency)}</Td>
                  <Td className="tabular text-end">{money(item.totalPrice, sale.currency)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>

          {sale.status === 'COMPLETED' && (
            <dl className="grid grid-cols-3 gap-2 rounded-md border bg-muted/40 p-3 text-center">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('home.revenue')}</dt>
                <dd className="tabular text-lg font-bold">{money(sale.totalAmount, sale.currency)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('stock360.cost')}</dt>
                <dd className="tabular text-lg font-bold">{money(sale.totalCost, sale.currency)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('home.profit')}</dt>
                <dd className="tabular text-lg font-bold text-success">{money(profit, sale.currency)}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {canComplete && <PickAndShip sale={sale} outstanding={outstanding} onDone={() => void query.refetch()} />}

      {sale.devices.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('sale.shippedPhones', { count: sale.devices.length })}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="max-h-96 divide-y overflow-y-auto rounded-md border">
              {sale.devices.map((device) => (
                <li key={device.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Link to={`/imei/${device.imei}`} className="tabular flex-1 truncate font-medium hover:underline">
                    {formatImei(device.imei)}
                  </Link>
                  <StatusBadge status={device.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Completing a sale means naming the exact phones that leave the building.
 * Scanning is the default; auto-pick exists for bulk orders where scanning each
 * of five hundred handsets a second time adds nothing.
 */
function PickAndShip({
  sale,
  outstanding,
  onDone,
}: {
  sale: SaleDetail;
  outstanding: number;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const buffer = useScanBuffer({ expected: outstanding });
  const [confirmingAuto, setConfirmingAuto] = useState(false);
  const over = buffer.count > outstanding;

  const complete = useApiMutation(
    (body: unknown) =>
      api.post<{ devicesSold: number; revenue: string; cost: string }>(`/sales/${sale.id}/complete`, body),
    ['/sales', '/inventory', '/reports'],
  );

  const onSuccess = (result: { devicesSold: number }) => {
    toast.push('success', t('sale.sold', { count: result.devicesSold }));
    buffer.reset();
    setConfirmingAuto(false);
    onDone();
  };
  const onError = (error: { message: string }) => toast.push('error', error.message);

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageCheck className="h-5 w-5" aria-hidden />
          {t('sale.pickForOrder')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScanProgress expected={outstanding} scanned={buffer.count} />

        <ScanInput onScan={(imei) => buffer.add(imei)} outcome={buffer.lastOutcome} disabled={over} />
        <CameraScanner onDetect={(imei) => buffer.add(imei)} />

        {over && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {t('sale.overPicked', { count: buffer.count - outstanding })}
          </div>
        )}

        <ScanList entries={buffer.entries} onRemove={buffer.remove} />

        <FormError error={complete.error} />

        <Button
          size="xl"
          variant={buffer.count === outstanding ? 'success' : 'default'}
          className="w-full"
          disabled={buffer.count !== outstanding || complete.isPending}
          onClick={() => complete.mutate({ imeis: buffer.imeis }, { onSuccess, onError })}
        >
          {complete.isPending
            ? t('sale.completing')
            : t('sale.complete', { count: buffer.count })}
        </Button>

        <div className="border-t pt-3">
          {confirmingAuto ? (
            <div className="space-y-2">
              <p className="text-sm">
                {t('sale.autoPickAsk', { oldest: t('sale.oldestPhone', { count: outstanding }) })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={complete.isPending}
                  onClick={() => complete.mutate({ autoPick: true }, { onSuccess, onError })}
                >
                  {t('sale.yesPick')}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingAuto(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" className="w-full gap-2" onClick={() => setConfirmingAuto(true)}>
              <Wand2 className="h-4 w-4" />
              {t('sale.autoPick')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
