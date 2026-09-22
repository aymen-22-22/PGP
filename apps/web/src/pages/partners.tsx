import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Pagination } from '@/components/pagination';
import { PageHeader, SearchField } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useApiList, useApiMutation } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';

interface Party {
  id: string;
  name: string;
  country: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

/** Suppliers and customers share one screen — the records are identical (spec §10, §17). */
export default function PartnersPage({ kind }: { kind: 'customers' | 'suppliers' }) {
  const user = useAuth((s) => s.user);
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(search);

  const label = kind === 'customers' ? t('partners.customers') : t('partners.suppliers');
  const query = useApiList<Party>(`/${kind}`, { search: debounced || undefined, page, pageSize: 25 });

  return (
    <div className="space-y-5">
      <PageHeader
        title={label}
        description={kind === 'customers' ? t('partners.customers.lead') : t('partners.suppliers.lead')}
        action={
          isAdmin(user) && (
            <Button className="gap-2" onClick={() => setCreating((c) => !c)}>
              <Plus className="h-5 w-5" />
              {t('partners.new')}
            </Button>
          )
        }
      />

      {creating && <NewPartyForm kind={kind} onDone={() => setCreating(false)} />}

      <SearchField value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={t('partners.search', { kind: label.toLowerCase() })} />

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.data.length === 0 && <EmptyState icon={Building2} title={t('partners.none', { kind: label.toLowerCase() })} />}

      {query.data && query.data.data.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('users.name')}</Th>
                <Th>{t('wh.country')}</Th>
                <Th>{t('users.email')}</Th>
                <Th>{t('partners.phone')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((party) => (
                <Tr key={party.id}>
                  <Td className="font-medium">{party.name}</Td>
                  <Td className="text-muted-foreground">{party.country ?? '—'}</Td>
                  <Td className="text-muted-foreground">{party.email ?? '—'}</Td>
                  <Td className="tabular text-muted-foreground">{party.phone ?? '—'}</Td>
                  <Td>{!party.isActive && <Badge variant="secondary">{t('users.inactive')}</Badge>}</Td>
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

export function NewPartyForm({
  kind,
  onDone,
}: {
  kind: 'customers' | 'suppliers';
  onDone: (created?: Party) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', country: '', email: '', phone: '', address: '' });

  const create = useApiMutation((body: unknown) => api.post<Party>(`/${kind}`, body), [`/${kind}`]);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {kind === 'customers' ? t('partners.newCustomer') : t('partners.newSupplier')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              Object.fromEntries(Object.entries(form).filter(([, value]) => value !== '')),
              {
                onSuccess: (created) => {
                  toast.push('success', t('partners.saved'));
                  onDone(created);
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="party-name">{t('users.name')}</Label>
            <Input id="party-name" value={form.name} onChange={set('name')} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="party-country">{t('wh.country')}</Label>
            <Input id="party-country" value={form.country} onChange={set('country')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="party-email">{t('users.email')}</Label>
            <Input id="party-email" type="email" value={form.email} onChange={set('email')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="party-phone">{t('partners.phone')}</Label>
            <Input id="party-phone" value={form.phone} onChange={set('phone')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="party-address">{t('partners.address')}</Label>
            <Input id="party-address" value={form.address} onChange={set('address')} />
          </div>

          <div className="sm:col-span-2">
            <FormError error={create.error} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={!form.name || create.isPending}>
              {create.isPending ? t('common.saving') : t('common.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onDone()}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
