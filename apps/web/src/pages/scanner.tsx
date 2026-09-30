import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  ImageIcon,
  Inbox,
  PackageCheck,
  Printer,
  ScanLine,
  SendHorizontal,
  Truck,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { CodeScanInput } from '@/features/scanner/code-scan-input';
import { scanFeedback } from '@/features/scanner/feedback';
import type { CodeOutcome } from '@/features/scanner/use-code-buffer';
import { useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface ProductCard {
  id: string;
  name: string;
  imageUrl: string | null;
}

interface Incoming {
  total: number;
  items: { product: ProductCard; toReceive: number; purchaseIds: string[] }[];
}

type Outcome =
  | { status: 'INCOMING'; code: string; product: ProductCard; remaining: number }
  | {
      status: 'AVAILABLE';
      code: string;
      product: ProductCard;
      warehouse: string;
      destinations: { id: string; name: string; code: string }[];
    }
  | {
      status: 'ALREADY_RECEIVED' | 'PENDING_CHECK' | 'IN_TRANSIT' | 'SOLD' | 'UNAVAILABLE' | 'OTHER_WAREHOUSE';
      code: string;
      product: ProductCard;
      where: string | null;
    }
  | { status: 'NOT_FOUND'; code: string };

interface SendLine {
  code: string;
  product: ProductCard;
}

const WAREHOUSE_KEY = 'perp_scanner_wh';

/**
 * The warehouse floor on one screen: what is coming, a scanner, and the one
 * action each scan calls for. Nobody here needs to know whether a phone came
 * on a purchase order or a transfer — they scan, the system says what it is,
 * they confirm.
 */
export default function ScannerPage() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const admin = isAdmin(user);

  const [warehouseId, setWarehouseId] = useState(() => {
    try {
      return localStorage.getItem(WAREHOUSE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const warehouses = useApiQuery<{ id: string; name: string }[]>('/warehouses', { enabled: admin });
  const wh = admin ? warehouseId : '';
  const ready = !admin || !!warehouseId;
  const scope = admin && warehouseId ? { warehouseId } : {};

  const incoming = useApiQuery<Incoming>(`/ops/incoming${wh ? `?warehouseId=${wh}` : ''}`, { enabled: ready });

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [scanState, setScanState] = useState<CodeOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoReceive, setAutoReceive] = useState(false);
  const [sendLines, setSendLines] = useState<SendLine[]>([]);
  const [destinations, setDestinations] = useState<{ id: string; name: string }[]>([]);
  const [destinationId, setDestinationId] = useState('');
  const scannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (destinations.length === 1) setDestinationId(destinations[0]!.id);
  }, [destinations]);

  const receive = async (code: string) => {
    setBusy(true);
    try {
      const r = await api.post<{ remaining: number; product: ProductCard }>('/ops/receive', { code, ...scope });
      scanFeedback('accepted');
      toast.push('success', t('ops.received', { name: r.product.name, count: r.remaining }));
      setOutcome(null);
      void incoming.refetch();
    } catch (error) {
      scanFeedback('rejected');
      toast.push('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onScan = async (raw: string) => {
    const code = raw.trim();
    if (!code || busy) return;
    if (sendLines.some((l) => l.code.toUpperCase() === code.toUpperCase())) {
      setScanState({ kind: 'duplicate', code });
      scanFeedback('duplicate');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<Outcome>('/ops/scan', { code, ...scope });
      setOutcome(result);
      const good = result.status === 'INCOMING' || result.status === 'AVAILABLE';
      setScanState(good ? { kind: 'accepted', code } : { kind: 'stray', code, reason: t(`ops.status.${result.status}`) });
      scanFeedback(good ? 'accepted' : 'rejected');

      if (result.status === 'AVAILABLE') {
        setSendLines((lines) => [{ code: result.code, product: result.product }, ...lines]);
        setDestinations(result.destinations);
      }
      if (result.status === 'INCOMING' && autoReceive) {
        setBusy(false);
        await receive(result.code);
        return;
      }
    } catch (error) {
      toast.push('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!destinationId || sendLines.length === 0) return;
    setBusy(true);
    try {
      const r = await api.post<{ number: string; count: number }>('/ops/send', {
        codes: sendLines.map((l) => l.code),
        destinationWarehouseId: destinationId,
        ...scope,
      });
      toast.push('success', t('ops.sent', { count: r.count, to: destinations.find((d) => d.id === destinationId)?.name ?? '' }));
      setSendLines([]);
      setOutcome(null);
    } catch (error) {
      toast.push('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const printCodes = async (item: Incoming['items'][number]) => {
    const purchaseId = item.purchaseIds[0];
    if (!purchaseId) return;
    try {
      // Creates the codes if they do not exist yet; pressing twice is harmless.
      await api.post(`/purchases/${purchaseId}/labels`, {});
      navigate(`/purchases/${purchaseId}/labels?product=${item.product.id}&back=/scanner`);
    } catch (error) {
      toast.push('error', (error as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <ScanLine className="h-6 w-6 text-primary" />
        {t('ops.title')}
      </h1>

      {admin && (
        <div className="space-y-1.5">
          <Label htmlFor="ops-wh">{t('common.warehouse')}</Label>
          <Select
            id="ops-wh"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setSendLines([]);
              setOutcome(null);
              try {
                localStorage.setItem(WAREHOUSE_KEY, e.target.value);
              } catch {
                /* remembered for this visit only */
              }
            }}
          >
            <option value="">{t('common.choose')}</option>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {ready && (
        <>
          <div ref={scannerRef} className="space-y-3 rounded-xl border bg-card p-4">
            <CodeScanInput outcome={scanState} onScan={(code) => void onScan(code)} />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={autoReceive}
                onChange={(e) => setAutoReceive(e.target.checked)}
              />
              {t('ops.autoReceive')}
            </label>
          </div>

          {outcome && (
            <ResultCard outcome={outcome} busy={busy} onReceive={(c) => void receive(c)} onClose={() => setOutcome(null)} />
          )}

          {sendLines.length > 0 && (
            <section className="space-y-3 rounded-xl border-2 border-orange-300 bg-orange-50/60 p-4 dark:bg-orange-950/20">
              <h2 className="flex items-center gap-2 font-semibold text-orange-800 dark:text-orange-300">
                <Truck className="h-5 w-5" />
                {t('ops.toSend', { count: sendLines.length })}
              </h2>
              <ul className="divide-y rounded-lg border bg-card">
                {sendLines.map((l) => (
                  <li key={l.code} className="flex items-center gap-3 px-3 py-2">
                    <Thumb product={l.product} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.product.name}</p>
                      <p className="tabular truncate text-xs text-muted-foreground">{l.code}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('common.remove')}
                      onClick={() => setSendLines((lines) => lines.filter((x) => x.code !== l.code))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="space-y-1.5">
                <Label htmlFor="ops-dest">{t('ops.destination')}</Label>
                <Select id="ops-dest" value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
                  {destinations.length !== 1 && <option value="">{t('common.choose')}</option>}
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                size="lg"
                className="w-full gap-2 bg-orange-600 hover:bg-orange-700"
                disabled={!destinationId || busy}
                onClick={() => void send()}
              >
                <SendHorizontal className="h-5 w-5" />
                {t('ops.send', { count: sendLines.length })}
              </Button>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Inbox className="h-5 w-5 text-blue-600" />
              {t('ops.incoming')}
              {incoming.data && incoming.data.total > 0 && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-sm text-blue-800">{incoming.data.total}</span>
              )}
            </h2>
            {incoming.isLoading && <LoadingState />}
            {incoming.isError && <ErrorState error={incoming.error} onRetry={() => void incoming.refetch()} />}
            {incoming.data && incoming.data.items.length === 0 && (
              <p className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <CheckCircle2 className="h-5 w-5 text-success" />
                {t('ops.nothingIncoming')}
              </p>
            )}
            <ul className="space-y-2">
              {incoming.data?.items.map((item) => (
                <li key={item.product.id} className="space-y-3 rounded-xl border bg-card p-3">
                  <div className="flex items-center gap-3">
                    <Thumb product={item.product} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-tight">{item.product.name}</p>
                      <p className="text-sm font-medium text-blue-700">{t('ops.toReceive', { count: item.toReceive })}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={() => scannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    >
                      <ScanLine className="h-4 w-4" />
                      {t('ops.scan')}
                    </Button>
                    {item.purchaseIds.length > 0 && (
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => void printCodes(item)}>
                        <Printer className="h-4 w-4" />
                        {t('ops.printCodes')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Thumb({ product, size = 'md' }: { product: ProductCard; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'sm' ? 'h-10 w-10' : size === 'lg' ? 'h-24 w-24' : 'h-14 w-14';
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted', box)}>
      {product.imageUrl ? (
        <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <ImageIcon className="h-5 w-5 text-muted-foreground" />
      )}
    </span>
  );
}

/** The answer to a scan: what it is, and the one button that matters. */
function ResultCard({
  outcome,
  busy,
  onReceive,
  onClose,
}: {
  outcome: Outcome;
  busy: boolean;
  onReceive: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tone =
    outcome.status === 'INCOMING'
      ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30'
      : outcome.status === 'AVAILABLE'
        ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/30'
        : outcome.status === 'NOT_FOUND'
          ? 'border-destructive/50 bg-destructive/5'
          : 'border-amber-400 bg-amber-50 dark:bg-amber-950/30';
  const Icon =
    outcome.status === 'INCOMING'
      ? PackageCheck
      : outcome.status === 'AVAILABLE'
        ? Truck
        : outcome.status === 'NOT_FOUND'
          ? HelpCircle
          : AlertTriangle;

  return (
    <section className={cn('relative rounded-2xl border-2 p-4', tone)} aria-live="polite">
      <button
        type="button"
        onClick={onClose}
        className="absolute end-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-black/5"
        aria-label={t('common.close')}
      >
        <X className="h-5 w-5" />
      </button>
      <div className="flex items-center gap-4">
        {'product' in outcome ? <Thumb product={outcome.product} size="lg" /> : <Icon className="h-12 w-12 text-destructive" />}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide">
            <Icon className="h-4 w-4" />
            {t(`ops.status.${outcome.status}`)}
          </p>
          {'product' in outcome && <p className="text-xl font-bold leading-tight">{outcome.product.name}</p>}
          <p className="tabular truncate text-xs text-muted-foreground">{outcome.code}</p>
          {outcome.status === 'INCOMING' && (
            <p className="mt-1 text-sm font-medium text-blue-800">{t('ops.toReceive', { count: outcome.remaining })}</p>
          )}
          {outcome.status === 'AVAILABLE' && (
            <p className="mt-1 text-sm">{t('ops.availableIn', { warehouse: outcome.warehouse })}</p>
          )}
          {'where' in outcome && outcome.where && <p className="mt-1 text-sm">{outcome.where}</p>}
        </div>
      </div>
      {outcome.status === 'INCOMING' && (
        <Button size="xl" className="mt-4 w-full gap-2 bg-blue-600 hover:bg-blue-700" disabled={busy} onClick={() => onReceive(outcome.code)}>
          <PackageCheck className="h-6 w-6" />
          {t('ops.receive')}
        </Button>
      )}
      {outcome.status === 'AVAILABLE' && (
        <p className="mt-3 text-sm font-medium text-orange-800">{t('ops.addedToSend')}</p>
      )}
    </section>
  );
}
