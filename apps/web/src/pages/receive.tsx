import { ArrowLeft, ArrowRight, Inbox, PackageCheck, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { CodeList } from '@/features/scanner/code-list';
import { CodeScanInput } from '@/features/scanner/code-scan-input';
import { useCodeBuffer } from '@/features/scanner/use-code-buffer';
import type { PurchaseListItem, TransferListItem } from '@phone-erp/shared-types';
import { useApiList, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/utils';

/** What the page is working on: a purchase order, or a shipment from elsewhere. */
type Target =
  | { kind: 'purchase'; id: string; number: string }
  | { kind: 'transfer'; id: string; number: string };

/**
 * Everything the warehouse has coming in, and the scanner that books it in.
 *
 * Both sources end the same way — a code goes from "expected" to "in stock" —
 * but they get there through different endpoints, so each has its own panel.
 */
export default function ReceivePage() {
  const { t, date } = useI18n();
  const [target, setTarget] = useState<Target | null>(null);

  const ordered = useApiList<PurchaseListItem>('/purchases', { status: 'ORDERED', pageSize: 50 });
  const partial = useApiList<PurchaseListItem>('/purchases', {
    status: 'PARTIALLY_RECEIVED',
    pageSize: 50,
  });
  const transfers = useApiList<TransferListItem>('/transfers', {
    incoming: true,
    status: 'IN_TRANSIT',
    pageSize: 50,
  });

  if (target?.kind === 'purchase') {
    return <ReceivePurchase target={target} onDone={() => setTarget(null)} />;
  }
  if (target?.kind === 'transfer') {
    return <ReceiveTransfer target={target} onDone={() => setTarget(null)} />;
  }

  const purchaseItems = [...(ordered.data?.data ?? []), ...(partial.data?.data ?? [])];
  const transferItems = transfers.data?.data ?? [];

  const isLoading = ordered.isLoading || partial.isLoading || transfers.isLoading;
  const isError = ordered.isError || partial.isError || transfers.isError;
  const isEmpty = !isLoading && !isError && purchaseItems.length === 0 && transferItems.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.receive')} description={t('receive.lead')} />

      {isLoading && <LoadingState />}
      {isError && (
        <ErrorState
          error={ordered.error ?? partial.error ?? transfers.error}
          onRetry={() => {
            void ordered.refetch();
            void partial.refetch();
            void transfers.refetch();
          }}
        />
      )}
      {isEmpty && (
        <EmptyState icon={Inbox} title={t('receive.none')} description={t('receive.noneBody')} />
      )}

      {purchaseItems.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('receive.purchaseOrders')}</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {purchaseItems.map((purchase) => (
              <li key={purchase.id} className="space-y-2 px-3 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="tabular font-semibold">{purchase.number}</p>
                    <p className="truncate text-sm text-muted-foreground">{purchase.supplier.name}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {formatNumber(purchase.receivedQuantity)}/{formatNumber(purchase.expectedQuantity)}{' '}
                      {t('purchases.received')} · {formatDate(purchase.purchaseDate)}
                    </p>
                  </div>
                  <StatusBadge status={purchase.status} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={() =>
                      setTarget({ kind: 'purchase', id: purchase.id, number: purchase.number })
                    }
                  >
                    <PackageCheck className="h-4 w-4" />
                    {t('receive.scanIn')}
                  </Button>
                  {/* The labels were reserved when the order was placed; this is
                      where they get printed and stuck on the boxes. */}
                  <Button asChild size="sm" variant="outline" className="gap-2">
                    <Link to={`/purchases/${purchase.id}/labels`}>
                      <Tags className="h-4 w-4" />
                      {t('receive.printCodes')}
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {transferItems.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('receive.incomingTransfers')}</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {transferItems.map((transfer) => (
              <li key={transfer.id} className="space-y-2 px-3 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="tabular font-semibold">{transfer.number}</p>
                    <p className="flex flex-wrap items-center gap-1 truncate text-sm text-muted-foreground">
                      {transfer.sourceWarehouse.name}
                      <ArrowRight className="h-3 w-3" aria-hidden />
                      {transfer.destinationWarehouse.name}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">
                      {t('transfers.receivedOf', {
                        received: String(transfer.receivedQuantity),
                        loaded: String(transfer.loadedQuantity),
                      })}{' '}
                      · {date(transfer.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={transfer.status} />
                </div>
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => setTarget({ kind: 'transfer', id: transfer.id, number: transfer.number })}
                >
                  <PackageCheck className="h-4 w-4" />
                  {t('receive.scanIn')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface PurchaseSummary {
  number: string;
  items: { quantity: number; receivedQuantity: number }[];
}

interface LabelScanResult {
  code: string;
  product: { name: string };
  remaining: number;
}

/**
 * Goods-in against a purchase order: one label at a time, booked in the
 * moment it is scanned, because a half-finished pallet should not be lost
 * if the phone goes flat.
 */
function ReceivePurchase({ target, onDone }: { target: Target; onDone: () => void }) {
  const { t } = useI18n();
  const query = useApiQuery<PurchaseSummary>(`/purchases/${target.id}`);
  const [done, setDone] = useState<{ code: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const scan = useApiMutation<LabelScanResult, { code: string }>(
    (body) => api.post(`/purchases/${target.id}/receive-by-label`, body),
    ['/purchases', '/inventory', '/reports'],
  );

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const purchase = query.data!;
  const expected = purchase.items.reduce((sum, i) => sum + i.quantity, 0);
  const received = purchase.items.reduce((sum, i) => sum + i.receivedQuantity, 0) + done.length;
  const remaining = Math.max(0, expected - received);

  return (
    <div className="space-y-4">
      <BackBar number={target.number} onBack={onDone} />
      <Counts expected={expected} received={received} remaining={remaining} />

      <CodeScanInput
        outcome={null}
        disabled={remaining === 0 || scan.isPending}
        onScan={(code) =>
          scan.mutate(
            { code },
            {
              onSuccess: (result) => {
                setError(null);
                setDone((current) => [{ code: result.code, name: result.product.name }, ...current]);
              },
              onError: (e) => setError(e.message),
            },
          )
        }
      />

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      {remaining === 0 && <p className="text-sm font-medium text-success">{t('receive.allIn')}</p>}

      {done.length > 0 && (
        <ul className="divide-y rounded-lg border bg-card">
          {done.map((entry) => (
            <li key={entry.code} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <PackageCheck className="h-4 w-4 shrink-0 text-success" />
              <span className="flex-1 truncate">{entry.name}</span>
              <span className="tabular text-xs text-muted-foreground">{entry.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TransferSummary {
  number: string;
  devices: { imei: string; receivedAt: string | null }[];
}

/**
 * Goods-in against a shipment from another warehouse: the whole load is
 * scanned, then booked in one call, which is what closes the transfer.
 */
function ReceiveTransfer({ target, onDone }: { target: Target; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const query = useApiQuery<TransferSummary>(`/transfers/${target.id}`);

  const outstanding = useMemo(
    () => new Set((query.data?.devices ?? []).filter((d) => !d.receivedAt).map((d) => d.imei)),
    [query.data],
  );
  const buffer = useCodeBuffer({
    expected: outstanding.size,
    expectedCodes: outstanding,
    strayReason: t('receive.notOnShipment'),
    storageKey: `transfer-receive:${target.id}`,
  });

  const receive = useApiMutation(
    () => api.post(`/transfers/${target.id}/receive`, { imeis: buffer.codes }),
    ['/transfers', '/inventory', '/reports'],
  );

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <div className="space-y-4">
      <BackBar number={target.number} onBack={onDone} />
      <Counts
        expected={outstanding.size}
        received={buffer.count}
        remaining={Math.max(0, outstanding.size - buffer.count)}
      />

      <CodeScanInput outcome={buffer.lastOutcome} onScan={(code) => buffer.add(code)} />

      <CodeList entries={buffer.entries} onRemove={buffer.remove} onUndo={buffer.undo} restored={buffer.restored} />

      <FormError error={receive.error} />

      <Button
        className="w-full"
        size="lg"
        disabled={buffer.count === 0 || receive.isPending}
        onClick={() =>
          receive.mutate(undefined, {
            onSuccess: () => {
              toast.push('success', t('receive.booked', { count: buffer.count }));
              buffer.reset();
              onDone();
            },
            onError: (e) => toast.push('error', e.message),
          })
        }
      >
        {receive.isPending ? t('common.saving') : t('receive.bookIn', { count: buffer.count })}
      </Button>
    </div>
  );
}

function BackBar({ number, onBack }: { number: string; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" className="-ms-2 gap-1" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        {t('receive.back')}
      </Button>
      <span className="tabular font-semibold">{number}</span>
    </div>
  );
}

function Counts({
  expected,
  received,
  remaining,
}: {
  expected: number;
  received: number;
  remaining: number;
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <Stat label={t('receiveScan.expected')} value={expected} />
      <Stat label={t('receiveScan.received')} value={received} className="text-success" />
      <Stat label={t('receiveScan.remaining')} value={remaining} />
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className={`tabular text-2xl font-bold ${className ?? ''}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
