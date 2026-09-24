import { Pencil, Plus, Trash2, UserCog } from 'lucide-react';
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
  const [editing, setEditing] = useState<UserRow | null>(null);
  const debounced = useDebounce(search);

  const query = useApiList<UserRow>('/users', {
    search: debounced || undefined,
    page,
    pageSize: 25,
  });
  const update = useApiMutation(
    ({ id, body }: { id: string; body: unknown }) => api.patch<UserRow>(`/users/${id}`, body),
    ['/users'],
  );
  const remove = useApiMutation(
    (id: string) => api.delete<{ deleted: 'removed' | 'archived' }>(`/users/${id}`),
    ['/users'],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nav.users')}
        description={t('users.lead')}
        action={
          <Button
            className="gap-2"
            onClick={() => {
              setEditing(null);
              setCreating((c) => !c);
            }}
          >
            <Plus className="h-5 w-5" />
            {t('users.new')}
          </Button>
        }
      />

      {creating && <UserForm onDone={() => setCreating(false)} />}
      {editing && <UserForm key={editing.id} user={editing} onDone={() => setEditing(null)} />}

      <SearchField
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder={t('users.search')}
      />

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
                  <Td className="text-muted-foreground">{user.lastLoginAt ? dateTime(user.lastLoginAt) : '—'}</Td>
                  <Td className="text-end">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={t('users.edit')}
                        title={t('users.edit')}
                        onClick={() => {
                          setCreating(false);
                          setEditing(user);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {user.id !== me?.id && (
                        <Button
                          variant="outline"
                          size="sm"
                          className={
                            user.isActive
                              ? 'text-muted-foreground hover:border-destructive/50 hover:text-destructive'
                              : undefined
                          }
                          disabled={update.isPending}
                          onClick={() =>
                            (!user.isActive || window.confirm(`${t('users.deactivate')} — ${user.name}?`)) &&
                            update.mutate(
                              {
                                id: user.id,
                                body: { isActive: !user.isActive },
                              },
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
                      {user.id !== me?.id && (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t('users.delete')}
                          className="text-destructive hover:border-destructive/50"
                          disabled={remove.isPending}
                          onClick={() =>
                            window.confirm(t('users.deleteConfirm', { name: user.name })) &&
                            remove.mutate(user.id, {
                              onSuccess: (r) =>
                                toast.push(
                                  'success',
                                  r.deleted === 'archived' ? t('users.archived') : t('users.deleted'),
                                ),
                              onError: (error) => toast.push('error', error.message),
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
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

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

/** Creates a user, or edits one when `user` is given (blank password = keep it). */
function UserForm({ user, onDone }: { user?: UserRow; onDone: () => void }) {
  const { t } = useI18n();
  const me = useAuth((s) => s.user);
  const editingSelf = user?.id === me?.id;
  const toast = useToast();
  const warehouses = useApiQuery<{ id: string; name: string }[]>('/warehouses');
  const costCenters = useApiQuery<{ id: string; name: string }[]>('/cost-centers');

  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    role: user?.role ?? 'WAREHOUSE_USER',
    warehouseId: user?.warehouse?.id ?? '',
    costCenterId: user?.costCenter?.id ?? '',
  });

  const create = useApiMutation(
    (body: unknown) => (user ? api.patch(`/users/${user.id}`, body) : api.post('/users', body)),
    ['/users'],
  );

  const needsWarehouse = form.role === 'WAREHOUSE_USER';
  const passwordOk = user ? form.password === '' || form.password.length >= 10 : form.password.length >= 10;
  const ready = form.name && form.email && passwordOk && (!needsWarehouse || form.warehouseId);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{user ? t('users.editTitle', { name: user.name }) : t('users.new')}</CardTitle>
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
                ...(form.password ? { password: form.password } : {}),
                ...(editingSelf ? {} : { role: form.role }),
                warehouseId: form.warehouseId || (user ? null : undefined),
                costCenterId: form.costCenterId || (user ? null : undefined),
              },
              {
                onSuccess: () => {
                  toast.push('success', user ? t('users.saved') : t('users.created'));
                  onDone();
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="u-name">{t('users.name')}</Label>
            <Input
              id="u-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
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
            <Label htmlFor="u-password">{user ? t('users.newPassword') : t('users.tempPassword')}</Label>
            <Input
              id="u-password"
              type="text"
              autoComplete="new-password"
              minLength={10}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!user}
              placeholder={user ? t('users.keepPassword') : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {user ? t('users.newPasswordHint') : t('users.passwordHint')}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-role">{t('users.role')}</Label>
            <Select
              id="u-role"
              value={form.role}
              disabled={editingSelf}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
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
              {create.isPending ? t('common.saving') : user ? t('users.save') : t('users.create')}
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
