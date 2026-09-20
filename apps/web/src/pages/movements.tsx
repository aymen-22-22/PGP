import { ArrowDownToLine, ArrowRight, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/page';
import { StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import type { TransferListItem } from '@phone-erp/shared-types';
import { useApiList } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';

type Direction = 'receiving' | 'sending';

/**
 * Every phone on the road between two warehouses, in one place. Use the tabs
 * to look at it from either end: arriving at this warehouse (receiving) or
 * leaving it (sending). There is no Orchestration here — just the two ends of
 * the same line, which is exactly the level of detail a warehouse manager
 * wants at a glance.
 */
export default function MovementsPage() {
  const { t, date } = useI18n();
  const [searchParams] = useSearchParams();
  const [direction, setDirection] = useState<Direction>(
    searchParams.get('direction') === 'sending' ? 'sending' : 'receiving',
  );

  const receiving = useApiList<TransferListItem>('/transfers', { incoming: true, pageSize: 20 });
  const sending = useApiList<TransferListItem>('/transfers', { outgoing: true, pageSize: 20 });
  const active = direction === 'receiving' ? receiving : sending;

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.movements')} description={t('movements.lead')} />

      <div role="tablist" aria-label={t('nav.movements')} className="grid grid-cols-2 gap-1 rounded-lg border bg-muted p-1">
        {(
          [
            ['receiving', t('movements.receiving')],
            ['sending', t('movements.sending')],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={direction === value}
            onClick={() => setDirection(value)}
            className={
              direction === value
                ? 'rounded-md bg-background px-3 py-2 text-sm font-medium shadow-sm'
                : 'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {active.isLoading && <LoadingState />}
      {active.isError && (
        <ErrorState error={active.error} onRetry={() => void active.refetch()} />
      )}
      {active.data && active.data.data.length === 0 && (
        <EmptyState
          icon={Truck}
          title={
            direction === 'receiving'
              ? t('movements.none.receiving')
              : t('movements.none.sending')
          }
          description={
            direction === 'receiving'
              ? t('movements.none.body.receiving')
              : t('movements.none.body.sending')
          }
        />
      )}
      {active.data && active.data.data.length > 0 && (
        <Card>
          <ul className="divide-y rounded-lg border bg-card">
            {active.data.data.map((t2) => (
              <li key={t2.id}>
                <Link
                  to={`/transfers/${t2.id}`}
                  className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="tabular font-semibold">{t2.number}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {t2.sourceWarehouse.name}
                      <ArrowRight className="mx-1 inline-block h-3 w-3" aria-hidden />
                      {t2.destinationWarehouse.name}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">
                      {date(t2.createdAt)} ·{' '}
                      {direction === 'receiving'
                        ? t('movements.arriving')
                        : t('movements.loadedOf', {
                            loaded: String(t2.loadedQuantity),
                            planned: String(t2.plannedQuantity),
                          })}
                    </p>
                  </div>
                  <ArrowDownToLine
                    className={
                      direction === 'receiving'
                        ? 'h-4 w-4 text-muted-foreground'
                        : 'hidden'
                    }
                    aria-hidden
                  />
                  <StatusBadge status={t2.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}