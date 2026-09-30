import { Camera, Check, HelpCircle, ImageIcon, Printer, RotateCcw, SendHorizontal, Truck, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { CameraScanner } from '@/features/scanner/camera-scanner';
import { CodeScanInput } from '@/features/scanner/code-scan-input';
import { scanFeedback } from '@/features/scanner/feedback';
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

/** What the big full-screen answer says after a scan. */
interface Flash {
  tone: 'received' | 'send' | 'duplicate' | 'problem';
  title: string;
  product?: ProductCard;
  detail?: string;
  /** Offered for a few seconds: puts back what the scan just did. */
  undo?: () => void;
  code?: string;
}

interface SendLine {
  code: string;
  product: ProductCard;
}

const WAREHOUSE_KEY = 'perp_scanner_wh';
const destinationKey = (sourceId: string) => `perp_scanner_dest:${sourceId}`;

const read = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* remembered for this visit only */
  }
};

/**
 * The warehouse app. Scan: an incoming product is received on the spot, a
 * product on the shelf joins the shipment, anything else says why not — each
 * with a big coloured answer you can read from a metre away.
 */
export default function ScannerPage() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const admin = isAdmin(user);

  const [warehouseId, setWarehouseId] = useState(() => read(WAREHOUSE_KEY));
  const warehouses = useApiQuery<{ id: string; name: string }[]>('/warehouses', { enabled: admin });
  const sourceId = admin ? warehouseId : (user?.warehouseId ?? '');
  const ready = !!sourceId;
  const scope = admin && warehouseId ? { warehouseId } : {};

  const incoming = useApiQuery<Incoming>(`/ops/incoming${admin && warehouseId ? `?warehouseId=${warehouseId}` : ''}`, {
    enabled: ready,
  });

  const [flash, setFlash] = useState<Flash | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  // The camera keeps reading behind the answer: the same code again is the
  // same box still in view, not a second scan.
  const flashRef = useRef<Flash | null>(null);
  flashRef.current = flash;
  const [busy, setBusy] = useState(false);
  const [sendLines, setSendLines] = useState<SendLine[]>([]);
  const [destinations, setDestinations] = useState<{ id: string; name: string }[]>([]);
  const [destinationId, setDestinationId] = useState('');

  // The last destination used from here comes back by itself; a single
  // possible destination is simply chosen.
  useEffect(() => {
    if (destinations.length === 0) return;
    const remembered = read(destinationKey(sourceId));
    if (destinations.some((d) => d.id === remembered)) setDestinationId(remembered);
    else if (destinations.length === 1) setDestinationId(destinations[0]!.id);
  }, [destinations, sourceId]);

  // The big answer fades by itself so the next scan can follow straight away.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), flash.undo ? 5000 : 1800);
    return () => clearTimeout(timer);
  }, [flash]);

  const onScan = async (raw: string) => {
    const code = raw.trim();
    if (!code || busy || flashRef.current?.code?.toUpperCase() === code.toUpperCase()) return;
    const already = sendLines.find((l) => l.code.toUpperCase() === code.toUpperCase());
    if (already) {
      // Scanning it again takes it back off the shipment.
      scanFeedback('duplicate');
      setSendLines((lines) => lines.filter((l) => l !== already));
      setFlash({ tone: 'duplicate', title: t('ops.flash.removed'), product: already.product, code });
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<Outcome>('/ops/scan', { code, ...scope });

      if (result.status === 'INCOMING') {
        // Received on the spot: no button to press.
        const done = await api.post<{ remaining: number; product: ProductCard; undoable: boolean }>('/ops/receive', {
          code: result.code,
          ...scope,
        });
        scanFeedback('accepted');
        setFlash({
          tone: 'received',
          code: result.code,
          title: t('ops.flash.received'),
          product: done.product,
          detail: t('ops.left', { count: done.remaining }),
          undo: done.undoable
            ? () =>
                void api
                  .post('/ops/undo-receive', { code: result.code })
                  .then(() => void incoming.refetch())
                  .catch((error: Error) => toast.push('error', error.message))
            : undefined,
        });
        void incoming.refetch();
      } else if (result.status === 'AVAILABLE') {
        scanFeedback('accepted');
        setSendLines((lines) => [{ code: result.code, product: result.product }, ...lines]);
        setDestinations(result.destinations);
        setFlash({
          tone: 'send',
          code: result.code,
          title: t('ops.flash.send'),
          product: result.product,
          undo: () => setSendLines((lines) => lines.filter((l) => l.code !== result.code)),
        });
      } else {
        scanFeedback('rejected');
        setFlash({
          tone: 'problem',
          title: t(`ops.status.${result.status}`),
          product: 'product' in result ? result.product : undefined,
          detail: 'where' in result && result.where ? result.where : code,
        });
      }
    } catch (error) {
      scanFeedback('rejected');
      setFlash({ tone: 'problem', title: t('ops.flash.error'), detail: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onDetect = useCallback((code: string) => void onScanRef.current(code), []);

  const send = async () => {
    if (!destinationId || sendLines.length === 0) return;
    setBusy(true);
    try {
      const r = await api.post<{ count: number }>('/ops/send', {
        codes: sendLines.map((l) => l.code),
        destinationWarehouseId: destinationId,
        ...scope,
      });
      write(destinationKey(sourceId), destinationId);
      toast.push('success', t('ops.sent', { count: r.count, to: destinations.find((d) => d.id === destinationId)?.name ?? '' }));
      setSendLines([]);
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
      {admin && (
        <div className="space-y-1.5">
          <Label htmlFor="ops-wh">{t('common.warehouse')}</Label>
          <Select
            id="ops-wh"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setSendLines([]);
              write(WAREHOUSE_KEY, e.target.value);
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
          <CodeScanInput
            compact
            camera={false}
            outcome={null}
            disabled={busy}
            onScan={(code) => void onScan(code)}
            leading={
              <Button
                size="icon"
                variant={cameraOn ? 'secondary' : 'default'}
                className="h-12 w-12 shrink-0"
                aria-label={cameraOn ? t('camera.stop') : t('camera.start')}
                aria-pressed={cameraOn}
                onClick={() => setCameraOn((on) => !on)}
              >
                {cameraOn ? <X className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
              </Button>
            }
          />
          {cameraOn && <CameraScanner active hideToggle onActiveChange={setCameraOn} onDetect={onDetect} />}

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
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{l.product.name}</p>
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
              {destinations.length === 1 ? (
                <p className="text-sm">
                  → <span className="font-semibold">{destinations[0]!.name}</span>
                </p>
              ) : (
                <Select
                  aria-label={t('ops.destination')}
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value)}
                >
                  <option value="">{t('ops.destination')}</option>
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
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
            <h2 className="text-lg font-semibold">{t('ops.incoming')}</h2>
            {incoming.isLoading && <LoadingState />}
            {incoming.isError && <ErrorState error={incoming.error} onRetry={() => void incoming.refetch()} />}
            {incoming.data && incoming.data.items.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                {t('ops.nothingIncoming')}
              </p>
            )}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {incoming.data?.items.map((item) => (
                <li key={item.product.id} className="relative overflow-hidden rounded-2xl border bg-card">
                  <span className="flex aspect-square items-center justify-center bg-muted">
                    {item.product.imageUrl ? (
                      <img src={item.product.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-10 w-10 text-muted-foreground" />
                    )}
                  </span>
                  <span className="absolute start-2 top-2 flex h-10 min-w-10 items-center justify-center rounded-full bg-blue-600 px-2 text-xl font-black text-white shadow">
                    {item.toReceive}
                  </span>
                  <p className="truncate px-2 pt-1.5 text-xs text-muted-foreground" title={item.product.name}>
                    {item.product.name}
                  </p>
                  {item.purchaseIds.length > 0 ? (
                    <Button
                      variant="outline"
                      className="m-2 mt-1 h-11 w-[calc(100%-1rem)]"
                      aria-label={t('ops.printCodes')}
                      title={t('ops.printCodes')}
                      onClick={() => void printCodes(item)}
                    >
                      <Printer className="h-6 w-6" />
                    </Button>
                  ) : (
                    <div className="h-2" />
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {flash && <FlashScreen flash={flash} onClose={() => setFlash(null)} />}
    </div>
  );
}

function Thumb({ product, size = 'md' }: { product: ProductCard; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'sm' ? 'h-10 w-10' : size === 'lg' ? 'h-28 w-28' : 'h-14 w-14';
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

const FLASH_LOOK: Record<Flash['tone'], { bg: string; icon: typeof Check }> = {
  received: { bg: 'bg-green-600', icon: Check },
  send: { bg: 'bg-orange-500', icon: Truck },
  duplicate: { bg: 'bg-amber-500', icon: RotateCcw },
  problem: { bg: 'bg-red-600', icon: HelpCircle },
};

/** The answer to a scan, big enough to read from across the bench. Tap to close. */
function FlashScreen({ flash, onClose }: { flash: Flash; onClose: () => void }) {
  const { t } = useI18n();
  const look = FLASH_LOOK[flash.tone];
  const Icon = look.icon;
  return (
    <div
      onClick={onClose}
      role="status"
      aria-live="assertive"
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-6 text-center text-white',
        look.bg,
      )}
    >
      <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white/20">
        <Icon className="h-14 w-14" strokeWidth={3} />
      </span>
      <p className="text-4xl font-black uppercase tracking-wide">{flash.title}</p>
      {flash.product && (
        <span className="flex flex-col items-center gap-3">
          <Thumb product={flash.product} size="lg" />
          <span className="text-xl font-bold">{flash.product.name}</span>
        </span>
      )}
      {flash.detail && <p className="text-lg opacity-90">{flash.detail}</p>}
      {flash.undo && (
        <button
          type="button"
          aria-label={t('ops.undo')}
          onClick={(e) => {
            e.stopPropagation();
            flash.undo!();
            onClose();
          }}
          className="mt-6 flex h-20 w-20 items-center justify-center rounded-full bg-white/25 ring-2 ring-white/70 active:scale-95"
        >
          <Undo2 className="h-10 w-10" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}
