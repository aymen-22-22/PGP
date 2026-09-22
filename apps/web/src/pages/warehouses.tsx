import { Plus, Warehouse, Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ImagePicker } from '@/components/image-picker';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';

interface WarehouseRow {
  imageUrl?: string | null;
  id: string;
  name: string;
  code: string;
  country: string;
  isActive: boolean;
}
interface CostCenter {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  warehouse: { id: string; name: string } | null;
}

export default function WarehousesPage() {
  const { t } = useI18n();
  const [creating, setCreating] = useState<'warehouse' | 'costCenter' | null>(null);
  const [photoFor, setPhotoFor] = useState<WarehouseRow | null>(null);
  const warehouses = useApiQuery<WarehouseRow[]>('/warehouses');
  const costCenters = useApiQuery<CostCenter[]>('/cost-centers');

  return (
    <div className="space-y-6">
      {photoFor && (
        <WarehousePhoto
          key={photoFor.id}
          warehouse={photoFor}
          onDone={() => {
            setPhotoFor(null);
            void warehouses.refetch();
          }}
        />
      )}

      <PageHeader
        title={t('nav.warehouses')}
        description={t('wh.lead')}
        action={
          <div className="flex gap-2">
            <Button className="gap-2" onClick={() => setCreating(creating === 'warehouse' ? null : 'warehouse')}>
              <Plus className="h-5 w-5" />
              {t('common.warehouse')}
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setCreating(creating === 'costCenter' ? null : 'costCenter')}
            >
              <Plus className="h-5 w-5" />
              {t('more.costCentre')}
            </Button>
          </div>
        }
      />

      {creating === 'warehouse' && <NewWarehouseForm onDone={() => setCreating(null)} />}
      {creating === 'costCenter' && (
        <NewCostCenterForm warehouses={warehouses.data ?? []} onDone={() => setCreating(null)} />
      )}

      {warehouses.isLoading && <LoadingState />}
      {warehouses.isError && <ErrorState error={warehouses.error} onRetry={() => void warehouses.refetch()} />}

      {warehouses.data && warehouses.data.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('common.warehouse')}</Th>
              <Th>{t('wh.code')}</Th>
              <Th>{t('wh.country')}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {warehouses.data.map((warehouse) => (
              <Tr key={warehouse.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                      {warehouse.imageUrl ? (
                        <img src={warehouse.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                      )}
                    </div>
                    <span className="font-medium">{warehouse.name}</span>
                  </div>
                </Td>
                <Td className="tabular text-muted-foreground">{warehouse.code}</Td>
                <Td className="text-muted-foreground">{warehouse.country}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-2">
                    {!warehouse.isActive && <Badge variant="secondary">{t('users.inactive')}</Badge>}
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setPhotoFor((current) => (current?.id === warehouse.id ? null : warehouse))}
                    >
                      <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                      {warehouse.imageUrl ? t('wh.changePhoto') : t('wh.addPhoto')}
                    </Button>
                    <WarehouseToggle warehouse={warehouse} onChanged={() => void warehouses.refetch()} />
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('wh.costCentres')}</h2>
        {costCenters.data && costCenters.data.length > 0 ? (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('more.costCentre')}</Th>
                <Th>{t('wh.code')}</Th>
                <Th>{t('common.warehouse')}</Th>
              </tr>
            </thead>
            <tbody>
              {costCenters.data.map((cc) => (
                <Tr key={cc.id}>
                  <Td className="font-medium">{cc.name}</Td>
                  <Td className="tabular text-muted-foreground">{cc.code}</Td>
                  <Td className="text-muted-foreground">{cc.warehouse?.name ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState icon={Warehouse} title={t('wh.noCostCentres')} />
        )}
      </section>
    </div>
  );
}

function WarehouseToggle({ warehouse, onChanged }: { warehouse: WarehouseRow; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const toggle = useApiMutation(
    (isActive: boolean) => api.patch(`/warehouses/${warehouse.id}`, { isActive }),
    ['/warehouses'],
  );

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={toggle.isPending}
      onClick={() =>
        toggle.mutate(!warehouse.isActive, {
          onSuccess: onChanged,
          onError: (error) => toast.push('error', error.message),
        })
      }
    >
      {warehouse.isActive ? t('users.deactivate') : t('users.activate')}
    </Button>
  );
}

function NewWarehouseForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', code: '', country: '' });
  const [picked, setPicked] = useState<Blob | null>(null);
  const create = useApiMutation(
    (body: unknown) => api.post<{ id: string }>('/warehouses', body),
    ['/warehouses', '/reports', '/stock-explorer'],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('wh.newWarehouseTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(form, {
              // The upload endpoint is keyed by id, so the photo follows the
              // warehouse rather than travelling with it.
              onSuccess: async (warehouse) => {
                if (picked) {
                  try {
                    const body = new FormData();
                    body.append('image', picked, 'photo.jpg');
                    await api.upload(`/warehouses/${warehouse.id}/image`, body);
                  } catch (error) {
                    toast.push(
                      'error',
                      t('wh.photoUploadFailed', { message: (error as Error).message }),
                    );
                  }
                }
                toast.push('success', t('wh.warehouseCreated'));
                onDone();
              },
              onError: (error) => toast.push('error', error.message),
            });
          }}
        >
          <div className="sm:col-span-3">
            <ImagePicker
              id="wh-photo"
              label={t('wh.buildPhoto')}
              size="lg"
              currentUrl={null}
              onChange={setPicked}
              hint={t('wh.photoHint')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wh-name">{t('wh.name')}</Label>
            <Input id="wh-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-code">{t('wh.code')}</Label>
            <Input id="wh-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-country">{t('wh.country')}</Label>
            <Input
              id="wh-country"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              required
            />
          </div>
          <div className="sm:col-span-3">
            <FormError error={create.error} />
          </div>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" disabled={create.isPending || !form.name || !form.code || !form.country}>
              {create.isPending ? t('common.creating') : t('wh.create')}
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

function NewCostCenterForm({ warehouses, onDone }: { warehouses: WarehouseRow[]; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', code: '', warehouseId: '' });
  const create = useApiMutation((body: unknown) => api.post('/cost-centers', body), ['/cost-centers']);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('wh.newCostCentreTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              { ...form, warehouseId: form.warehouseId || undefined },
              {
                onSuccess: () => {
                  toast.push('success', t('wh.costCentreCreated'));
                  onDone();
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cc-name">{t('wh.name')}</Label>
            <Input id="cc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-code">{t('wh.code')}</Label>
            <Input id="cc-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-warehouse">{t('common.warehouse')}</Label>
            <Select
              id="cc-warehouse"
              value={form.warehouseId}
              onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
            >
              <option value="">{t('common.none')}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-3">
            <FormError error={create.error} />
          </div>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" disabled={create.isPending || !form.name || !form.code}>
              {create.isPending ? t('common.creating') : t('wh.create')}
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

/**
 * Attaching a photo to a warehouse that already exists.
 *
 * Deliberately just the picture: warehouses are created rarely and edited more
 * rarely still, so a whole edit form would be built for one field nobody asked
 * to change.
 */
function WarehousePhoto({ warehouse, onDone }: { warehouse: WarehouseRow; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [picked, setPicked] = useState<Blob | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (picked) {
        const body = new FormData();
        body.append('image', picked, 'photo.jpg');
        await api.upload(`/warehouses/${warehouse.id}/image`, body);
        toast.push('success', t('wh.photoSaved'));
      } else if (picked === null) {
        await api.delete(`/warehouses/${warehouse.id}/image`);
        toast.push('success', t('wh.photoRemoved'));
      }
      onDone();
    } catch (error) {
      toast.push('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('wh.photoOf', { name: warehouse.name })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ImagePicker
          id={`wh-photo-${warehouse.id}`}
          label={t('wh.buildPhoto')}
          size="lg"
          currentUrl={warehouse.imageUrl ?? null}
          onChange={setPicked}
          hint={t('wh.photoHintPick')}
        />
        <div className="flex gap-2">
          <Button disabled={busy || picked === undefined} onClick={() => void save()}>
            {busy ? t('common.saving') : t('wh.savePhoto')}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {t('common.cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}