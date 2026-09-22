import { ArrowLeft, ArrowRight, PackageCheck, Send, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CancelAction } from '@/components/cancel-action';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { CodeList } from '@/features/scanner/code-list';
import { CodeScanInput } from '@/features/scanner/code-scan-input';
import { ScanProgress } from '@/features/scanner/scan-list';
import { useCodeBuffer } from '@/features/scanner/use-code-buffer';
import { api } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/i18n/provider';

interface TransferDetail {
  id: string;
  number: string;
  status: string;
  notes: string | null;
  sourceWarehouse: { id: string; name: string; code: string };
  destinationWarehouse: { id: string; name: string; code: string };
  createdBy: { name: string } | null;
  createdAt: string;
  plannedQuantity: number;
  loadedQuantity: number;
  receivedQuantity: number;
  shipment: {
    number: string;
    status: string;
    carrier: string | null;
    shippedAt: string | null;
    receivedAt: string | null;
    shippedBy: { name: string } | null;
    receivedBy: { name: string } | null;
    deliveryCompany: { id: string; name: string } | null;
    driver: { id: string; name: string } | null;
  } | null;
  items: { id: string; quantity: number; product: { id: string; name: string; sku: string } }[];
  devices: { id: string; imei: string; receivedAt: string | null; device: { status: string } }[];
}

