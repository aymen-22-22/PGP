import { MailWarning, RefreshCw, Send } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api, buildQuery } from '@/lib/api';
import { titleCase } from '@/lib/utils';

interface NotificationRow {
  id: string;
  event: string;
  subject: string;
  recipients: string[];
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface Response {
  data: NotificationRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { pending: number; failed: number };
}

const TONE: Record<NotificationRow['status'], string> = {
  SENT: 'text-success',
  PENDING: 'text-warning',
  FAILED: 'text-destructive',
};

/**
 * What the system has emailed, and what it could not.
 *
 * Mail is invisible by default — a message that never arrived looks exactly
 * like one that was never sent. This is where that difference can be seen.
 */
export default function NotificationsPage() {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const query = useApiQuery<Response>(`/notifications${buildQuery({ page, pageSize: 25 })}`);

  const retryNow = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ sent: number; failed: number }>('/notifications/flush');
      toast.push(
        result.failed > 0 ? 'error' : 'success',
        result.sent === 0 && result.failed === 0
          ? t('notifications.flush.none')
          : t('notifications.flush.some', {
              sent: String(result.sent),
              failed: String(result.failed),
            }),
      );
      await query.refetch();
    } catch (error) {
      toast.push('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.notifications')}
        description={t('notifications.lead')}
        action={
          <Button variant="outline" className="gap-2" disabled={busy} onClick={() => void retryNow()}>
            <RefreshCw className="h-4 w-4" />
            {busy ? t('notifications.flushing') : t('notifications.flush')}
          </Button>
        }
      />

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.data && (query.data.summary.pending > 0 || query.data.summary.failed > 0) && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex items-center gap-3 p-4">
            <MailWarning className="h-5 w-5 shrink-0 text-warning" aria-hidden />
            <p className="text-sm">
              {query.data.summary.pending > 0 && (
                <>
                  <strong>{t('notifications.summary.pending', { count: query.data.summary.pending })}</strong>{' '}
                </>
              )}
              {query.data.summary.failed > 0 && (
                <>
                  <strong>{t('notifications.summary.failed', { count: query.data.summary.failed })}</strong>{' '}
                </>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {query.data?.data.length === 0 && (
        <EmptyState icon={Send} title={t('notifications.none')} description={t('notifications.none.body')} />
      )}

      {query.data && query.data.data.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('audit.when')}</Th>
                <Th>{t('notifications.event')}</Th>
                <Th>{t('notifications.subject')}</Th>
                <Th>{t('notifications.to')}</Th>
                <Th>{t('common.status')}</Th>
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((row) => (
                <Tr key={row.id}>
                  <Td className="whitespace-nowrap text-muted-foreground">
                    {dateTime(row.sentAt ?? row.createdAt)}
                  </Td>
                  <Td>
                    <Badge variant="secondary">{titleCase(row.event)}</Badge>
                  </Td>
                  <Td className="max-w-[22rem] truncate">{row.subject}</Td>
                  <Td className="text-muted-foreground">
                    {row.recipients.length === 1
                      ? row.recipients[0]
                      : t('common.people', { count: row.recipients.length })}
                  </Td>
                  <Td>
                    <span className={`text-sm font-semibold ${TONE[row.status]}`}>
                      {t(`notifications.status.${row.status}`)}
                    </span>
                    {row.attempts > 1 && (
                      <span className="tabular ms-1 text-xs text-muted-foreground">
                        ×{row.attempts}
                      </span>
                    )}
                    {row.lastError && (
                      <p className="tabular max-w-[20rem] truncate text-xs text-destructive">
                        {row.lastError}
                      </p>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination meta={query.data.meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}