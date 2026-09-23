import { Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';

interface Company {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
  footer: string;
}

const EMPTY: Company = { name: '', address: '', phone: '', email: '', taxId: '', footer: '' };

/** The business details printed at the top and bottom of every invoice. */
export default function CompanySettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const query = useApiQuery<Company>('/settings/company');
  const [form, setForm] = useState<Company>(EMPTY);
  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);
  const save = useApiMutation(() => api.put<Company>('/settings/company', form), ['/settings/company']);

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const set = (patch: Partial<Company>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={t('company.title')} description={t('company.lead')} />
      <Card>
        <CardContent className="p-4 sm:p-5">
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(undefined, { onSuccess: () => toast.push('success', t('company.saved')) });
            }}
          >
            <Field id="c-name" label={t('company.name')} className="sm:col-span-2">
              <Input id="c-name" value={form.name} onChange={(e) => set({ name: e.target.value })} required />
            </Field>
            <Field id="c-address" label={t('company.address')} className="sm:col-span-2">
              <textarea
                id="c-address"
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.address}
                onChange={(e) => set({ address: e.target.value })}
              />
            </Field>
            <Field id="c-phone" label={t('company.phone')}>
              <Input id="c-phone" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
            <Field id="c-email" label={t('company.email')}>
              <Input id="c-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field id="c-tax" label={t('company.taxId')} className="sm:col-span-2">
              <Input id="c-tax" value={form.taxId} onChange={(e) => set({ taxId: e.target.value })} />
            </Field>
            <Field id="c-footer" label={t('company.footer')} hint={t('company.footerHint')} className="sm:col-span-2">
              <textarea
                id="c-footer"
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.footer}
                onChange={(e) => set({ footer: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <FormError error={save.error} />
              <Button type="submit" className="gap-2" disabled={save.isPending}>
                <Store className="h-4 w-4" />
                {save.isPending ? t('common.saving') : t('company.save')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
