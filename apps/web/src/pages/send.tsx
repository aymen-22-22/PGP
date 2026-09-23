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
import { SelectOrCreate } from '@/components/select-or-create';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { NewCompanyForm, NewDriverForm } from './delivery';

interface WarehouseOption {
  id: string;
  name: string;
  code: string;
}
interface ProductOption {
  id: string;
  name: string;
}
interface CompanyOption {
  id: string;
  name: string;
  isActive: boolean;
}
interface DriverOption {
  id: string;
  name: string;
  company: { id: string; name: string } | null;
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
  const companies = useApiQuery<{ data: CompanyOption[] }>('/delivery/companies?pageSize=100');
  const drivers = useApiQuery<{ data: DriverOption[] }>('/delivery/drivers?pageSize=100');

  const [destinationId, setDestinationId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [deliveryCompanyId, setDeliveryCompanyId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [scanning, setScanning] = useState(false);

  const driversForCompany = useMemo(
    () => (drivers.data?.data ?? []).filter((d) => !deliveryCompanyId || d.company?.id === deliveryCompanyId),
    [drivers.data, deliveryCompanyId],
  );

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
      deliveryCompanyId: deliveryCompanyId || undefined,
      driverId: driverId || undefined,
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

  const carrierLabel = [
    companies.data?.data.find((c) => c.id === deliveryCompanyId)?.name,
    drivers.data?.data.find((d) => d.id === driverId)?.name,
  ]
    .filter(Boolean)
    .join(' · ');

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
            {carrierLabel && ` · ${carrierLabel}`}
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

        <SelectOrCreate
          id="send-carrier-company"
          label={`${t('delivery.carrierCompany')} (${t('common.optional')})`}
          value={deliveryCompanyId}
          onChange={(id) => {
            setDeliveryCompanyId(id);
            // A driver picked for a different firm no longer applies.
            setDriverId((current) =>
              drivers.data?.data.find((d) => d.id === current)?.company?.id === id ? current : '',
            );
          }}
          options={companies.data?.data ?? []}
          createLabel={t('delivery.newCompanyInline')}
        >
          {(done) => <NewCompanyForm onDone={(created) => created && done(created)} />}
        </SelectOrCreate>

        <SelectOrCreate
          id="send-carrier-driver"
          label={`${t('delivery.carrierDriver')} (${t('common.optional')})`}
          value={driverId}
          onChange={setDriverId}
          options={driversForCompany}
          createLabel={t('delivery.newDriverInline')}
        >
          {(done) => (
            <NewDriverForm companies={companies.data?.data ?? []} onDone={(created) => created && done(created)} />
          )}
        </SelectOrCreate>

        <Button className="w-full" size="lg" disabled={!ready} onClick={() => setScanning(true)}>
          {t('send.startScanning')}
        </Button>
      </div>
    </div>
  );
}
