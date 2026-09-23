import { Coins, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagination } from '@/components/pagination';
import { PageHeader, SearchField } from '@/components/page';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useApiList, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';

interface CostDocument {
  id: string;
  number: string;
  type: string;
  description: string | null;
  amount: string;
  currency: string;
  exchangeRate: string;
  amountBase: string;
  allocation: string;
  scope: string;
  status: string;
  incurredAt: string;
  restatedSales: number;
  unitCount: number;
  lot: { id: string; number: string } | null;
  postedBy: { name: string } | null;
}

interface Lot {
  id: string;
  number: string;
  quantity: number;
  unitPurchaseCost: string;
  currency: string;
  receivedAt: string;
  deviceCount: number;
  product: { name: string; sku: string };
  warehouse: { name: string };
  purchase: { number: string } | null;
}

const TYPES = ['HANDLING', 'FREIGHT', 'CUSTOMS', 'INSURANCE', 'OTHER'];

export default function CostsPage() {
  const { t, money, date } = useI18n();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const debounced = useDebounce(search);

  const docs = useApiList<CostDocument>('/cost-documents', {
    search: debounced || undefined,
    type: type || undefined,
    page,
    pageSize: 25,
  });
  const lots = useApiList<Lot>('/lots', { pageSize: 25 });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('costs.title')}
        description={t('costs.lead')}
        action={
          <Button className="gap-2" onClick={() => setAdding((a) => !a)}>
            <Plus className="h-5 w-5" />
            {t('costs.record')}
          </Button>
        }
      />

      {adding && <NewCostForm lots={lots.data?.data ?? []} onDone={() => setAdding(false)} />}

      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <SearchField
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={t('costs.search')}
        />
        <Select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          aria-label={t('costs.type')}
        >
          <option value="">{t('costs.anyType')}</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </div>

      {docs.isLoading && <LoadingState />}
      {docs.isError && <ErrorState error={docs.error} onRetry={() => void docs.refetch()} />}
      {docs.data?.data.length === 0 && (
        <EmptyState icon={Coins} title={t('costs.none')} description={t('costs.noneLead')} />
      )}

      {docs.data && docs.data.data.length > 0 && (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {docs.data.data.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="tabular font-semibold">
                    {doc.number} · {t(`cost.type.${doc.type}`)}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {doc.description ?? '—'}
                    {doc.lot && ` · ${doc.lot.number}`}
                  </p>
                  <p className="tabular text-xs text-muted-foreground">
                    {money(doc.amount, doc.currency)}
                    {doc.currency !== 'EUR' && ` → ${money(doc.amountBase, 'EUR')}`}
                    {' · '}
                    {t('costs.unitLabel', { count: doc.unitCount })} · {t(`cost.allocation.${doc.allocation.toLowerCase()}`) ?? doc.allocation.toLowerCase()} ·{' '}
                    {date(doc.incurredAt)}
                  </p>
                  {doc.restatedSales > 0 && (
                    <p className="mt-1 text-xs font-medium text-warning">
                      {t('costs.restated', { count: doc.restatedSales })}
                    </p>
                  )}
                </div>
                <StatusBadge status={doc.status} />
              </li>
            ))}
          </ul>
          <Pagination meta={docs.data.meta} onPageChange={setPage} />
        </>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('costs.lots')}</h2>
        <p className="text-sm text-muted-foreground">{t('costs.lotsLead')}</p>
        {lots.data && lots.data.data.length > 0 ? (
          <ul className="divide-y rounded-lg border bg-card">
            {lots.data.data.map((lot) => (
              <li key={lot.id}>
                <Link
                  to={`/landed-cost/lot/${lot.id}?back=/costs`}
                  className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="tabular font-semibold">{lot.number}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {lot.product.name} · {lot.warehouse.name}
                    </p>
                    <p className="tabular text-xs text-muted-foreground">
                      {t('costs.unitsAt', { count: lot.deviceCount, amount: money(lot.unitPurchaseCost, lot.currency) })} ·{' '}
                      {date(lot.receivedAt)}
                    </p>
                  </div>
                  <Badge variant="outline">{t('costs.statement')}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Coins} title={t('costs.noLots')} description={t('costs.noLotsLead')} />
        )}
      </section>
    </div>
  );
}

