import { CheckCircle2, Mail, Send, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { ErrorState, FormError, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface MailServer {
  source: 'app' | 'env' | 'none';
  host: string;
  port: number;
  secure: boolean;
  user: string;
  hasPassword: boolean;
  from: string;
  enabled: boolean;
}

type Security = 'starttls' | 'ssl';

/** The mail server that sends notifications and alerts — set here, no SSH needed. */
export default function MailSettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const query = useApiQuery<MailServer>('/settings/mail');
  const [form, setForm] = useState({ host: '', port: '587', security: 'starttls' as Security, user: '', password: '', from: '', enabled: true });
  const [testTo, setTestTo] = useState(me?.email ?? '');

  useEffect(() => {
    if (!query.data) return;
    const d = query.data;
    setForm({
      host: d.host,
      port: String(d.port || 587),
      security: d.secure ? 'ssl' : 'starttls',
      user: d.user,
      password: '',
      from: d.from,
      enabled: d.source === 'none' ? true : d.enabled,
    });
  }, [query.data]);

  const save = useApiMutation(
    () =>
      api.put<MailServer>('/settings/mail', {
        host: form.host,
        port: Number(form.port),
        secure: form.security === 'ssl',
        user: form.user,
        ...(form.password ? { password: form.password } : {}),
        from: form.from,
        enabled: form.enabled,
      }),
    ['/settings/mail'],
  );
  const clear = useApiMutation(() => api.delete<MailServer>('/settings/mail'), ['/settings/mail']);
  const test = useApiMutation(() => api.post('/settings/mail/test', { to: testTo }), []);

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data!;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={t('mail.title')} description={t('mail.lead')} />

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4 text-primary" />
            {t('mail.server')}
          </CardTitle>
          <Badge variant={data.source === 'app' ? 'success' : data.source === 'env' ? 'secondary' : 'warning'}>
            {t(`mail.source.${data.source}`)}
          </Badge>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(undefined, {
                onSuccess: () => {
                  toast.push('success', t('mail.saved'));
                  set({ password: '' });
                },
                onError: (error) => toast.push('error', error.message),
              });
            }}
          >
            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.enabled}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              <span className="text-sm font-medium">{t('mail.enabled')}</span>
            </label>

            <Field id="m-host" label={t('mail.host')} hint={t('mail.hostHint')}>
              <Input id="m-host" value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="mail.example.com" required />
            </Field>
            <div className="grid grid-cols-[6rem_1fr] gap-3">
              <Field id="m-port" label={t('mail.port')}>
                <Input id="m-port" inputMode="numeric" value={form.port} onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} required />
              </Field>
              <Field id="m-sec" label={t('mail.security')}>
                <Select
                  id="m-sec"
                  value={form.security}
                  onChange={(e) => {
                    const security = e.target.value as Security;
                    set({ security, port: security === 'ssl' ? '465' : '587' });
                  }}
                >
                  <option value="starttls">STARTTLS (587)</option>
                  <option value="ssl">SSL/TLS (465)</option>
                </Select>
              </Field>
            </div>
            <Field id="m-user" label={t('mail.user')}>
              <Input id="m-user" autoComplete="off" value={form.user} onChange={(e) => set({ user: e.target.value })} placeholder="erp@example.com" />
            </Field>
            <Field id="m-pass" label={t('mail.password')} hint={data.hasPassword ? t('mail.passwordKept') : undefined}>
              <Input
                id="m-pass"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                placeholder={data.hasPassword ? '••••••••' : ''}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field id="m-from" label={t('mail.from')} hint={t('mail.fromHint')}>
                <Input id="m-from" value={form.from} onChange={(e) => set({ from: e.target.value })} placeholder="Phone ERP <erp@example.com>" required />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <FormError error={save.error} />
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? t('common.saving') : t('mail.save')}
              </Button>
              {data.source === 'app' && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={clear.isPending}
                  onClick={() =>
                    window.confirm(t('mail.useEnvConfirm')) &&
                    clear.mutate(undefined, { onSuccess: () => toast.push('success', t('mail.usingEnv')) })
                  }
                >
                  {t('mail.useEnv')}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-primary" />
            {t('mail.testTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('mail.testLead')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
            <Button
              className="gap-2"
              disabled={!testTo || test.isPending || data.source === 'none'}
              onClick={() =>
                test.mutate(undefined, {
                  onSuccess: () => toast.push('success', t('mail.testSent', { to: testTo })),
                })
              }
            >
              <Send className="h-4 w-4" />
              {test.isPending ? t('mail.testing') : t('mail.sendTest')}
            </Button>
          </div>
          {test.isSuccess && (
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4" />
              {t('mail.testOk')}
            </p>
          )}
          <FormError error={test.error} />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
