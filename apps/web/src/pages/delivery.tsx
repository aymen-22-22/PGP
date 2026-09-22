import { Building2, Plus, Truck, User } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useApiList, useApiMutation } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';

interface CompanyRow {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  drivers: number;
  shipments: number;
}

interface DriverRow {
  id: string;
  name: string;
  phone: string | null;
  vehicle: string | null;
  notes: string | null;
  isActive: boolean;
  company: { id: string; name: string } | null;
  shipments: number;
}

/**
 * Who the business hands stock to for the road between warehouses.
 *
 * Retiring rather than deleting is the normal outcome here — a firm that has
 * ever carried a shipment stays on record so that shipment keeps saying who
 * moved it; the API refuses the hard delete once anything points at it.
 */
export default function DeliveryPage() {
  const { t } = useI18n();
  const [creating, setCreating] = useState<'company' | 'driver' | null>(null);
  const companies = useApiList<CompanyRow>('/delivery/companies', {
    includeInactive: true,
    pageSize: 100,
  });
  const drivers = useApiList<DriverRow>('/delivery/drivers', { includeInactive: true, pageSize: 100 });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('delivery.title')}
        description={t('delivery.lead')}
        action={
          <div className="flex gap-2">
            <Button className="gap-2" onClick={() => setCreating(creating === 'company' ? null : 'company')}>
              <Plus className="h-5 w-5" />
              {t('delivery.newCompany')}
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setCreating(creating === 'driver' ? null : 'driver')}
            >
              <Plus className="h-5 w-5" />
              {t('delivery.newDriver')}
            </Button>
          </div>
        }
      />

      {creating === 'company' && <NewCompanyForm onDone={() => setCreating(null)} />}
      {creating === 'driver' && (
        <NewDriverForm companies={companies.data?.data ?? []} onDone={() => setCreating(null)} />
      )}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Building2 className="h-5 w-5" aria-hidden />
          {t('delivery.companies')}
        </h2>
        {companies.isLoading && <LoadingState />}
        {companies.isError && <ErrorState error={companies.error} onRetry={() => void companies.refetch()} />}
        {companies.data?.data.length === 0 && (
          <EmptyState icon={Truck} title={t('delivery.noCompanies')} description={t('delivery.noCompaniesBody')} />
        )}
        {companies.data && companies.data.data.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('delivery.company')}</Th>
                <Th>{t('delivery.contact')}</Th>
                <Th>{t('common.status')}</Th>
                <Th className="text-end">{t('delivery.drivers')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {companies.data.data.map((company) => (
                <CompanyRowItem key={company.id} company={company} onChanged={() => void companies.refetch()} />
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <User className="h-5 w-5" aria-hidden />
          {t('delivery.driversSection')}
        </h2>
        {drivers.isLoading && <LoadingState />}
        {drivers.isError && <ErrorState error={drivers.error} onRetry={() => void drivers.refetch()} />}
        {drivers.data?.data.length === 0 && (
          <EmptyState icon={User} title={t('delivery.noDrivers')} description={t('delivery.noDriversBody')} />
        )}
        {drivers.data && drivers.data.data.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>{t('delivery.driver')}</Th>
                <Th>{t('delivery.company')}</Th>
                <Th>{t('delivery.phone')}</Th>
                <Th>{t('common.status')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {drivers.data.data.map((driver) => (
                <DriverRowItem key={driver.id} driver={driver} onChanged={() => void drivers.refetch()} />
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>
    </div>
  );
}

function CompanyRowItem({ company, onChanged }: { company: CompanyRow; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const toggle = useApiMutation(
    (isActive: boolean) => api.patch(`/delivery/companies/${company.id}`, { isActive }),
    ['/delivery'],
  );

  return (
    <Tr>
      <Td className="font-medium">{company.name}</Td>
      <Td className="text-muted-foreground">
        {[company.contact, company.phone].filter(Boolean).join(' · ') || '—'}
      </Td>
      <Td>{!company.isActive && <Badge variant="secondary">{t('users.inactive')}</Badge>}</Td>
      <Td className="tabular text-end text-muted-foreground">{company.drivers}</Td>
      <Td>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={toggle.isPending}
            onClick={() =>
              toggle.mutate(!company.isActive, {
                onSuccess: onChanged,
                onError: (error) => toast.push('error', error.message),
              })
            }
          >
            {company.isActive ? t('users.deactivate') : t('users.activate')}
          </Button>
        </div>
      </Td>
    </Tr>
  );
}

function DriverRowItem({ driver, onChanged }: { driver: DriverRow; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const toggle = useApiMutation(
    (isActive: boolean) => api.patch(`/delivery/drivers/${driver.id}`, { isActive }),
    ['/delivery'],
  );

  return (
    <Tr>
      <Td className="font-medium">{driver.name}</Td>
      <Td className="text-muted-foreground">{driver.company?.name ?? '—'}</Td>
      <Td className="tabular text-muted-foreground">{driver.phone ?? '—'}</Td>
      <Td>{!driver.isActive && <Badge variant="secondary">{t('users.inactive')}</Badge>}</Td>
      <Td>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={toggle.isPending}
            onClick={() =>
              toggle.mutate(!driver.isActive, {
                onSuccess: onChanged,
                onError: (error) => toast.push('error', error.message),
              })
            }
          >
            {driver.isActive ? t('users.deactivate') : t('users.activate')}
          </Button>
        </div>
      </Td>
    </Tr>
  );
}

export function NewCompanyForm({ onDone }: { onDone: (company?: { id: string; name: string }) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const create = useApiMutation(
    (body: unknown) => api.post<{ id: string; name: string }>('/delivery/companies', body),
    ['/delivery'],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('delivery.newCompany')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              { name, contact: contact || undefined, phone: phone || undefined, email: email || undefined, address: address || undefined, notes: notes || undefined },
              {
                onSuccess: (company) => {
                  toast.push('success', t('delivery.companyCreated', { name: company.name }));
                  onDone(company);
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="dc-name">{t('delivery.company')}</Label>
            <Input id="dc-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dc-contact">{t('delivery.contact')}</Label>
            <Input id="dc-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dc-phone">{t('delivery.phone')}</Label>
            <Input id="dc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dc-email">{t('delivery.email')}</Label>
            <Input id="dc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dc-address">{t('delivery.address')}</Label>
            <Input id="dc-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="dc-notes">{t('delivery.notes')}</Label>
            <Input id="dc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <FormError error={create.error} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? t('common.creating') : t('delivery.create')}
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

export function NewDriverForm({
  companies,
  onDone,
}: {
  /** Only what the picker needs — a caller with less than the full row can pass it too. */
  companies: { id: string; name: string; isActive: boolean }[];
  onDone: (driver?: { id: string; name: string }) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [notes, setNotes] = useState('');

  const create = useApiMutation(
    (body: unknown) => api.post<{ id: string; name: string }>('/delivery/drivers', body),
    ['/delivery'],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('delivery.newDriver')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              {
                name,
                phone: phone || undefined,
                vehicle: vehicle || undefined,
                companyId: companyId || undefined,
                notes: notes || undefined,
              },
              {
                onSuccess: (driver) => {
                  toast.push('success', t('delivery.driverCreated', { name: driver.name }));
                  onDone(driver);
                },
                onError: (error) => toast.push('error', error.message),
              },
            );
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="dr-name">{t('delivery.driver')}</Label>
            <Input id="dr-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dr-phone">{t('delivery.phone')}</Label>
            <Input id="dr-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dr-vehicle">{t('delivery.vehicle')}</Label>
            <Input id="dr-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="dr-company">{t('delivery.company')}</Label>
            <Select id="dr-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">{t('delivery.ownerDriver')}</option>
              {companies
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="dr-notes">{t('delivery.notes')}</Label>
            <Input id="dr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <FormError error={create.error} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? t('common.creating') : t('delivery.create')}
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
