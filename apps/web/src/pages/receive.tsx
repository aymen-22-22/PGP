import { ArrowRight, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/page';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import type { PurchaseListItem, TransferListItem } from '@phone-erp/shared-types';
import { useApiList } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { formatDate, formatNumber } from '@/lib/utils';

const OUTSTANDING_PURCHASE_STATUSES = new Set(['ORDERED', 'PARTIALLY_RECEIVED']);

/**
 * Everything a warehouse account has coming in: purchase orders still to be
 * received, and transfers already shipped from another warehouse. Both link
 * back into the existing receiving screens — this page is only a worklist.
 */
export default function ReceivePage() {
  const { t, date } = useI18n();

  const purchases = useApiList<PurchaseListItem>('/purchases', {
    status: 'ORDERED',
    pageSize: 50,
  });
  const partial = useApiList<PurchaseListItem>('/purchases', {
    status: 'PARTIALLY_RECEIVED',
    pageSize: 50,
  });
  const transfers = useApiList<TransferListItem>('/transfers', {
    incoming: true,
    status: 'IN_TRANSIT',
    pageSize: 50,
  });

  const purchaseItems = [...(purchases.data?.data ?? []), ...(partial.data?.data ?? [])].filter((p) =>
    OUTSTANDING_PURCHASE_STATUSES.has(p.status),
  );
  const transferItems = (transfers.data?.data ?? []).filter((tr) => tr.status === 'IN_TRANSIT');

  const isLoading = purchases.isLoading || partial.isLoading || transfers.isLoading;
  const isError = purchases.isError || partial.isError || transfers.isError;
  const isEmpty = !isLoading && !isError && purchaseItems.length === 0 && transferItems.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.receive')} description={t('receive.lead')} />

      {isLoading && <LoadingState />}
      {isError && (
        <ErrorState
          error={purchases.error ?? partial.error ?? transfers.error}
          onRetry={() => {
            void purchases.refetch();
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
              <li key={purchase.id}>
                <Link
                  to={`/purchases/${purchase.id}`}
                  className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="tabular font-semibold">{purchase.number}</p>
                    <p className="truncate text-sm text-muted-foreground">{purchase.supplier.name}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {formatNumber(purchase.receivedQuantity)}/{formatNumber(purchase.expectedQuantity)}{' '}
                      {t('purchases.received')} · {formatDate(purchase.purchaseDate)}
                    </p>
                  </div>
                  <StatusBadge status={purchase.status} />
                </Link>
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
              <li key={transfer.id}>
                <Link
                  to={`/transfers/${transfer.id}`}
                  className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/40"
                >
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
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
