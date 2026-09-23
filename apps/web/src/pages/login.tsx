import { useState } from 'react';
import { useT } from '@/i18n/provider';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { FormError } from '@/components/ui/states';
import { useAuth } from '@/lib/auth';

export function LoginPage() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const signIn = useAuth((s) => s.signIn);
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim().toLowerCase(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-sidebar px-4 py-10">
      <div className="flex items-center gap-3 text-sidebar-foreground">
        <span className="flex h-10 w-10 items-center justify-center rounded bg-sidebar-accent font-bold" aria-hidden>
          PE
        </span>
        <span className="text-xl font-semibold tracking-tight">Phone ERP</span>
      </div>
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-xl">{t('login.submit')}</CardTitle>
          <CardDescription>{t('login.lead')}</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('login.email')}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">{t('login.password')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <FormError error={error} />

            <Button type="submit" size="lg" className="w-full" disabled={busy || !email || !password}>
              {busy ? t('login.signingIn') : t('login.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
