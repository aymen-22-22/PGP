import { ClipboardCheck } from 'lucide-react';
import { useState } from 'react';
import { Pagination } from '@/components/pagination';
import { PageHeader } from '@/components/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import type { ReceiptListItem } from '@phone-erp/shared-types';
import { useApiList, useApiMutation } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import { formatNumber } from '@/lib/utils';

export default function ReceiptsPage() {
  const user = useAuth((s) => s.user);
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const query = useApiList<ReceiptListItem>('/receipts', { status: status || undefined, page, pageSize: 25 });
  const validate = useApiMutation(
    (id: string) => api.post<{ devicesReleased: number }>(`/receipts/${id}/validate`),
    ['/receipts', '/inventory', '/reports'],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.receipts')}
        description={t('receipts.lead')}
      />

      <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={t('common.status')}>
        <option value="">{t('common.anyStatus')}</option>
        <option value="PENDING_VALIDATION">{t('status.pendingValidation')}</option>
        <option value="VALIDATED">{t('status.validated')}</option>
      </Select>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.data.length === 0 && (
        <EmptyState icon={ClipboardCheck} title={t('receipts.none')} description={t('receipts.noneBody')} />
      )}

      {query.data && query.data.data.length > 0 && (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {query.data.data.map((receipt) => (
              <li key={receipt.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="tabular font-semibold">{receipt.number}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {receipt.warehouse.name} · {receipt.purchase?.number ?? receipt.transfer?.number ?? receipt.source}
                  </p>
                  <p className="tabular text-xs text-muted-foreground">
                    {formatNumber(receipt.scannedCount)} {t('receipts.of')} {formatNumber(receipt.expectedCount)} ·{' '}
                    {receipt.createdBy?.name ?? '—'} · {dateTime(receipt.createdAt)}
                  </p>
                </div>

                <StatusBadge status={receipt.status} />

                {receipt.status === 'PENDING_VALIDATION' && isAdmin(user) && (
                  <Button
                    size="sm"
                    disabled={validate.isPending}
                    onClick={() =>
                      validate.mutate(receipt.id, {
                        onSuccess: (result) =>
                          toast.push('success', t('receipts.released', { count: result.devicesReleased })),
                        onError: (error) => toast.push('error', error.message),
                      })
                    }
                  >
                    {t('receipts.validate')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Pagination meta={query.data.meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
