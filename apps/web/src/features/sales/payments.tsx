import { Banknote, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { FormError } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useApiMutation } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';
export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'CHEQUE', 'OTHER'] as const;

export interface SalePayment {
  id: string;
  amount: string;
  method: string;
  paidAt: string;
  note: string | null;
  createdBy: { name: string } | null;
}

/** Paid green, partly paid amber, unpaid red — readable at a glance in a list. */
export function PaymentBadge({ status, className }: { status: PaymentStatus; className?: string }) {
  const { t } = useI18n();
  return (
    <Badge
      variant={status === 'PAID' ? 'success' : status === 'PARTIAL' ? 'warning' : 'destructive'}
      className={className}
    >
      {t(`payment.status.${status}`)}
    </Badge>
  );
}

/** What has been paid on a sale, what is still owed, and a way to record more. */
export function PaymentsCard({
  saleId,
  currency,
  total,
  paid,
  balance,
  status,
  payments,
  canEdit,
  cancelled,
  onChange,
}: {
  saleId: string;
  currency: string;
  total: string;
  paid: string;
  balance: string;
  status: PaymentStatus;
  payments: SalePayment[];
  canEdit: boolean;
  cancelled: boolean;
  onChange: () => void;
}) {
  const { t, money, dateTime } = useI18n();
  const toast = useToast();
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState<string>('CASH');
  const [note, setNote] = useState('');
  useEffect(() => setAmount(balance), [balance]);

  const record = useApiMutation(
    () => api.post(`/sales/${saleId}/payments`, { amount, method, ...(note ? { note } : {}) }),
    ['/sales'],
  );
  const remove = useApiMutation((paymentId: string) => api.delete(`/sales/${saleId}/payments/${paymentId}`), ['/sales']);
  const pct = Number(total) > 0 ? Math.min(100, (Number(paid) / Number(total)) * 100) : 100;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Banknote className="h-4 w-4 text-emerald-600" />
          {t('payment.title')}
        </CardTitle>
        <PaymentBadge status={status} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Figure label={t('common.total')} value={money(total, currency)} />
          <Figure label={t('payment.paid')} value={money(paid, currency)} tone="text-success" />
          <Figure
            label={t('payment.balance')}
            value={money(balance, currency)}
            tone={Number(balance) > 0 ? 'text-destructive' : undefined}
          />
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', status === 'PAID' ? 'bg-success' : 'bg-warning')}
            style={{ width: `${pct}%` }}
          />
        </div>

        {payments.length > 0 && (
          <ul className="divide-y rounded-md border">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {money(p.amount, currency)} · {t(`payment.method.${p.method}`)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dateTime(p.paidAt)}
                    {p.createdBy && ` · ${p.createdBy.name}`}
                    {p.note && ` · ${p.note}`}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('payment.remove')}
                    disabled={remove.isPending}
                    onClick={() =>
                      window.confirm(t('payment.removeConfirm')) &&
                      remove.mutate(p.id, {
                        onSuccess: () => {
                          toast.push('success', t('payment.removed'));
                          onChange();
                        },
                        onError: (error) => toast.push('error', error.message),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && !cancelled && Number(balance) > 0 && (
          <form
            className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-[1fr_1fr]"
            onSubmit={(e) => {
              e.preventDefault();
              record.mutate(undefined, {
                onSuccess: () => {
                  toast.push('success', t('payment.recorded'));
                  setNote('');
                  onChange();
                },
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">{t('payment.amount')}</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
                required
              />
              <div className="flex gap-2 text-xs">
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => setAmount(balance)}>
                  {t('payment.all')}
                </button>
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => setAmount((Number(balance) / 2).toFixed(2))}
                >
                  {t('payment.half')}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">{t('payment.methodLabel')}</Label>
              <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`payment.method.${m}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pay-note">{t('payment.note')}</Label>
              <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </div>
            <div className="sm:col-span-2">
              <FormError error={record.error} />
              <Button type="submit" className="w-full gap-2" disabled={record.isPending}>
                <Banknote className="h-4 w-4" />
                {t('payment.record')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border bg-card p-2">
      <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('tabular text-sm font-bold sm:text-base', tone)}>{value}</p>
    </div>
  );
}
