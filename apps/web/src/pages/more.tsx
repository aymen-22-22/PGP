import { Building2, ChevronRight, FileClock, KeyRound, LogOut, Printer, User, Warehouse } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { FormError } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LABEL_SIZES } from '@/lib/label-sizes';
import { LOCALES, type Locale } from '@/i18n/core';
import { useI18n, useT } from '@/i18n/provider';
import { AREAS, areaOfSection } from '@/lib/areas';
import { bottomTabsFor, navigationExcluding } from '@/lib/navigation';

/** Reachable from the header on every screen. */
const HEADER_LINKS = ['/', '/more'];

export default function MorePage() {
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const navigate = useNavigate();

  // Everything the user may open, minus whatever already has its own button in
  // the header or the bottom bar — listing those twice only adds noise.
  const t = useT();
  const sections = navigationExcluding(user, [...HEADER_LINKS, ...bottomTabsFor(user)]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('more.title')}</h1>
      </header>

      <Card>
        <CardContent className="space-y-1 p-4">
          <Row icon={User} label={t('more.signedInAs')} value={user?.name ?? '—'} />
          <Row icon={Building2} label={t('more.email')} value={user?.email ?? '—'} />
          <Row icon={Warehouse} label={t('more.warehouse')} value={user?.warehouseName ?? t('more.allWarehouses')} />
          <Row icon={FileClock} label={t('more.costCentre')} value={user?.costCenterName ?? '—'} />
          <Row icon={KeyRound} label={t('more.role')} value={user?.role === 'ADMIN' ? t('more.role.admin') : t('more.role.user')} />
        </CardContent>
      </Card>

      {sections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(section.title)}
          </h2>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {section.items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  className="flex touch-target items-center gap-3 px-4 text-[0.95rem] font-medium transition-colors active:bg-accent hover:bg-accent/50"
                >
                  <Icon className={`h-5 w-5 shrink-0 ${AREAS[areaOfSection(section.title)].text}`} aria-hidden />
                  <span className="flex-1">{t(label)}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground rtl:rotate-180" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <LanguageChoice />

      <EmailNotifications />

      <PrinterSettings />

      <ChangePassword />

      <Button
        variant="destructive"
        size="lg"
        className="w-full gap-2"
        onClick={async () => {
          await signOut();
          navigate('/login');
        }}
      >
        <LogOut className="h-5 w-5" />
        {t('nav.signOut')}
      </Button>
    </div>
  );
}

function ChangePassword() {
  const t = useT();
  const toast = useToast();
  const signOut = useAuth((s) => s.signOut);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button variant="outline" size="lg" className="w-full justify-start gap-2" onClick={() => setOpen(true)}>
        <KeyRound className="h-5 w-5" />
        {t('more.changePassword')}
      </Button>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      toast.push('success', 'Password changed. Please sign in again.');
      await signOut();
      navigate('/login');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Change password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="current">{t('more.currentPassword')}</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="next">{t('more.newPassword')}</Label>
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">{t('more.passwordHelp')}</p>
          </div>
          <FormError error={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || current.length === 0 || next.length < 10}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b py-2.5 last:border-0">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="ms-auto truncate text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * The switch the emails themselves promise in their footer.
 *
 * Self-service on purpose: turning off your own mail should not require the
 * permission to edit everyone's account.
 */
function EmailNotifications() {
  const t = useT();
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [busy, setBusy] = useState(false);

  const on = user?.notifyByEmail ?? true;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      await api.patch('/auth/preferences', { notifyByEmail: next });
      if (user) setUser({ ...user, notifyByEmail: next });
      toast.push('success', t(next ? 'more.notify.on' : 'more.notify.off'));
    } catch (error) {
      toast.push('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="flex touch-target items-start gap-3 rounded-md border p-3">
      <input
        type="checkbox"
        checked={on}
        disabled={busy}
        onChange={(e) => void toggle(e.target.checked)}
        className="mt-0.5 h-5 w-5 accent-[hsl(var(--primary))]"
      />
      <span className="text-sm">
        <b>{t('more.notify.label')}</b> {t('more.notify.help')}
      </span>
    </label>
  );
}

/**
 * How this person's own browser gets a unit label to a thermal printer.
 *
 * Per-user on purpose: two people sharing a warehouse account might sit at
 * different benches with different printers, and someone's printer address
 * is not everyone's business.
 */
function PrinterSettings() {
  const t = useT();
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [connectionType, setConnectionType] = useState(user?.printerConnectionType ?? 'BROWSER');
  const [address, setAddress] = useState(user?.printerAddress ?? '');
  const [labelSize, setLabelSize] = useState(user?.printerLabelSize ?? '58x40');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const needsAddress = connectionType !== 'BROWSER';
  const dirty =
    connectionType !== (user?.printerConnectionType ?? 'BROWSER') ||
    address !== (user?.printerAddress ?? '') ||
    labelSize !== (user?.printerLabelSize ?? '58x40');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<{
        printerConnectionType: typeof connectionType;
        printerAddress: string | null;
        printerLabelSize: string;
      }>('/auth/preferences', {
        printerConnectionType: connectionType,
        printerAddress: needsAddress ? address.trim() : '',
        printerLabelSize: labelSize,
      });
      if (user) setUser({ ...user, ...updated });
      toast.push('success', t('more.printer.saved'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Printer className="h-4 w-4" aria-hidden />
          {t('more.printer.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('more.printer.lead')}</p>

          <div className="grid gap-2">
            {(
              [
                { value: 'BROWSER', label: t('more.printer.browser'), help: t('more.printer.browserHelp') },
                { value: 'NETWORK', label: t('more.printer.network'), help: t('more.printer.networkHelp') },
                { value: 'AGENT', label: t('more.printer.agent'), help: t('more.printer.agentHelp') },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className="flex touch-target items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary"
              >
                <input
                  type="radio"
                  name="printer-connection"
                  value={option.value}
                  checked={connectionType === option.value}
                  onChange={() => setConnectionType(option.value)}
                  className="mt-0.5 h-5 w-5 accent-[hsl(var(--primary))]"
                />
                <span className="text-sm">
                  <b>{option.label}</b> {option.help}
                </span>
              </label>
            ))}
          </div>

          {needsAddress && (
            <div className="space-y-1.5">
              <Label htmlFor="printer-address">
                {connectionType === 'NETWORK' ? t('more.printer.addressNetwork') : t('more.printer.addressAgent')}
              </Label>
              <Input
                id="printer-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={connectionType === 'NETWORK' ? '192.168.1.50:9100' : 'http://localhost:8080/print'}
                required
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="printer-label-size">{t('labels.size')}</Label>
            <Select id="printer-label-size" value={labelSize} onChange={(e) => setLabelSize(e.target.value)}>
              {LABEL_SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.width}×{s.height} mm
                </option>
              ))}
            </Select>
          </div>

          <FormError error={error} />
          <Button type="submit" disabled={busy || !dirty || (needsAddress && !address.trim())}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Choosing a language.
 *
 * Each option is written in its own language — someone looking for Arabic is
 * looking for العربية, not for the word "Arabic" spelled out in English.
 */
function LanguageChoice() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('more.language')}
      </h2>
      <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted p-1">
        {(Object.keys(LOCALES) as Locale[]).map((code) => (
          <button
            key={code}
            type="button"
            lang={code}
            dir={LOCALES[code].dir}
            aria-pressed={locale === code}
            onClick={() => setLocale(code)}
            className={`h-10 rounded-md px-2 text-sm font-semibold transition-colors ${
              locale === code
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {LOCALES[code].label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('more.languageHelp')}</p>
    </div>
  );
}
