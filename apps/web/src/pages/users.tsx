import { Plus, UserCog } from 'lucide-react';
import { useState } from 'react';
import { Pagination } from '@/components/pagination';
import { PageHeader, SearchField } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useApiList, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  warehouse: { id: string; name: string } | null;
  costCenter: { id: string; name: string } | null;
}

export default function UsersPage() {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(search);

  const query = useApiList<UserRow>('/users', { search: debounced || undefined, page, pageSize: 25 });
  const update = useApiMutation(
    ({ id, body }: { id: string; body: unknown }) => api.patch<UserRow>(`/users/${id}`, body),
    ['/users'],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.users')}
        description={t('users.lead')}
        action={
          <Button className="gap-2" onClick={() => setCreating((c) => !c)}>
            <Plus className="h-5 w-5" />
            {t('users.new')}
          </Button>
        }
      />

      {creating && <NewUserForm onDone={() => setCreating(false)} />}

      <SearchField value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={t('users.search')} />

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.data.length === 0 && <EmptyState icon={UserCog} title={t('users.none')} />}

      {query.data && query.data.data.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('users.name')}</Th>
                <Th>{t('users.role')}</Th>
                <Th>{t('common.warehouse')}</Th>
                <Th>{t('users.lastLogin')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((user) => (
                <Tr key={user.id} className={user.isActive ? undefined : 'bg-muted/40 text-muted-foreground'}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
                        aria-hidden
                      >
                        {initials(user.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium text-foreground">
                          {user.name}
                          {!user.isActive && <Badge variant="destructive">{t('users.inactive')}</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'}>
                      {user.role === 'ADMIN' ? t('users.roleAdmin') : t('users.roleWarehouse')}
                    </Badge>
                  </Td>
                  <Td className="text-muted-foreground">{user.warehouse?.name ?? t('users.all')}</Td>
                  <Td className="text-muted-foreground">
                    {user.lastLoginAt ? dateTime(user.lastLoginAt) : '—'}
                  </Td>
                  <Td className="text-end">
                    {user.id !== me?.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className={user.isActive ? 'text-muted-foreground hover:border-destructive/50 hover:text-destructive' : undefined}
                        disabled={update.isPending}
                        onClick={() =>
                          (!user.isActive || window.confirm(`${t('users.deactivate')} — ${user.name}?`)) &&
                          update.mutate(
                            { id: user.id, body: { isActive: !user.isActive } },
                            {
                              onSuccess: () =>
                                toast.push('success', user.isActive ? t('users.deactivated') : t('users.activated')),
                              onError: (error) => toast.push('error', error.message),
                            },
                          )
                        }
                      >
                        {user.isActive ? t('users.deactivate') : t('users.activate')}
                      </Button>
                    )}
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

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

function NewUserForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const warehouses = useApiQuery<{ id: string; name: string }[]>('/warehouses');
  const costCenters = useApiQuery<{ id: string; name: string }[]>('/cost-centers');

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'WAREHOUSE_USER',
    warehouseId: '',
    costCenterId: '',
  });

  const create = useApiMutation((body: unknown) => api.post('/users', body), ['/users']);

  const needsWarehouse = form.role === 'WAREHOUSE_USER';
  const ready =
    form.name && form.email && form.password.length >= 10 && (!needsWarehouse || form.warehouseId);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('users.new')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              {
                name: form.name,
                email: form.email,
                password: form.password,
                role: form.role,
                warehouseId: form.warehouseId || undefined,
                costCenterId: form.costCenterId || undefined,
              },
              {
                onSuccess: () => {
                  toast.push('success', t('users.created'));
                  onDone();
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="u-name">{t('users.name')}</Label>
            <Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">{t('users.email')}</Label>
            <Input
              id="u-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-password">{t('users.tempPassword')}</Label>
            <Input
              id="u-password"
              type="text"
              minLength={10}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
            <p className="text-xs text-muted-foreground">{t('users.passwordHint')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-role">{t('users.role')}</Label>
            <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="WAREHOUSE_USER">{t('users.roleWarehouseDesc')}</option>
              <option value="ADMIN">{t('users.roleAdminDesc')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-warehouse">
              {t('common.warehouse')}
              {needsWarehouse ? '' : ` (${t('common.optional')})`}
            </Label>
            <Select
              id="u-warehouse"
              value={form.warehouseId}
              onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
              required={needsWarehouse}
            >
              <option value="">{t('common.choose')}</option>
              {warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-cc">
              {t('more.costCentre')} ({t('common.optional')})
            </Label>
            <Select
              id="u-cc"
              value={form.costCenterId}
              onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}
            >
              <option value="">{t('common.none')}</option>
              {costCenters.data?.map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {cc.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:col-span-2">
            <FormError error={create.error} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? t('common.creating') : t('users.create')}
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