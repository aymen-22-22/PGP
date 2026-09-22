import { ArrowLeft, PackageCheck, ScanLine, Tags } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { formatDate, formatNumber } from '@/lib/utils';

interface PurchaseDetail {
  id: string;
  number: string;
  status: string;
  currency: string;
  totalAmount: string;
  purchaseDate: string;
  notes: string | null;
  supplier: { name: string; country: string | null };
  warehouse: { id: string; name: string };
  createdBy: { name: string } | null;
  items: {
    id: string;
    quantity: number;
    receivedQuantity: number;
    remainingQuantity: number;
    unitPrice: string;
    totalPrice: string;
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
  const outstanding = purchase.items.reduce((sum, i) => sum + i.remainingQuantity, 0);
  const canReceive = outstanding > 0 && !['CANCELLED', 'RECEIVED'].includes(purchase.status);

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
              <h1 className="tabular text-xl font-bold">{purchase.number}</h1>
              <p className="text-base font-medium">{purchase.supplier.name}</p>
              <p className="text-sm text-muted-foreground">
                → {purchase.warehouse.name} · {formatDate(purchase.purchaseDate)}
              </p>
            </div>
            <StatusBadge status={purchase.status} />
          </div>

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
            </div>
          )}

          <TableWrap className="border-x-0">
            <thead>
              <tr>
                <Th>{t('common.product')}</Th>
                <Th className="text-end">{t('purchase.ordered')}</Th>
                <Th className="text-end">{t('purchase.receivedHeader')}</Th>
                <Th className="text-end">{t('ledger.unitPrice')}</Th>
                <Th className="text-end">{t('common.total')}</Th>
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((item) => (
                <Tr key={item.id}>
                  <Td className="max-w-[14rem] truncate font-medium">{item.product.name}</Td>
                  <Td className="tabular text-end">{formatNumber(item.quantity)}</Td>
                  <Td className="tabular text-end font-semibold">{formatNumber(item.receivedQuantity)}</Td>
                  <Td className="tabular text-end">{money(item.unitPrice, purchase.currency)}</Td>
                  <Td className="tabular text-end">{money(item.totalPrice, purchase.currency)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>

          <p className="text-end text-base font-bold">
            {money(purchase.totalAmount, purchase.currency)}
          </p>
        </CardContent>
      </Card>

      {canReceive && <ReceiveGoods purchase={purchase} onDone={() => void query.refetch()} />}

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

/** Goods-in: scan every arriving IMEI onto the right purchase line. */
function ReceiveGoods({ purchase, onDone }: { purchase: PurchaseDetail; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const openLines = purchase.items.filter((i) => i.remainingQuantity > 0);
  const [lineId, setLineId] = useState(openLines[0]?.id ?? '');
  const line = purchase.items.find((i) => i.id === lineId) ?? openLines[0];
  const buffer = useScanBuffer({ expected: line?.remainingQuantity });
  const [allowPartial, setAllowPartial] = useState(false);
  // Accessories are counted, not scanned, so the whole scanning apparatus is
  // replaced by one number.
  const [countedQuantity, setCountedQuantity] = useState('');

  const receive = useApiMutation(
    (body: unknown) =>
      api.post<{ scanned: number; missing: number; receiptNumber: string; pendingValidation: boolean }>(
        `/purchases/${purchase.id}/receive`,
        body,
      ),
    ['/purchases', '/inventory', '/reports', '/receipts'],
  );

  if (!line) return null;
  const expected = line.remainingQuantity;
  const isBulk = line.product.tracking === 'BULK';
  const counted = Number(countedQuantity);
  const received = isBulk ? (Number.isFinite(counted) ? counted : 0) : buffer.count;
  const over = received > expected;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageCheck className="h-5 w-5" aria-hidden />
          {t('purchase.receiveInto', { warehouse: purchase.warehouse.name })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {openLines.length > 1 && (
          <div className="space-y-1.5">
            <label htmlFor="line" className="text-sm font-medium">
              {t('purchase.receivingProduct')}
            </label>
            <select
              id="line"
              value={lineId}
              onChange={(e) => {
                setLineId(e.target.value);
                buffer.reset();
                setCountedQuantity('');
              }}
              className="flex h-12 w-full rounded-md border-2 border-input bg-background px-3 text-base"
            >
              {openLines.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.product.name} — {t('purchase.outstanding', { count: item.remainingQuantity })}
                </option>
              ))}
            </select>
          </div>
        )}

        <ScanProgress expected={expected} scanned={received} />

        {isBulk ? (
          <div className="space-y-1.5">
            <label htmlFor="counted" className="text-sm font-medium">
              {t('purchase.howMany')}
            </label>
            <input
              id="counted"
              type="number"
              inputMode="numeric"
              min={0}
              max={expected}
              autoFocus
              value={countedQuantity}
              onChange={(e) => setCountedQuantity(e.target.value)}
              placeholder={String(expected)}
              className="tabular flex h-16 w-full rounded-md border-2 border-input bg-background px-4 text-center text-3xl font-semibold"
            />
            <p className="text-xs text-muted-foreground">
              {t('purchase.bulkHint', { name: line.product.name })}
            </p>
          </div>
        ) : (
          <>
            <ScanInput onScan={(imei) => buffer.add(imei)} outcome={buffer.lastOutcome} disabled={over} />
            <CameraScanner onDetect={(imei) => buffer.add(imei)} />
          </>
        )}

        {over && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {isBulk
              ? t('purchase.overBulk', { expected: formatNumber(expected), over: formatNumber(received - expected) })
              : t('purchase.overSerialized', { over: formatNumber(received - expected) })}
          </div>
        )}

        {!isBulk && <ScanList entries={buffer.entries} onRemove={buffer.remove} />}

        {received > 0 && received < expected && (
          <label className="flex touch-target items-center gap-3 rounded-md border p-3">
            <input
              type="checkbox"
              checked={allowPartial}
              onChange={(e) => setAllowPartial(e.target.checked)}
              className="h-5 w-5 accent-[hsl(var(--primary))]"
            />
            <span className="text-sm">
              {t('purchase.acceptShort', { missing: formatNumber(expected - received) })}
            </span>
          </label>
        )}

        <FormError error={receive.error} />

        <Button
          size="xl"
          variant={received === expected ? 'success' : 'default'}
          className="w-full"
          disabled={received === 0 || over || receive.isPending || (received < expected && !allowPartial)}
          onClick={() =>
            receive.mutate(
              {
                lines: [
                  isBulk
                    ? { purchaseItemId: line.id, quantity: received }
                    : { purchaseItemId: line.id, imeis: buffer.imeis },
                ],
                allowPartial,
              },
              {
                onSuccess: (result) => {
                  toast.push(
                    'success',
                    result.pendingValidation
                      ? t(isBulk ? 'purchase.awaitingUnit' : 'purchase.awaitingPhone', { count: result.scanned })
                      : t(isBulk ? 'purchase.inStockUnit' : 'purchase.inStockPhone', { count: result.scanned }),
                  );
                  buffer.reset();
                  setCountedQuantity('');
                  setAllowPartial(false);
                  onDone();
                },
                onError: (error) => toast.push('error', error.message),
              },
            )
          }
        >
          {receive.isPending
            ? t('purchase.receiving')
            : t(isBulk ? 'purchase.receiveUnit' : 'purchase.receivePhone', { count: received })}
        </Button>
      </CardContent>
    </Card>
  );
}
