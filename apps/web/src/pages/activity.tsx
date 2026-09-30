import { Activity as ActivityIcon, ImageIcon, PackageCheck, ShoppingBag, Truck, Undo2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { isAdmin, useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface Step {
  type: string;
  at: string;
  count: number;
  from: string | null;
  to: string | null;
  by: string | null;
  product: { id: string; name: string; imageUrl: string | null };
}

const LOOK: Record<string, { icon: typeof Truck; colour: string }> = {
  PURCHASE_RECEIPT: { icon: PackageCheck, colour: 'bg-blue-600' },
  TRANSFER_IN: { icon: PackageCheck, colour: 'bg-blue-600' },
  TRANSFER_OUT: { icon: Truck, colour: 'bg-orange-500' },
  SALE: { icon: ShoppingBag, colour: 'bg-emerald-600' },
  RETURN: { icon: Undo2, colour: 'bg-amber-500' },
};

const WAREHOUSE_KEY = 'perp_scanner_wh';

/** What happened in this warehouse lately: arrivals, departures, sales — one line per step. */
export default function ActivityPage() {
  const { t, dateTime } = useI18n();
  const user = useAuth((s) => s.user);
  const admin = isAdmin(user);
  const [warehouseId, setWarehouseId] = useState(() => {
    try {
      return localStorage.getItem(WAREHOUSE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const warehouses = useApiQuery<{ id: string; name: string }[]>('/warehouses', { enabled: admin });
  const ready = !admin || !!warehouseId;
  const query = useApiQuery<{ data: Step[] }>(`/ops/activity${admin && warehouseId ? `?warehouseId=${warehouseId}` : ''}`, {
    enabled: ready,
    refetchInterval: 60_000,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <ActivityIcon className="h-6 w-6 text-primary" />
        {t('nav.activity')}
      </h1>

      {admin && (
        <div className="space-y-1.5">
          <Label htmlFor="act-wh">{t('common.warehouse')}</Label>
          <Select
            id="act-wh"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              try {
                localStorage.setItem(WAREHOUSE_KEY, e.target.value);
              } catch {
                /* this visit only */
              }
            }}
          >
            <option value="">{t('common.choose')}</option>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && query.data.data.length === 0 && <EmptyState icon={ActivityIcon} title={t('activity.none')} />}

      {query.data && query.data.data.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card">
          {query.data.data.map((step, i) => {
            const look = LOOK[step.type] ?? { icon: Wrench, colour: 'bg-slate-500' };
            const Icon = look.icon;
            return (
              <li key={`${step.type}-${step.at}-${i}`} className="flex items-center gap-3 px-3 py-3">
                <span className="relative shrink-0">
                  <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                    {step.product.imageUrl ? (
                      <img src={step.product.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    )}
                  </span>
                  <span
                    className={cn(
                      'absolute -bottom-1 -end-1 flex h-6 w-6 items-center justify-center rounded-full text-white ring-2 ring-card',
                      look.colour,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">
                    {t(`journey.move.${step.type}`, { to: step.to ?? step.from ?? '' })}
                  </p>
                  <p className="truncate text-sm">
                    {step.product.name} <span className="font-semibold">×{step.count}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dateTime(step.at)}
                    {step.by && ` · ${step.by}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
