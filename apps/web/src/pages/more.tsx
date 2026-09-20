import { Building2, FileClock, KeyRound, LogOut, User, Warehouse } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { FormError } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LOCALES, type Locale } from '@/i18n/core';
import { useI18n, useT } from '@/i18n/provider';
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
          <div className="grid gap-2">
            {section.items.map(({ to, label, icon: Icon }) => (
              <Button key={to} asChild variant="outline" size="lg" className="justify-start gap-3">
                <Link to={to}>
                  <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  {t(label)}
                </Link>
              </Button>
            ))}
          </div>
        </section>
      ))}

      <LanguageChoice />

      <EmailNotifications />

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
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(LOCALES) as Locale[]).map((code) => (
          <button
            key={code}
            type="button"
            lang={code}
            dir={LOCALES[code].dir}
            aria-pressed={locale === code}
            onClick={() => setLocale(code)}
            className={`touch-target rounded-lg border-2 px-3 py-2.5 text-base font-semibold transition-colors ${
              locale === code
                ? 'border-primary bg-primary/5 text-foreground'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40'
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
