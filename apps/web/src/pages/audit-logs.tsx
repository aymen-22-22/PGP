import { FileClock } from 'lucide-react';
import { useState } from 'react';
import { Pagination } from '@/components/pagination';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { useApiList } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useI18n } from '@/i18n/provider';
import { titleCase } from '@/lib/utils';

interface AuditRow {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

export default function AuditLogsPage() {
  const { t, dateTime } = useI18n();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(action);

  const query = useApiList<AuditRow>('/audit-logs', { action: debounced || undefined, page, pageSize: 50 });

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.audit')} description={t('audit.lead')} />

      <Input
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setPage(1);
        }}
        placeholder={t('audit.filter')}
        aria-label={t('audit.filter')}
      />

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.data.length === 0 && <EmptyState icon={FileClock} title={t('audit.none')} />}

      {query.data && query.data.data.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('audit.when')}</Th>
                <Th>{t('audit.who')}</Th>
                <Th>{t('audit.action')}</Th>
                <Th>{t('audit.entity')}</Th>
                <Th>{t('audit.details')}</Th>
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((row) => (
                <Tr key={row.id}>
                  <Td className="text-muted-foreground">{dateTime(row.createdAt)}</Td>
                  <Td className="font-medium">{row.user?.name ?? t('audit.system')}</Td>
                  <Td>
                    <Badge variant={row.action.includes('FAILED') ? 'destructive' : 'secondary'}>
                      {titleCase(row.action)}
                    </Badge>
                  </Td>
                  <Td className="text-muted-foreground">{row.entityType ?? '—'}</Td>
                  <Td className="max-w-[24rem] truncate text-xs text-muted-foreground">
                    {row.metadata ? JSON.stringify(row.metadata) : '—'}
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