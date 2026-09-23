import { ArrowLeft, CheckCircle2, PackageCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CodeScanInput } from '@/features/scanner/code-scan-input';
import { scanFeedback } from '@/features/scanner/feedback';
import type { CodeOutcome } from '@/features/scanner/use-code-buffer';
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
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [outcome, setOutcome] = useState<CodeOutcome | null>(null);

  const scan = useApiMutation<ScanResult, { code: string }>(
    (body) => api.post(`/purchases/${id}/receive-by-label`, body),
    ['/purchases'],
  );

  const submit = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed || scan.isPending) return;
    scan.mutate(
      { code: trimmed },
      {
        onSuccess: (result) => {
          setOutcome({ kind: 'accepted', code: result.code });
          scanFeedback('accepted');
          setHistory((current) => [
            { key: Date.now(), code: result.code, productName: result.product.name, at: new Date() },
            ...current,
          ]);
        },
        onError: (error) => {
          const reason = error instanceof ApiRequestError ? error.message : t('receiveScan.error');
          setOutcome({ kind: 'stray', code: trimmed, reason });
          scanFeedback('rejected');
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
        {remaining === 0 ? (
          <Feedback ok title={t('receiveScan.complete')} />
        ) : (
          <CodeScanInput
            label={t('receiveScan.input')}
            onScan={submit}
            outcome={outcome}
            disabled={scan.isPending}
          />
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