export default function TransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, dateTime } = useI18n();
  const user = useAuth((s) => s.user);
  const toast = useToast();
  const query = useApiQuery<TransferDetail>(`/transfers/${id}`);

  if (query.isLoading) return <LoadingState label={t('common.loading')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const transfer = query.data!;
  const isSource = user?.role === 'ADMIN' || user?.warehouseId === transfer.sourceWarehouse.id;
  const isDestination = user?.role === 'ADMIN' || user?.warehouseId === transfer.destinationWarehouse.id;
  const canShip = isSource && ['DRAFT', 'READY'].includes(transfer.status);
  const canReceive = isDestination && transfer.status === 'IN_TRANSIT';
  const canCancel = isSource && ['DRAFT', 'READY'].includes(transfer.status);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ms-2 gap-1">
        <Link to="/transfers">
          <ArrowLeft className="h-4 w-4" />
          {t('transfer.all')}
        </Link>
      </Button>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="tabular text-xl font-bold">{transfer.number}</h1>
              <p className="flex flex-wrap items-center gap-1.5 text-base font-medium">
                {transfer.sourceWarehouse.name}
                <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                {transfer.destinationWarehouse.name}
              </p>
            </div>
            <StatusBadge status={transfer.status} />
          </div>

          {canCancel && (
            <CancelAction
              path={`/transfers/${id}/cancel`}
              confirmLabel={t('transfer.cancelConfirm')}
              invalidatePrefixes={['/transfers']}
              onDone={() => {
                toast.push('success', t('transfer.cancelled'));
                void query.refetch();
              }}
            />
          )}

          <div className="grid grid-cols-3 gap-2 border-t pt-3 text-center">
            <Figure label={t('transfer.planned')} value={transfer.plannedQuantity} />
            <Figure label={t('transfer.loaded')} value={transfer.loadedQuantity} />
            <Figure label={t('common.received')} value={transfer.receivedQuantity} tone="success" />
          </div>

          {transfer.shipment && (
            <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('transfer.shipment')}</dt>
                <dd className="tabular font-medium">{transfer.shipment.number}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('transfer.shipped')}</dt>
                <dd className="font-medium">
                  {transfer.shipment.shippedAt ? dateTime(transfer.shipment.shippedAt) : t('transfer.notYet')}
                  {transfer.shipment.shippedBy && ` · ${transfer.shipment.shippedBy.name}`}
                </dd>
              </div>
              {(transfer.shipment.deliveryCompany || transfer.shipment.driver || transfer.shipment.carrier) && (
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('delivery.carrier')}
                  </dt>
                  <dd className="font-medium">
                    {[transfer.shipment.deliveryCompany?.name, transfer.shipment.driver?.name]
                      .filter(Boolean)
                      .join(' · ') || transfer.shipment.carrier}
                  </dd>
                </div>
              )}
              {transfer.shipment.receivedAt && (
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.received')}</dt>
                  <dd className="font-medium">
                    {dateTime(transfer.shipment.receivedAt)}
                    {transfer.shipment.receivedBy && ` · ${transfer.shipment.receivedBy.name}`}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </CardContent>
      </Card>

      {canShip && <PrepareAndShip transfer={transfer} onDone={() => void query.refetch()} />}
      {canReceive && <ReceiveShipment transfer={transfer} onDone={() => void query.refetch()} />}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t('transfer.phonesOn', { count: transfer.devices.length })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {transfer.devices.length === 0 ? (
            <EmptyState
              title={t('transfer.nothingLoaded')}
              description={t('transfer.nothingLoaded.body')}
            />
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto rounded-md border">
              {transfer.devices.map((line) => (
                <li key={line.id} className="flex items-center gap-3 px-3 py-2.5">
                  {/^\d+$/.test(line.imei) ? (
                    <Link to={`/imei/${line.imei}`} className="tabular flex-1 truncate font-medium hover:underline">
                      {line.imei}
                    </Link>
                  ) : (
                    <span className="tabular flex-1 truncate font-medium">{line.imei}</span>
                  )}
                  <StatusBadge status={line.receivedAt ? 'RECEIVED' : line.device.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Source-warehouse actions: fill the transfer, then dispatch it. */
function PrepareAndShip({ transfer, onDone }: { transfer: TransferDetail; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const buffer = useCodeBuffer();

  const autoFill = useApiMutation(
    () => api.post<{ added: number }>(`/transfers/${transfer.id}/auto-fill`),
    ['/transfers', '/inventory', '/reports'],
  );
  const load = useApiMutation(
    (codes: string[]) => api.post<{ added: number }>(`/transfers/${transfer.id}/load`, { imeis: codes }),
    ['/transfers', '/inventory'],
  );
  const ship = useApiMutation(
    () => api.post<{ shipmentNumber: string; shippedDevices: number }>(`/transfers/${transfer.id}/ship`, {}),
    ['/transfers', '/inventory', '/reports'],
  );

  const remaining = transfer.plannedQuantity - transfer.loadedQuantity;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('transfer.prepareAndSend')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {remaining > 0 && (
          <>
            <CodeScanInput
              onScan={(code) => buffer.add(code)}
              outcome={buffer.lastOutcome}
              label={t('transfer.scanToLoad', { remaining: String(remaining) })}
            />

            {buffer.count > 0 && (
              <>
                <CodeList entries={buffer.entries} onRemove={buffer.remove} />
                <Button
                  size="lg"
                  className="w-full"
                  disabled={load.isPending}
                  onClick={() =>
                    load.mutate(buffer.codes, {
                      onSuccess: (result) => {
                        toast.push('success', t('transfer.phonesLoaded', { count: result.added }));
                        buffer.reset();
                        onDone();
                      },
                      onError: (error) => toast.push('error', error.message),
                    })
                  }
                >
                  {load.isPending ? t('common.loading') : t('transfer.loadPhones', { count: buffer.count })}
                </Button>
              </>
            )}

            <Button
              variant="outline"
              size="lg"
              className="w-full gap-2"
              disabled={autoFill.isPending}
              onClick={() =>
                autoFill.mutate(undefined, {
                  onSuccess: (result) => {
                    toast.push('success', t('transfer.addedAuto', { count: result.added }));
                    onDone();
                  },
                  onError: (error) => toast.push('error', error.message),
                })
              }
            >
              <Wand2 className="h-5 w-5" />
              {autoFill.isPending
                ? t('transfer.filling')
                : t('transfer.fillOldest', { remaining: String(remaining) })}
            </Button>

            <FormError error={load.error ?? autoFill.error} />
          </>
        )}

        <Button
          size="xl"
          className="w-full gap-2"
          disabled={transfer.loadedQuantity === 0 || ship.isPending}
          onClick={() =>
            ship.mutate(undefined, {
              onSuccess: (result) => {
                toast.push(
                  'success',
                  t('transfer.shippedPhones', {
                    count: result.shippedDevices,
                    shipment: result.shipmentNumber,
                  }),
                );
                onDone();
              },
              onError: (error) => toast.push('error', error.message),
            })
          }
        >
          <Send className="h-6 w-6" />
          {ship.isPending ? t('transfer.sending') : t('transfer.sendPhones', { count: transfer.loadedQuantity })}
        </Button>
        <FormError error={ship.error} />
      </CardContent>
    </Card>
  );
}

/**
 * Destination-warehouse goods-in: the screen Jean uses in the specification's
 * scenario. Expected / scanned / missing, then one big confirm button.
 */
function ReceiveShipment({ transfer, onDone }: { transfer: TransferDetail; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const expectedCodes = useMemo(
    () => new Set(transfer.devices.filter((d) => !d.receivedAt).map((d) => d.imei)),
    [transfer.devices],
  );
  const expected = expectedCodes.size;
  // Giving the buffer the expected set means a phone from another shipment is
  // called out on the scan itself, not discovered at the end of a long batch.
  const buffer = useCodeBuffer({
    expected,
    expectedCodes,
    strayReason: t('transfer.strayReason'),
  });
  const [allowPartial, setAllowPartial] = useState(false);

  const receive = useApiMutation(
    (body: { imeis: string[]; allowPartial: boolean }) =>
      api.post<{ scanned: number; missing: number; status: string; receivedBy: string }>(
        `/transfers/${transfer.id}/receive`,
        body,
      ),
    ['/transfers', '/inventory', '/reports', '/receipts'],
  );

  const strays = buffer.strays;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageCheck className="h-5 w-5" aria-hidden />
          {t('transfer.receiveShipment')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScanProgress expected={expected} scanned={buffer.count} />

        <CodeScanInput onScan={(code) => buffer.add(code)} outcome={buffer.lastOutcome} />

        {strays.length > 0 && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <p className="font-semibold">{t('transfer.strayAlert', { count: strays.length })}</p>
            <p className="tabular mt-1">{strays.slice(0, 5).join(', ')}</p>
            <p className="mt-1">{t('transfer.removeStray', { count: strays.length })}</p>
          </div>
        )}

        <CodeList entries={buffer.entries} onRemove={buffer.remove} />

        {buffer.count > 0 && buffer.count < expected && (
          <label className="flex touch-target items-center gap-3 rounded-md border p-3">
            <input
              type="checkbox"
              checked={allowPartial}
              onChange={(e) => setAllowPartial(e.target.checked)}
              className="h-5 w-5 accent-[hsl(var(--primary))]"
            />
            <span className="text-sm">
              {t('transfer.shortLabel')} <strong>{t('transfer.missing', { count: expected - buffer.count })}</strong>.{' '}
              {t('transfer.staysOpen')}
            </span>
          </label>
        )}

        <FormError error={receive.error} />

        <Button
          size="xl"
          variant={buffer.count === expected ? 'success' : 'default'}
          className="w-full"
          disabled={
            buffer.count === 0 ||
            strays.length > 0 ||
            receive.isPending ||
            (buffer.count < expected && !allowPartial)
          }
          onClick={() =>
            receive.mutate(
              { imeis: buffer.codes, allowPartial },
              {
                onSuccess: (result) => {
                  if (result.missing > 0) {
                    toast.push(
                      'success',
                      t('transfer.shortDelivery', {
                        scanned: String(result.scanned),
                        missing: String(result.missing),
                      }),
                    );
                  } else {
                    toast.push('success', t('transfer.allReceived', { count: result.scanned }));
                  }
                  buffer.reset();
                  onDone();
                },
                onError: (error) => toast.push('error', error.message),
              },
            )
          }
        >
          {receive.isPending ? t('transfer.confirming') : t('transfer.confirmReceipt', { count: buffer.count })}
        </Button>
      </CardContent>
    </Card>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: 'success' }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`tabular text-stat ${tone === 'success' ? 'text-success' : ''}`}>{value}</p>
    </div>
  );
}
