import { ArrowLeft, CheckCircle2, PackageCheck, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { ApiRequestError, api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface PurchaseSummary {
  id: string;
  number: string;
  warehouse: { name: string };
  items: { quantity: number; receivedQuantity: number }[];
}

interface ScanResult {
  code: string;
  product: { name: string; sku: string; color: string | null; storage: string | null };
  purchase: { number: string };
  warehouse: { name: string };
  expected: number;
  received: number;
  remaining: number;
}

interface HistoryEntry {
  key: number;
  code: string;
  productName: string;
  at: Date;
}

/**
 * Goods-in: scan the label printed at PO time, one phone at a time.
 *
 * No IMEI field on this screen on purpose — the label already proves the
 * product and the purchase order, which is the whole reason it went on the
 * box before the phone did. A dedicated input rather than the IMEI scanner
 * widgets: a label code carries letters and dashes that IMEI extraction would
 * mangle trying to read it as a phone number.
 */
export default function PurchaseReceiveScanPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const query = useApiQuery<PurchaseSummary>(`/purchases/${id}`);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);

  const scan = useApiMutation<ScanResult, { code: string }>(
    (body) => api.post(`/purchases/${id}/receive-by-label`, body),
    ['/purchases'],
  );

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    const interval = setInterval(() => {
      if (document.activeElement !== inputRef.current) focus();
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  const submit = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed || scan.isPending) return;
    setValue('');
    scan.mutate(
      { code: trimmed },
      {
        onSuccess: (result) => {
          setLastError(null);
          setHistory((current) => [
            { key: Date.now(), code: result.code, productName: result.product.name, at: new Date() },
            ...current,
          ]);
          setFlashKey((k) => k + 1);
          inputRef.current?.focus();
        },
        onError: (error) => {
          setLastError(error instanceof ApiRequestError ? error.message : t('receiveScan.error'));
          setFlashKey((k) => k + 1);
          inputRef.current?.focus();
        },
      },
    );
  };

  if (query.isLoading) return <LoadingState label={t('receiveScan.loading')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const purchase = query.data!;
  const expected = purchase.items.reduce((sum, i) => sum + i.quantity, 0);
  const received = purchase.items.reduce((sum, i) => sum + i.receivedQuantity, 0);
  const remaining = Math.max(0, expected - received);
  const lastSuccess = scan.isSuccess && !lastError ? scan.data : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ms-2 gap-1">
        <Link to={`/purchases/${id}`}>
          <ArrowLeft className="h-4 w-4" />
          {purchase.number}
        </Link>
      </Button>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label={t('receiveScan.expected')} value={expected} />
        <Stat label={t('receiveScan.received')} value={received} className="text-success" />
        <Stat label={t('receiveScan.remaining')} value={remaining} className={remaining === 0 ? 'text-success' : ''} />
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <label htmlFor="label-scan-input" className="text-sm font-semibold">
          {t('receiveScan.input')}
        </label>
        <div className="flex gap-2">
          <Input
            id="label-scan-input"
            ref={inputRef}
            value={value}
            disabled={remaining === 0}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder="UL-2026-000123"
            className="tabular h-16 text-center text-xl font-bold tracking-wider"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit(value);
              }
            }}
          />
          <Button size="lg" className="h-16 px-6" disabled={!value.trim() || scan.isPending} onClick={() => submit(value)}>
            {t('receiveScan.add')}
          </Button>
        </div>

        {remaining === 0 ? (
          <Feedback key={flashKey} ok title={t('receiveScan.complete')} />
        ) : lastError ? (
          <Feedback key={flashKey} title={lastError} />
        ) : lastSuccess ? (
          <Feedback
            key={flashKey}
            ok
            title={lastSuccess.product.name}
            detail={[lastSuccess.product.color, lastSuccess.product.storage].filter(Boolean).join(' · ')}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('receiveScan.ready')}</p>
        )}
      </div>

      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">
            {t('receiveScan.history')} ({history.length})
          </p>
          <ul className="space-y-1">
            {history.map((entry) => (
              <li
                key={entry.key}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-success" />
                  {entry.productName}
                </span>
                <span className="tabular text-xs text-muted-foreground">{entry.code}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className={cn('tabular text-2xl font-bold', className)}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Feedback({ ok, title, detail }: { ok?: boolean; title: string; detail?: string }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn(
        'flex items-center gap-2 rounded-md border p-3',
        ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        {detail && <p className="truncate text-xs">{detail}</p>}
      </div>
    </div>
  );
}
