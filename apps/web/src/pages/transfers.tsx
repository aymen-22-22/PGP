import { ArrowRight, Plus, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pagination } from '@/components/pagination';
import { PageHeader, SearchField } from '@/components/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import type { TransferListItem } from '@phone-erp/shared-types';
import { useApiList, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useI18n } from '@/i18n/provider';
import { useStatusLabel } from '@/lib/status';
import { api } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';

interface WarehouseOption {
  id: string;
  name: string;
  code: string;
}
interface ProductOption {
  id: string;
  name: string;
}


const STATUSES = ['DRAFT', 'READY', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'];

export default function TransfersPage() {
  const { t, date } = useI18n();
  const statusLabel = useStatusLabel();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(search);

  const query = useApiList<TransferListItem>('/transfers', {
    search: debounced || undefined,
    status: status || undefined,
    page,
    pageSize: 25,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.transfers')}
        description={t('transfers.lead')}
        action={
          <Button className="gap-2" onClick={() => setCreating((c) => !c)}>
            <Plus className="h-5 w-5" />
            {t('transfers.new')}
          </Button>
        }
      />

      {creating && <NewTransferForm onDone={() => setCreating(false)} />}

      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <SearchField
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={t('transfers.numberPlaceholder')}
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
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
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.data?.data.length === 0 && (
        <EmptyState
          icon={Truck}
          title={t('transfers.none')}
          description={t('transfers.none.body')}
          action={
            <Button variant="outline" className="gap-2" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('transfers.new')}
            </Button>
          }
        />
      )}

      {query.data && query.data.data.length > 0 && (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {query.data.data.map((transfer) => (
              <li key={transfer.id}>
                <Link
                  to={`/transfers/${transfer.id}`}
                  className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="tabular font-semibold">{transfer.number}</p>
                    <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                      {transfer.sourceWarehouse.name}
                      <ArrowRight className="h-3 w-3" aria-hidden />
                      {transfer.destinationWarehouse.name}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">
                      {/* Before dispatch there is nothing to receive, so the plan
                          is the only number that means anything. */}
                      {transfer.status === 'DRAFT' || transfer.status === 'READY'
                        ? t('transfers.loadedOf', {
                            loaded: String(transfer.loadedQuantity),
                            planned: String(transfer.plannedQuantity),
                          })
                        : t('transfers.receivedOf', {
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
          <Pagination meta={query.data.meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}


/**
 * Creating a transfer is the first half of moving stock; the second half — load,
 * ship, receive — happens on the transfer's own screen. A warehouse user can
 * only ever send from their own warehouse, which the API enforces regardless.
 */
function NewTransferForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);

  const warehouses = useApiQuery<WarehouseOption[]>('/warehouses');
  const products = useApiQuery<{ data: ProductOption[] }>('/products?pageSize=200');

  const [sourceWarehouseId, setSource] = useState(user?.warehouseId ?? '');
  const [destinationWarehouseId, setDestination] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [autoFill, setAutoFill] = useState(true);

  const create = useApiMutation(
    (body: unknown) => api.post<{ id: string; number: string; loadedQuantity: number }>('/transfers', body),
    ['/transfers', '/inventory', '/reports'],
  );

  const sameWarehouse = Boolean(
    sourceWarehouseId && destinationWarehouseId && sourceWarehouseId === destinationWarehouseId,
  );
  const ready =
    sourceWarehouseId && destinationWarehouseId && !sameWarehouse && productId && Number(quantity) > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('transfers.new')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              {
                sourceWarehouseId,
                destinationWarehouseId,
                items: [{ productId, quantity: Number(quantity) }],
                autoFill,
              },
              {
                onSuccess: (result) => {
                  if (autoFill) {
                    toast.push(
                      'success',
                      t('transfers.createdAuto', {
                        number: result.number,
                        count: result.loadedQuantity,
                      }),
                    );
                  } else {
                    toast.push('success', t('transfers.createdManual', { number: result.number }));
                  }
                  onDone();
                  navigate(`/transfers/${result.id}`);
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tr-source">{t('transfers.from')}</Label>
            <Select
              id="tr-source"
              value={sourceWarehouseId}
              onChange={(e) => setSource(e.target.value)}
              disabled={!isAdmin(user)}
              required
            >
              <option value="">{t('common.choose')}</option>
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </Select>
            {!isAdmin(user) && (
              <p className="text-xs text-muted-foreground">{t('transfers.ownWarehouseHint')}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tr-destination">{t('transfers.to')}</Label>
            <Select
              id="tr-destination"
              value={destinationWarehouseId}
              onChange={(e) => setDestination(e.target.value)}
              required
            >
              <option value="">{t('common.choose')}</option>
              {warehouses.data
                ?.filter((w) => w.id !== sourceWarehouseId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tr-product">{t('common.product')}</Label>
            <Select id="tr-product" value={productId} onChange={(e) => setProductId(e.target.value)} required>
              <option value="">{t('common.choose')}</option>
              {products.data?.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tr-quantity">{t('transfers.howMany')}</Label>
            <Input
              id="tr-quantity"
              type="number"
              min={1}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">{t('transfers.partialHint')}</p>
          </div>

          <div className="flex items-end">
            <label className="flex touch-target w-full items-center gap-3 rounded-md border p-3">
              <input
                type="checkbox"
                checked={autoFill}
                onChange={(e) => setAutoFill(e.target.checked)}
                className="h-5 w-5 accent-[hsl(var(--primary))]"
              />
              <span className="text-sm">
                {t('transfers.autoFill')}
                <span className="block text-xs text-muted-foreground">
                  {t('transfers.autoFillHint')}
                </span>
              </span>
            </label>
          </div>

          {sameWarehouse && (
            <p className="text-sm text-destructive sm:col-span-2">
              {t('transfers.sameWarehouse')}
            </p>
          )}

          <div className="sm:col-span-2">
            <FormError error={create.error} />
          </div>

          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? t('transfers.creating') : t('transfers.create')}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
