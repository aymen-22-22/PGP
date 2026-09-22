import { Building2, PackageCheck, ShoppingCart, Truck, Undo2, User } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { BackButton } from '@/components/page';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { formatImei } from '@/lib/utils';

interface HistoryResponse {
  device: {
    imei: string | null;
    imei2: string | null;
    serialNumber: string | null;
    // Set only for a unit that arrived through the label-first workflow —
    // its printed code is the only handle it has when there is no IMEI.
    label: { code: string } | null;
    status: string;
    receivedAt: string | null;
    soldAt: string | null;
    purchaseCost: string | null;
    landedCost: string | null;
    product: { name: string; sku: string; barcode: string | null; brand: string; model: string };
    currentWarehouse: { id: string; name: string; country: string } | null;
    supplier: { id: string; name: string; country: string | null } | null;
    purchase: { id: string; number: string; purchaseDate: string } | null;
    // A counter sale to a walk-in has no customer record.
    sale: {
      id: string;
      number: string;
      customer: { name: string } | null;
      completedAt: string | null;
    } | null;
  };
  movements: {
    id: string;
    type: string;
    referenceNumber: string | null;
    createdAt: string;
    fromWarehouse: { name: string } | null;
    toWarehouse: { name: string } | null;
    performedBy: { name: string } | null;
    // Who actually carried it, when this movement was a transfer shipment.
    carrier: { name: string | null; driver: string | null; freeText: string | null } | null;
  }[];
}

const MOVEMENT_ICON: Record<string, typeof Truck> = {
  PURCHASE_RECEIPT: PackageCheck,
  TRANSFER_OUT: Truck,
  TRANSFER_IN: Truck,
  SALE: ShoppingCart,
  RETURN: Undo2,
  ADJUSTMENT: Building2,
};

/** The traceability screen: the complete life of one phone (spec §21). */
export default function ImeiDetailPage() {
  const { t, dateTime, money } = useI18n();
  const { imei } = useParams<{ imei: string }>();
  const query = useApiQuery<HistoryResponse>(`/imeis/${imei}/history`);

  if (query.isLoading) return <LoadingState label={t('imei.loading')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { device, movements } = query.data!;
  // What actually identifies this unit: an IMEI if it has one, its printed
  // label if it arrived through the label-first workflow, else nothing.
  const handle = device.imei ?? device.label?.code ?? null;
  const isLabel = !device.imei && Boolean(device.label);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Reached from the scanner, the stock list, a transfer and a sale, so a
          fixed destination is wrong three times out of four. Retrace instead. */}
      <BackButton />

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-snug">{device.product.name}</h1>
              <p className="text-sm text-muted-foreground">
                {device.product.brand} · {device.product.model}
              </p>
              <p className="tabular text-base text-muted-foreground">
                {isLabel ? t('imei.labelCode') : t('imei.imei')} · {formatImei(handle)}
              </p>
            </div>
            <StatusBadge status={device.status} />
          </div>

          <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-sm sm:grid-cols-4">
            <Field label={t('common.warehouse')} value={device.currentWarehouse?.name ?? t('imei.notInWarehouse')} />
            <Field label={t('common.sku')} value={device.product.sku} mono />
            {device.product.barcode && <Field label={t('common.barcode')} value={device.product.barcode} mono />}
            <Field label={t('common.supplier')} value={device.supplier?.name ?? '—'} />
            <Field
              label={t('imei.purchaseCost')}
              value={device.purchaseCost ? money(device.purchaseCost) : '—'}
            />
            {/* What it actually cost to get here — purchase plus handling,
                freight and customs — which is what profit is measured against. */}
            <Field
              label={t('imei.landedCost')}
              value={device.landedCost ? money(device.landedCost) : '—'}
            />
            {device.serialNumber && <Field label={t('imei.serial')} value={device.serialNumber} mono />}
            {device.imei2 && <Field label={t('imei.secondImei')} value={formatImei(device.imei2)} mono />}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('imei.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="relative space-y-0 border-s-2 border-border ps-6">
            {movements.map((movement) => {
              const Icon = MOVEMENT_ICON[movement.type] ?? Building2;
              return (
                <li key={movement.id} className="relative pb-6 last:pb-0">
                  <span className="absolute -start-[2.15rem] flex h-7 w-7 items-center justify-center rounded-full border-2 border-border bg-card">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <p className="font-semibold leading-tight">{t(`movement.type.${movement.type}`)}</p>
                  <p className="text-sm text-muted-foreground">
                    {movement.fromWarehouse?.name && movement.toWarehouse?.name
                      ? `${movement.fromWarehouse.name} → ${movement.toWarehouse.name}`
                      : (movement.toWarehouse?.name ?? movement.fromWarehouse?.name ?? '—')}
                    {movement.referenceNumber && ` · ${movement.referenceNumber}`}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{dateTime(movement.createdAt)}</span>
                    {movement.performedBy && (
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" aria-hidden />
                        {movement.performedBy.name}
                      </span>
                    )}
                  </p>
                  {movement.carrier && (movement.carrier.name || movement.carrier.driver || movement.carrier.freeText) && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Truck className="h-3 w-3" aria-hidden />
                      {t('imei.carriedBy', {
                        carrier:
                          [movement.carrier.name, movement.carrier.driver].filter(Boolean).join(' · ') ||
                          movement.carrier.freeText ||
                          '—',
                      })}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>

          {device.sale && (
            <div className="mt-4 rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-semibold">
                {device.sale.customer
                  ? t('imei.soldTo', { name: device.sale.customer.name })
                  : t('imei.soldCounter')}
              </p>
              <p className="text-muted-foreground">
                {device.sale.number} ·{' '}
                {device.sale.completedAt ? dateTime(device.sale.completedAt) : '—'}
              </p>
            </div>
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
