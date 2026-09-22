import { ArrowLeft, SendHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { CodeList } from '@/features/scanner/code-list';
import { CodeScanInput } from '@/features/scanner/code-scan-input';
import { useCodeBuffer } from '@/features/scanner/use-code-buffer';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface WarehouseOption {
  id: string;
  name: string;
  code: string;
}
interface ProductOption {
  id: string;
  name: string;
}

/**
 * Stock out, in the order the job actually happens: say where it is going and
 * what is going, scan the units off the shelf, then send. The transfer is
 * created and dispatched in one go at the end — nothing half-made is left
 * behind if the run is abandoned halfway.
 */
export default function SendPage() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);

  const warehouses = useApiQuery<WarehouseOption[]>('/warehouses');
  const products = useApiQuery<{ data: ProductOption[] }>('/products?pageSize=200');

  const [destinationId, setDestinationId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [scanning, setScanning] = useState(false);

  const planned = Number(quantity);
  const buffer = useCodeBuffer({ expected: planned > 0 ? planned : undefined });

  const send = useApiMutation<{ id: string; number: string }, void>(async () => {
    // Create with the scanned units already loaded, then dispatch: two calls,
    // but nothing exists at all until the shelf work is finished.
    const transfer = await api.post<{ id: string; number: string }>('/transfers', {
      sourceWarehouseId: user?.warehouseId,
      destinationWarehouseId: destinationId,
      items: [{ productId, quantity: planned }],
      imeis: buffer.codes,
    });
    await api.post(`/transfers/${transfer.id}/ship`, {});
    return transfer;
  }, ['/transfers', '/inventory', '/reports']);

  const destinations = useMemo(
    () => (warehouses.data ?? []).filter((w) => w.id !== user?.warehouseId),
    [warehouses.data, user?.warehouseId],
  );

  if (warehouses.isLoading || products.isLoading) return <LoadingState />;
  if (warehouses.isError) {
    return <ErrorState error={warehouses.error} onRetry={() => void warehouses.refetch()} />;
  }

  const ready = destinationId && productId && planned > 0;

  if (scanning) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="-ms-2 gap-1" onClick={() => setScanning(false)}>
            <ArrowLeft className="h-4 w-4" />
            {t('send.change')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {destinations.find((w) => w.id === destinationId)?.name}
          </span>
        </div>

        <p className="text-sm text-muted-foreground">
          {t('send.scanned', { count: buffer.count, planned: String(planned) })}
        </p>

        <CodeScanInput outcome={buffer.lastOutcome} onScan={(code) => buffer.add(code)} />

        <CodeList entries={buffer.entries} onRemove={buffer.remove} />

        <FormError error={send.error} />

        <Button
          className="w-full gap-2"
          size="lg"
          disabled={buffer.count === 0 || send.isPending}
          onClick={() =>
            send.mutate(undefined, {
              onSuccess: (transfer) => {
                toast.push('success', t('send.sent', { number: transfer.number, count: buffer.count }));
                navigate(`/transfers/${transfer.id}`);
              },
              onError: (error) => toast.push('error', error.message),
            })
          }
        >
          <SendHorizontal className="h-5 w-5" />
          {send.isPending ? t('send.sending') : t('send.dispatch', { count: buffer.count })}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.send')} description={t('send.lead')} />

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="send-destination">{t('transfers.to')}</Label>
          <Select
            id="send-destination"
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
            required
          >
            <option value="">{t('common.choose')}</option>
            {destinations.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="send-product">{t('common.product')}</Label>
          <Select id="send-product" value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="">{t('common.choose')}</option>
            {products.data?.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="send-quantity">{t('transfers.howMany')}</Label>
          <Input
            id="send-quantity"
            type="number"
            min={1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </div>

        <Button className="w-full" size="lg" disabled={!ready} onClick={() => setScanning(true)}>
          {t('send.startScanning')}
        </Button>
      </div>
    </div>
  );
}
