import { Package, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { BackButton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { Pagination } from '@/components/pagination';
import type { InventoryRow, Listed, StockDevice, StockLevel } from '@phone-erp/shared-types';
import { useApiList, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useI18n } from '@/i18n/provider';
import { useStatusLabel } from '@/lib/status';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatDate, formatImei, formatMoney, formatNumber } from '@/lib/utils';


const STATUSES = ['IN_STOCK', 'RECEIVED', 'IN_TRANSFER', 'SOLD', 'RETURNED', 'DAMAGED', 'LOST'];

export default function StockPage() {
  const { t } = useI18n();
  const statusLabel = useStatusLabel();
  // Read from the URL so a dashboard tile can open this page already narrowed.
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? 'IN_STOCK');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search);

  // A full 15-digit code typed into search is someone hunting one exact phone.
  const looksLikeImei = search.replace(/\D/g, '').length === 15;

  const summary = useApiQuery<Listed<InventoryRow>>('/inventory');
  const devices = useApiList<StockDevice>('/inventory/devices', {
    search: debounced || undefined,
    status: status || undefined,
    page,
    pageSize: 25,
  });

  return (
    <div className="space-y-5">
      <BackButton label={t('stock.allWarehouses')} />
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('stock.findStock')}</h1>
        <p className="text-sm text-muted-foreground">{t('stock.searchLead')}</p>
      </header>

      {summary.isLoading && <LoadingState />}
      {summary.isError && <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />}

      {summary.data && summary.data.data.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('common.product')}</Th>
              <Th>{t('common.warehouse')}</Th>
              <Th />
              <Th className="text-end">{t('stock.available')}</Th>
              <Th className="text-end">{t('stock.inTransfer')}</Th>
              <Th className="text-end">{t('stock.soldLabel')}</Th>
            </tr>
          </thead>
          <tbody>
            {summary.data.data.map((row) => (
              <Tr key={`${row.warehouseId}:${row.productId}`}>
                <Td className="max-w-[16rem] truncate font-medium">{row.productName}</Td>
                <Td className="text-muted-foreground">{row.warehouseName}</Td>
                <Td>
                  {row.tracking === 'BULK' && (
                    <Badge variant="secondary" className="whitespace-nowrap">
                      {t('stock.counted')}
                    </Badge>
                  )}
                </Td>
                <Td className="tabular text-end text-base font-bold text-success">
                  {formatNumber(row.inStock)}
                </Td>
                <Td className="tabular text-end">
                  {row.tracking === 'BULK' ? '—' : formatNumber(row.inTransfer)}
                </Td>
                <Td className="tabular text-end text-muted-foreground">
                  {row.tracking === 'BULK' ? '—' : formatNumber(row.sold)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <AccessoryCount />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('stock.findOne')}</h2>

        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_12rem]">
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={t('stock.searchPlaceholder')}
                inputMode="search"
                className="ps-9"
                aria-label={t('stock.findStock')}
              />
            </div>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('status', e.target.value);
                else next.delete('status');
                setParams(next, { replace: true });
              }}
              aria-label={t('common.status')}
            >
              <option value="">{t('common.anyStatus')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </Select>
          </CardContent>
        </Card>

        {devices.isLoading && <LoadingState />}
        {devices.isError && <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />}

        {devices.data && devices.data.data.length === 0 && (
          <EmptyState
            icon={Package}
            title={t('stock.noPhones')}
            description={
              looksLikeImei
                ? t('stock.noPhones.imei')
                : t('stock.noPhones.body')
            }
            action={
              looksLikeImei ? (
                <Button asChild variant="outline">
                  {/* The whole promise of the system is that any IMEI can be
                      found; a status filter must not be a dead end. */}
                  <Link to={`/imei/${search.replace(/\D/g, '')}`}>{t('stock.lookupImei')}</Link>
                </Button>
              ) : undefined
            }
          />
        )}

        {devices.data && devices.data.data.length > 0 && (
          <>
            <ul className="divide-y rounded-lg border bg-card">
              {devices.data.data.map((device) => (
                <li key={device.id}>
                  <Link
                    to={`/imei/${device.imei}`}
                    className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="tabular font-semibold">{formatImei(device.imei)}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {device.product.name}
                        {device.currentWarehouse && ` · ${device.currentWarehouse.name}`}
                      </p>
                      {device.receivedAt && (
                        <p className="text-xs text-muted-foreground">
                          {t('common.received')} {formatDate(device.receivedAt)}
                        </p>
                      )}
                    </div>
                    <StatusBadge status={device.status} />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination meta={devices.data.meta} onPageChange={setPage} />
          </>
        )}
      </section>
    </div>
  );
}


/**
 * Stock takes for accessories.
 *
 * Phones never need this — a missing phone is a specific IMEI, and marking that
 * one lost records something true. A short count of cables names no unit, so
 * the only honest record is the size of the gap and the reason for it, which is
 * why the reason is required rather than optional.
 */
function AccessoryCount() {
  const { t } = useI18n();
  const toast = useToast();
  const levels = useApiQuery<{ data: StockLevel[] }>('/stock');
  const [editing, setEditing] = useState<string | null>(null);
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');

  const adjust = useApiMutation(
    (body: unknown) => api.post<{ delta: number }>('/stock/adjust', body),
    ['/stock', '/inventory', '/reports'],
  );

  if (!levels.data || levels.data.data.length === 0) return null;

  const close = () => {
    setEditing(null);
    setCounted('');
    setReason('');
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t('stock.accessories')}</h2>
      <ul className="divide-y rounded-lg border bg-card">
        {levels.data.data.map((level) => {
          const key = `${level.warehouseId}:${level.productId}`;
          const open = editing === key;
          return (
            <li key={key} className="px-3 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{level.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {level.warehouseName} · {formatMoney(level.avgUnitCost, level.currency)} {t('stock.avgCost')}
                  </p>
                </div>
                <span className="tabular text-lg font-bold text-success">
                  {formatNumber(level.quantity)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (open) return close();
                    setEditing(key);
                    setCounted(String(level.quantity));
                    setReason('');
                  }}
                >
                  {open ? t('common.cancel') : t('stock.count')}
                </Button>
              </div>

              {open && (
                <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-3">
                  <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                    <Input
                      type="number"
                      min={0}
                      value={counted}
                      onChange={(e) => setCounted(e.target.value)}
                      aria-label={t('stock.countedQuantity')}
                      className="tabular text-center text-lg font-semibold"
                    />
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t('stock.countReasonPlaceholder')}
                      aria-label={t('stock.countReasonPlaceholder')}
                    />
                  </div>
                  {Number(counted) !== level.quantity && reason.trim() !== '' && (
                    <p className="text-sm">
                      {(() => {
                        const delta = `${Number(counted) > level.quantity ? '+' : ''}${
                          Number(counted) - level.quantity
                        }`;
                        return t('stock.recordsDelta', { delta, product: level.productName });
                      })()}
                    </p>
                  )}
                  <Button
                    size="sm"
                    disabled={
                      adjust.isPending || reason.trim() === '' || Number(counted) === level.quantity
                    }
                    onClick={() =>
                      adjust.mutate(
                        {
                          productId: level.productId,
                          warehouseId: level.warehouseId,
                          countedQuantity: Number(counted),
                          reason: reason.trim(),
                        },
                        {
                          onSuccess: (result) => {
                            toast.push('success', t('stock.corrected', { delta: String(result.delta) }));
                            close();
                          },
                          onError: (error) => toast.push('error', error.message),
                        },
                      )
                    }
                  >
                    {adjust.isPending ? t('common.saving') : t('stock.recordCount')}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
