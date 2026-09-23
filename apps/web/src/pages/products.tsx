import { Package, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ImagePicker } from '@/components/image-picker';
import { BrandSelect } from '@/features/brands/brand-select';
import { Pagination } from '@/components/pagination';
import { PageHeader, SearchField } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { isAdmin, useAuth } from '@/lib/auth';
import { useQueryClient } from '@tanstack/react-query';
import type { Product } from '@phone-erp/shared-types';
import { useApiList, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';


export default function ProductsPage() {
  const { t, money, n } = useI18n();
  // Arriving from another form: `new=1` opens the form straight away, and
  // `return` is where to go once the product exists.
  const [params, setParams] = useSearchParams();
  const returnTo = params.get('return');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState<Product | null>(null);
  const debounced = useDebounce(search);

  const query = useApiList<Product>('/products', { search: debounced || undefined, page, pageSize: 25 });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('products.title')}
        description={t('products.lead')}
        action={
          <Button
            className="gap-2"
            onClick={() => {
              setEditing(null);
              setCreating((c) => !c);
            }}
          >
            <Plus className="h-5 w-5" />
            {t('products.new')}
          </Button>
        }
      />

      {creating && (
        <ProductForm
          onDone={() => {
            setCreating(false);
            // Drop the query so a refresh does not reopen the form.
            if (params.has('new') || params.has('return')) setParams({}, { replace: true });
          }}
          onCreated={
            returnTo
              ? (product) => {
                  // Hand the new product's id back, so the form that sent us
                  // here can select it without the user hunting for it.
                  navigate(`${returnTo}?created=${product.id}`, { replace: true });
                }
              : undefined
          }
        />
      )}

      {editing && (
        // Keyed by id so choosing a different row rebuilds the form with that
        // product's values instead of keeping the previous one's.
        <ProductForm key={editing.id} product={editing} onDone={() => setEditing(null)} />
      )}

      <SearchField value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={t('products.search')} />

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.data.length === 0 && <EmptyState icon={Package} title={t('products.none')} />}

      {query.data && query.data.data.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('products.product')}</Th>
                <Th>{t('products.brand')}</Th>
                <Th>{t('products.sku')}</Th>
                <Th>{t('products.counted')}</Th>
                <Th className="text-end">{t('products.inStock')}</Th>
                <Th className="text-end">{t('products.purchase')}</Th>
                <Th className="text-end">{t('products.sale')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((product) => (
                <Tr key={product.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      {product.imageUrl && (
                        <div className="h-9 w-9 shrink-0 overflow-hidden rounded border bg-muted">
                          <img src={product.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        </div>
                      )}
                      <span className="max-w-[16rem] truncate font-medium">{product.name}</span>
                    </div>
                  </Td>
                  <Td className="font-medium">{product.brand?.name ?? '—'}</Td>
                  <Td className="tabular text-muted-foreground">{product.sku}</Td>
                  <Td>
                    <Badge variant={product.tracking === 'BULK' ? 'secondary' : 'outline'}>
                      {product.tracking === 'BULK' ? t('products.quantity') : t('products.imei')}
                    </Badge>
                  </Td>
                  <Td
                    className={`tabular text-end font-semibold ${product.inStock ? '' : 'text-muted-foreground'}`}
                  >
                    {n(product.inStock ?? 0)}
                  </Td>
                  <Td className="tabular text-end">{money(product.purchasePrice, product.currency)}</Td>
                  <Td className="tabular text-end font-semibold">
                    {money(product.defaultSalePrice, product.currency)}
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-2">
                      {!product.isActive && <Badge variant="secondary">{t('products.retired')}</Badge>}
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          setCreating(false);
                          setEditing((current) => (current?.id === product.id ? null : product));
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        {t('products.edit')}
                      </Button>
                    </div>
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

/**
 * One form for both creating and editing.
 *
 * They ask for exactly the same fields, and keeping two copies is how the
 * tracking-mode picker ends up on one of them and not the other.
 */
function ProductForm({
  product,
  onDone,
  onCreated,
}: {
  /** Absent when creating. */
  product?: Product;
  onDone: () => void;
  onCreated?: (product: Product) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useAuth((s) => s.user);
  const { t } = useI18n();
  const editing = Boolean(product);
  const [form, setForm] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    brandId: product?.brandId ?? '',
    model: product?.model ?? '',
    storage: product?.storage ?? '',
    color: product?.color ?? '',
    purchasePrice: product?.purchasePrice ?? '',
    defaultSalePrice: product?.defaultSalePrice ?? '',
    tracking: product?.tracking ?? ('SERIALIZED' as 'SERIALIZED' | 'BULK'),
  });
  const [isActive, setIsActive] = useState(product?.isActive ?? true);

  // The picture is chosen now but sent after the product is saved, because the
  // upload endpoint needs an id — which a product being created does not have
  // yet. `null` means "remove the existing one".
  const [picked, setPicked] = useState<Blob | null | undefined>(undefined);

  // How a product is counted cannot change once it holds any, so ask before
  // offering the choice rather than letting the save fail.
  const stock = useApiQuery<{ data: { inStock: number }[] }>(
    `/inventory?productId=${product?.id ?? ''}`,
    { enabled: editing },
  );
  const hasStock = (stock.data?.data ?? []).some((row) => row.inStock > 0);
  const trackingLocked = editing && (stock.isLoading || hasStock);

  const create = useApiMutation((body: unknown) => api.post<Product>('/products', body), ['/products']);
  const update = useApiMutation(
    (body: unknown) => api.patch<Product>(`/products/${product!.id}`, body),
    ['/products', '/inventory', '/stock'],
  );
  const save = editing ? update : create;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const ready =
    form.name && form.sku && form.brandId && form.model && form.purchasePrice && form.defaultSalePrice;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {editing ? t('products.editTitle', { name: product!.name }) : t('products.new')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(
              {
                ...form,
                storage: form.storage || undefined,
                color: form.color || undefined,
                barcode: form.barcode || undefined,
                purchasePrice: Number(form.purchasePrice).toFixed(2),
                defaultSalePrice: Number(form.defaultSalePrice).toFixed(2),
                // Sending an unchanged tracking mode is refused once the
                // product holds stock, so only send it when it actually moved.
                ...(editing
                  ? { tracking: form.tracking === product!.tracking ? undefined : form.tracking, isActive }
                  : {}),
              },
              {
                onSuccess: async (saved) => {
                  try {
                    if (picked) {
                      const body = new FormData();
                      body.append('image', picked, 'photo.jpg');
                      await api.upload(`/products/${saved.id}/image`, body);
                    } else if (picked === null && product?.imageUrl) {
                      await api.delete(`/products/${saved.id}/image`);
                    }
                  } catch (error) {
                    // The product itself saved; only the picture failed, and
                    // saying "could not save" about all of it would be untrue.
                    toast.push('error', t('products.pictureFailed', { message: (error as Error).message }));
                  }
                  // Keys are the full path including the query string, so an
                  // exact key never matches a paged list. The mutation's own
                  // invalidation already ran, before the picture existed.
                  await queryClient.invalidateQueries({
                    predicate: (query) => String(query.queryKey[0] ?? '').startsWith('/products'),
                  });
                  toast.push('success', editing ? t('products.updated') : t('products.created'));
                  if (!editing && onCreated) return onCreated(saved);
                  onDone();
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          {/* Placed first: on a phone the picture is what people recognise,
              and choosing it before typing matches how a product gets added at
              a bench with the box in hand. */}
          <div className="sm:col-span-2">
            <ImagePicker
              id="photo"
              currentUrl={product?.imageUrl ?? null}
              onChange={(blob) => setPicked(blob)}
            />
          </div>

          <Field id="name" label={t('users.name')} value={form.name} onChange={set('name')} className="sm:col-span-2" required />
          <Field id="sku" label={t('products.sku')} value={form.sku} onChange={set('sku')} required />
          <Field
            id="barcode"
            label={t('products.barcode')}
            value={form.barcode}
            onChange={set('barcode')}
            inputMode="numeric"
            placeholder={t('products.barcodePlaceholder')}
          />
          <BrandSelect
            value={form.brandId}
            onChange={(brandId) => setForm((f) => ({ ...f, brandId }))}
            canCreate={isAdmin(user)}
            label={t('products.brand')}
          />
          <Field id="model" label={t('products.model')} value={form.model} onChange={set('model')} required />
          <Field id="storage" label={t('products.storage')} value={form.storage} onChange={set('storage')} />
          <Field id="color" label={t('products.colour')} value={form.color} onChange={set('color')} />

          {/* Chosen once and effectively permanent — the API refuses to change
              it once any stock exists — so it is spelled out rather than left
              as a checkbox someone ticks without reading. */}
          <fieldset className="space-y-2 sm:col-span-2" disabled={trackingLocked}>
            <legend className="mb-1.5 text-sm font-medium">{t('products.countedHow')}</legend>
            <div className={cn('grid gap-2 sm:grid-cols-2', trackingLocked && 'opacity-60')}>
              <TrackingChoice
                checked={form.tracking === 'SERIALIZED'}
                onSelect={() => setForm((f) => ({ ...f, tracking: 'SERIALIZED' }))}
                title={t('products.byImei')}
                detail={t('products.byImeiDetail')}
              />
              <TrackingChoice
                checked={form.tracking === 'BULK'}
                onSelect={() => setForm((f) => ({ ...f, tracking: 'BULK' }))}
                title={t('products.byQuantity')}
                detail={t('products.byQuantityDetail')}
              />
            </div>
            {hasStock ? (
              <p className="text-xs text-muted-foreground">{t('products.trackingLocked')}</p>
            ) : (
              form.tracking === 'BULK' && (
                <p className="text-xs text-muted-foreground">{t('products.bulkWarning')}</p>
              )
            )}
          </fieldset>

          {editing && (
            <label className="flex touch-target items-center gap-3 rounded-md border p-3 sm:col-span-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-5 w-5 accent-[hsl(var(--primary))]"
              />
              <span className="text-sm">
                <b>{t('products.available')}</b> {t('products.availableDetail')}
              </span>
            </label>
          )}
          <Field
            id="purchasePrice"
            label={t('products.purchasePrice')}
            type="number"
            step="0.01"
            value={form.purchasePrice}
            onChange={set('purchasePrice')}
            required
          />
          <Field
            id="defaultSalePrice"
            label={t('products.defaultSalePrice')}
            type="number"
            step="0.01"
            value={form.defaultSalePrice}
            onChange={set('defaultSalePrice')}
            required
          />

          <div className="sm:col-span-2">
            <FormError error={save.error} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={!ready || save.isPending}>
              {save.isPending
                ? editing
                  ? t('common.saving')
                  : t('common.creating')
                : editing
                  ? t('products.saveChanges')
                  : t('products.create')}
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

function TrackingChoice({
  checked,
  onSelect,
  title,
  detail,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className={`rounded-lg border-2 p-3 text-start transition-colors ${
        checked ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
      }`}
    >
      <span className="block font-semibold">{title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}

function Field({
  id,
  label,
  className,
  ...props
}: { id: string; label: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  );
}
