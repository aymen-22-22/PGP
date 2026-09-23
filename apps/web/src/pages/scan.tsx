import type { DeviceStatus } from '@phone-erp/shared-types';
import { CheckCircle2, ScanLine, Search, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '@/components/ui/badge';
import { BackButton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingState } from '@/components/ui/states';
import { CodeScanInput } from '@/features/scanner/code-scan-input';
import { scanFeedback } from '@/features/scanner/feedback';
import { classifyBarcode } from '@phone-erp/shared-types';
import { useT } from '@/i18n/provider';
import { api } from '@/lib/api';
import { formatImei, formatScanCode } from '@/lib/utils';
import type { CodeOutcome } from '@/features/scanner/use-code-buffer';

interface SearchHit {
  id: string;
  imei: string;
  status: string;
  product: { id: string; name: string; sku: string };
  currentWarehouse: { id: string; name: string } | null;
}

interface VerifyResponse {
  imei: string;
  accepted: boolean;
  code?: string;
  message?: string;
  device?: {
    id: string;
    /** Null on a phone received by label, which never had one. */
    imei: string | null;
    status: DeviceStatus;
    product: { id: string; name: string; sku: string };
    currentWarehouse: { id: string; name: string } | null;
  };
}

/**
 * The standalone lookup screen: scan any phone and see immediately what it is,
 * where it is, and whether it belongs here.
 */
export default function ScanPage() {
  const t = useT();
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<CodeOutcome | null>(null);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [matches, setMatches] = useState<SearchHit[] | null>(null);
  const [scanned, setScanned] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Looks up whatever was scanned.
   *
   * This screen deliberately accepts any symbol. A printed unit label or an
   * IMEI identifies the exact handset; anything else is searched as a serial
   * number, product or SKU — which is genuinely useful, and means the scanner
   * can always be tested with whatever barcode is to hand.
   */
  // The flash, chime and buzz follow what the lookup found, not merely that a
  // code was read — a green tick on an unknown code would be a lie.
  const report = (code: string, problem: string | null) => {
    setOutcome(problem ? { kind: 'stray', code, reason: problem } : { kind: 'accepted', code });
    scanFeedback(problem ? 'rejected' : 'accepted');
  };

  const lookup = async (value: string, raw?: string) => {
    const payload = (raw ?? value).trim();
    setOutcome(null);
    setBusy(true);
    setResult(null);
    setMatches(null);
    setScanned(payload);

    const classified = classifyBarcode(payload);
    try {
      // verify resolves an IMEI or one of our own unit labels; anything else
      // is worth searching for rather than refusing outright.
      if (classified.kind === 'IMEI' || classified.kind === 'LABEL') {
        const verified = await api.post<VerifyResponse>('/imeis/verify', { imei: payload.trim() });
        setResult(verified);
        report(value, verified.device ? null : (verified.message ?? t('scan.notFound')));
        return;
      }
      // Not an IMEI — look for it as a serial, product or SKU instead.
      const term = payload.replace(/[^A-Za-z0-9]/g, '').slice(0, 60);
      const found = await api.get<{ data: SearchHit[] }>(
        `/imeis/search?q=${encodeURIComponent(term)}&limit=20`,
      );
      setMatches(found.data);
      report(value, found.data.length ? null : t('scan.notFound'));
    } catch {
      report(value, t('state.error.unreachable'));
      setResult({
        imei: value,
        accepted: false,
        code: 'NETWORK_ERROR',
        message: t('state.error.unreachable'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <BackButton />
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ScanLine className="h-6 w-6" aria-hidden />
          {t('scan.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('scan.lead')}</p>
      </header>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          {/* Anything goes here: a printed unit label, an IMEI, a serial or
              a product barcode — by gun, by camera, or typed by hand. */}
          <CodeScanInput onScan={lookup} outcome={outcome} label={t('scan.anyBarcode')} />
        </CardContent>
      </Card>

      {busy && <LoadingState label={t('scan.lookingUp')} />}

      {scanned && !busy && (
        <Card>
          <CardContent className="p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('scan.codeRead')}</p>
            {/* Always shown, whatever it was — so it is obvious the scanner works. */}
            <p className="tabular break-all text-sm font-medium">{scanned}</p>
          </CardContent>
        </Card>
      )}

      {result && !busy && <LookupResult result={result} onOpen={() => navigate(`/imei/${result.imei}`)} />}

      {matches && !busy && (
        matches.length > 0 ? (
          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="text-sm font-semibold">{t('scan.matches', { count: matches.length })}</p>
              <ul className="divide-y rounded-md border">
                {matches.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/imei/${hit.imei}`)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-accent/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="tabular font-medium">{formatImei(hit.imei)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {hit.product.name}
                          {hit.currentWarehouse && ` · ${hit.currentWarehouse.name}`}
                        </p>
                      </div>
                      <StatusBadge status={hit.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="space-y-1 p-4">
              <p className="font-semibold">{t('scan.noMatch')}</p>
              <p className="text-sm text-muted-foreground">{t('scan.noMatch.body')}</p>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}

function LookupResult({ result, onOpen }: { result: VerifyResponse; onOpen: () => void }) {
  const t = useT();
  if (!result.device) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex items-start gap-3 p-4">
          <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="font-semibold">{t('scan.notFound')}</p>
            <p className="tabular text-sm text-muted-foreground">{formatScanCode(result.imei)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.message ?? t('scan.unknownImei')}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { device } = result;
  return (
    <Card className={result.accepted ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/5'}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          {result.accepted ? (
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden />
          ) : (
            <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-warning" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-snug">{device.product.name}</p>
            {/* A label-received phone has no IMEI — show the code that found it. */}
            <p className="tabular text-sm text-muted-foreground">
              {device.imei ? formatImei(device.imei) : formatScanCode(result.imei)}
            </p>
          </div>
          <StatusBadge status={device.status} />
        </div>

        {!result.accepted && result.message && (
          <p className="text-sm font-medium text-warning">{result.message}</p>
        )}

        <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.warehouse')}</dt>
            <dd className="font-medium">{device.currentWarehouse?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t('common.sku')}</dt>
            <dd className="tabular font-medium">{device.product.sku}</dd>
          </div>
        </dl>

        <Button variant="outline" className="w-full gap-2" onClick={onOpen}>
          <Search className="h-4 w-4" />
          {t('scan.fullHistory')}
        </Button>
      </CardContent>
    </Card>
  );
}