function NewCostForm({ lots, onDone }: { lots: Lot[]; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({
    type: 'FREIGHT',
    description: '',
    amount: '',
    currency: 'EUR',
    allocation: 'QUANTITY',
    scope: 'LOT',
    scopeId: '',
    incurredAt: '',
  });

  const receipts = useApiQuery<{ data: { id: string; number: string; warehouse: { name: string } }[] }>(
    '/receipts?pageSize=50',
  );
  const transfers = useApiQuery<{
    data: { id: string; number: string; destinationWarehouse: { name: string } }[];
  }>('/transfers?pageSize=50');

  const create = useApiMutation(
    (body: unknown) => api.post<CostDocument>('/cost-documents', body),
    ['/cost-documents', '/inventory', '/reports', '/lots', '/imeis'],
  );

  const options =
    form.scope === 'LOT'
      ? lots.map((l) => ({ id: l.id, label: `${l.number} — ${l.product.name}` }))
      : form.scope === 'RECEIPT'
        ? (receipts.data?.data ?? []).map((r) => ({ id: r.id, label: `${r.number} — ${r.warehouse.name}` }))
        : (transfers.data?.data ?? []).map((t) => ({
            id: t.id,
            label: `${t.number} → ${t.destinationWarehouse.name}`,
          }));

  const ready = form.amount && Number(form.amount) > 0 && form.scopeId;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('costs.record')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              {
                type: form.type,
                description: form.description || undefined,
                amount: Number(form.amount).toFixed(2),
                currency: form.currency,
                allocation: form.allocation,
                scope: form.scope,
                scopeId: form.scopeId,
                ...(form.incurredAt ? { incurredAt: new Date(form.incurredAt).toISOString() } : {}),
              },
              {
                onSuccess: (result) => {
                  toast.push(
                    'success',
                    result.restatedSales > 0
                      ? t('costs.postedRestated', { count: result.restatedSales })
                      : t('costs.postedUnits', { count: result.unitCount }),
                  );
                  onDone();
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cost-type">{t('costs.type')}</Label>
            <Select id="cost-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`cost.type.${type}`)}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cost-scope">{t('costs.appliesTo')}</Label>
            <Select
              id="cost-scope"
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value, scopeId: '' })}
            >
              <option value="LOT">{t('costs.scopeLot')}</option>
              <option value="RECEIPT">{t('costs.scopeReceipt')}</option>
              <option value="SHIPMENT">{t('costs.scopeShipment')}</option>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cost-target">{t('costs.whichOne')}</Label>
            <Select
              id="cost-target"
              value={form.scopeId}
              onChange={(e) => setForm({ ...form, scopeId: e.target.value })}
              required
            >
              <option value="">{t('brands.choose')}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cost-amount">{t('costs.amount')}</Label>
            <Input
              id="cost-amount"
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cost-currency">{t('costs.currency')}</Label>
            <Select
              id="cost-currency"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            >
              <option value="EUR">EUR</option>
              <option value="DZD">{t('costs.currencyDzd')}</option>
              <option value="USD">USD</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cost-allocation">{t('costs.spreadBy')}</Label>
            <Select
              id="cost-allocation"
              value={form.allocation}
              onChange={(e) => setForm({ ...form, allocation: e.target.value })}
            >
              <option value="QUANTITY">{t('costs.allocationQuantity')}</option>
              <option value="VALUE">{t('costs.allocationValue')}</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cost-date">{t('costs.dateIncurred')}</Label>
            <Input
              id="cost-date"
              type="date"
              value={form.incurredAt}
              onChange={(e) => setForm({ ...form, incurredAt: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('costs.dateHint')}</p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cost-desc">{t('costs.description')}</Label>
            <Input
              id="cost-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('costs.descriptionPlaceholder')}
            />
          </div>

          <div className="sm:col-span-2">
            <FormError error={create.error} />
            <p className="mt-2 text-xs text-muted-foreground">{t('costs.postingHint')}</p>
          </div>

          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? t('costs.posting') : t('costs.post')}
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
