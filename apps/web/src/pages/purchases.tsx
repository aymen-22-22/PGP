import { Plus, ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Pagination } from '@/components/pagination';
import { PageHeader, SearchField } from '@/components/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { SelectOrCreate } from '@/components/select-or-create';
import type { PurchaseListItem } from '@phone-erp/shared-types';
import { useApiList, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useI18n } from '@/i18n/provider';
import { useStatusLabel } from '@/lib/status';
import { api } from '@/lib/api';
import { hasDraft, saveDraft, takeDraft } from '@/lib/form-draft';
import { isAdmin, useAuth } from '@/lib/auth';
import { formatDate, formatNumber } from '@/lib/utils';
import { NewPartyForm } from './partners';

const STATUSES = ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];

/** Name under which a half-filled order survives a trip to the catalogue. */
const DRAFT = 'new-purchase';

interface PurchaseDraft {
  supplierId: string;
  warehouseId: string;
  quantity: string;
  unitPrice: string;
}

export default function PurchasesPage() {
  const user = useAuth((s) => s.user);
  const { t, money } = useI18n();
  const statusLabel = useStatusLabel();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  // Reopen the form automatically when returning from the catalogue, so the
  // user lands back exactly where they left off rather than on the list.
  const [searchParams] = useSearchParams();
  const [creating, setCreating] = useState(
    () => searchParams.has('created') || hasDraft(DRAFT),
  );
  const debounced = useDebounce(search);

  const query = useApiList<PurchaseListItem>('/purchases', {
    search: debounced || undefined,
    status: status || undefined,
    page,
    pageSize: 25,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.purchases')}
        description={t('purchases.lead')}
        action={
          isAdmin(user) && (
            <Button className="gap-2" onClick={() => setCreating((c) => !c)}>
              <Plus className="h-5 w-5" />
              {t('purchases.new')}
            </Button>
          )
        }
      />

      {creating && <NewPurchaseForm onDone={() => setCreating(false)} />}

      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <SearchField
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={t('purchases.search')}
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
        <EmptyState icon={ShoppingCart} title={t('purchases.none')} description={t('purchases.noneBody')} />
      )}

      {query.data && query.data.data.length > 0 && (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {query.data.data.map((purchase) => (
              <li key={purchase.id}>
                <Link
                  to={`/purchases/${purchase.id}`}
                  className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="tabular font-semibold">{purchase.number}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {purchase.supplier.name} → {purchase.warehouse.name}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">
                      {formatNumber(purchase.receivedQuantity)}/{formatNumber(purchase.expectedQuantity)} {t('purchases.received')}
                      {/* Omitted entirely for a warehouse account — pricing is admin-only. */}
                      {purchase.totalAmount !== undefined && (
                        <> · {money(purchase.totalAmount, purchase.currency)}</>
                      )}{' '}
                      · {formatDate(purchase.purchaseDate)}
                    </p>
                  </div>
                  <StatusBadge status={purchase.status} />
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

function NewPurchaseForm({ onDone }: { onDone: () => void }) {
  const { t, money } = useI18n();
  const toast = useToast();
  const suppliers = useApiQuery<{ data: { id: string; name: string }[] }>('/suppliers?pageSize=200');
  const warehouses = useApiQuery<{ id: string; name: string }[]>('/warehouses');
  const products = useApiQuery<{ data: { id: string; name: string; purchasePrice: string }[] }>(
    '/products?pageSize=200',
  );

  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // Coming back from the catalogue: pick the draft up where it was left.
  const [restored] = useState(() => takeDraft<PurchaseDraft>(DRAFT));
  const [supplierId, setSupplierId] = useState(restored?.supplierId ?? '');
  const [warehouseId, setWarehouseId] = useState(restored?.warehouseId ?? '');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(restored?.quantity ?? '');
  const [unitPrice, setUnitPrice] = useState(restored?.unitPrice ?? '');

  // The catalogue hands back the id it just created. Select it once the list
  // has caught up, then drop the parameter so a refresh does not repeat it.
  const createdId = params.get('created');
  useEffect(() => {
    if (!createdId) return;
    const product = products.data?.data.find((p) => p.id === createdId);
    if (!product) return;
    setProductId(product.id);
    setUnitPrice((current) => current || product.purchasePrice);
    setParams({}, { replace: true });
  }, [createdId, products.data, setParams]);

  const create = useApiMutation(
    (body: unknown) => api.post<{ id: string; number: string }>('/purchases', body),
    ['/purchases', '/reports'],
  );

  const ready = supplierId && warehouseId && productId && Number(quantity) > 0 && Number(unitPrice) >= 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('purchases.new')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              {
                supplierId,
                warehouseId,
                items: [{ productId, quantity: Number(quantity), unitPrice: Number(unitPrice).toFixed(2) }],
              },
              {
                onSuccess: (result) => {
                  toast.push('success', t('purchases.created', { number: result.number }));
                  onDone();
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          <SelectOrCreate
            id="supplier"
            label={t('common.supplier')}
            value={supplierId}
            onChange={setSupplierId}
            options={suppliers.data?.data ?? []}
            createLabel={t('partners.newSupplier')}
            required
          >
            {(done) => <NewPartyForm kind="suppliers" onDone={(created) => created && done(created)} />}
          </SelectOrCreate>

          <div className="space-y-1.5">
            <Label htmlFor="warehouse">{t('purchases.receivingWarehouse')}</Label>
            <Select id="warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
              <option value="">{t('common.choose')}</option>
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="product">{t('common.product')}</Label>
            <div className="flex gap-2">
              <Select
                id="product"
                className="flex-1"
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  const product = products.data?.data.find((p) => p.id === e.target.value);
                  if (product) setUnitPrice(product.purchasePrice);
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

              {/* Not in the list yet. Keep what has been typed so far, go and
                  create it, and come back to this form with it selected. */}
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                aria-label={t('purchases.newProduct')}
                title={t('purchases.newProduct')}
                onClick={() => {
                  saveDraft(DRAFT, { supplierId, warehouseId, quantity, unitPrice });
                  navigate('/products?new=1&return=/purchases');
                }}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('purchases.newProductHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quantity">{t('common.quantity')}</Label>
            <Input
              id="quantity"
              type="number"
              min={1}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="price">{t('ledger.unitPrice')}</Label>
            <Input
              id="price"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              required
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
              {create.isPending ? t('common.creating') : t('purchases.create')}
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
