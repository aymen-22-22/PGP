import { Plus, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagination } from '@/components/pagination';
import { PageHeader, SearchField } from '@/components/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { SelectOrCreate } from '@/components/select-or-create';
import type { SaleListItem } from '@phone-erp/shared-types';
import { useApiList, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useI18n } from '@/i18n/provider';
import { useStatusLabel } from '@/lib/status';
import { api } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/utils';
import { NewPartyForm } from './partners';


const STATUSES = ['DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];

export default function SalesPage() {
  const { t, money } = useI18n();
  const statusLabel = useStatusLabel();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(search);

  const query = useApiList<SaleListItem>('/sales', {
    search: debounced || undefined,
    status: status || undefined,
    page,
    pageSize: 25,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.sales')}
        description={t('sales.lead')}
        action={
          <Button className="gap-2" onClick={() => setCreating((c) => !c)}>
            <Plus className="h-5 w-5" />
            {t('sales.new')}
          </Button>
        }
      />

      {creating && <NewSaleForm onDone={() => setCreating(false)} />}

      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <SearchField
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={t('sales.search')}
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
        <EmptyState icon={ShoppingCart} title={t('sales.none')} description={t('sales.noneBody')} />
      )}

      {query.data && query.data.data.length > 0 && (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {query.data.data.map((sale) => (
              <li key={sale.id}>
                <Link
                  to={`/sales/${sale.id}`}
                  className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="tabular font-semibold">{sale.number}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {sale.customer?.name ?? t('common.walkIn')} · {sale.warehouse.name}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">
                      {t('purchase.scannedPhones', { count: sale.quantity })} · {money(sale.totalAmount, sale.currency)} ·{' '}
                      {formatDate(sale.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={sale.status} />
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

function NewSaleForm({ onDone }: { onDone: () => void }) {
  const { t, money } = useI18n();
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const customers = useApiQuery<{ data: { id: string; name: string }[] }>('/customers?pageSize=200');
  const warehouses = useApiQuery<{ id: string; name: string }[]>('/warehouses');
  const products = useApiQuery<{ data: { id: string; name: string; defaultSalePrice: string }[] }>(
    '/products?pageSize=200',
  );

  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState(user?.warehouseId ?? '');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');

  const create = useApiMutation(
    (body: unknown) => api.post<{ id: string; number: string }>('/sales', body),
    ['/sales', '/inventory', '/reports'],
  );

  const ready = customerId && productId && Number(quantity) > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('sales.new')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              {
                customerId,
                ...(isAdmin(user) ? { warehouseId } : {}),
                items: [
                  {
                    productId,
                    quantity: Number(quantity),
                    ...(unitPrice ? { unitPrice: Number(unitPrice).toFixed(2) } : {}),
                  },
                ],
              },
              {
                onSuccess: (result) => {
                  toast.push('success', t('sales.created', { number: result.number }));
                  onDone();
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          <SelectOrCreate
            id="customer"
            label={t('common.customer')}
            value={customerId}
            onChange={setCustomerId}
            options={customers.data?.data ?? []}
            createLabel={t('partners.newCustomer')}
            required
          >
            {(done) => <NewPartyForm kind="customers" onDone={(created) => created && done(created)} />}
          </SelectOrCreate>

          {isAdmin(user) && (
            <div className="space-y-1.5">
              <Label htmlFor="sale-warehouse">{t('sales.sellingWarehouse')}</Label>
              <Select
                id="sale-warehouse"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                required
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

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sale-product">{t('common.product')}</Label>
            <Select
              id="sale-product"
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                const product = products.data?.data.find((p) => p.id === e.target.value);
                if (product && !unitPrice) setUnitPrice(product.defaultSalePrice);
              }}
              required
            >
              <option value="">{t('common.choose')}</option>
              {products.data?.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sale-quantity">{t('common.quantity')}</Label>
            <Input
              id="sale-quantity"
              type="number"
              min={1}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sale-price">{t('ledger.unitPrice')}</Label>
            <Input
              id="sale-price"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder={t('sales.listPrice')}
            />
          </div>

          {quantity && unitPrice && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              {t('purchases.total', { amount: money((Number(quantity) * Number(unitPrice)).toFixed(2)) })}
            </p>
          )}

          <div className="sm:col-span-2">
            <FormError error={create.error} />
          </div>

          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? t('common.creating') : t('sales.create')}
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
