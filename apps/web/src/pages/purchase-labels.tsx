import { BarcodeFormat, MultiFormatWriter } from '@zxing/library';
import { ArrowLeft, Printer, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isLabelSizeId, LABEL_SIZES } from '@/lib/label-sizes';

interface UnitLabel {
  id: string;
  code: string;
  sequence: number;
  of: number;
  printedAt: string | null;
  product: { id: string; name: string; sku: string; color: string | null; storage: string | null };
}

interface LabelSheet {
  purchase: { id: string; number: string };
  data: UnitLabel[];
}

/**
 * The code as a square symbol, drawn as SVG rather than a canvas.
 *
 * SVG prints at the printer's resolution instead of the screen's, which is the
 * difference between a symbol a scanner reads first time and one it has to be
 * coaxed into. The encoder is the one already in the bundle for the camera
 * scanner — adding a barcode library for this would be a second copy of the
 * same table of patterns.
 */
function CodeSymbol({ value, size = 96 }: { value: string; size?: number }) {
  const path = useMemo(() => {
    const matrix = new MultiFormatWriter().encode(
      value,
      BarcodeFormat.QR_CODE,
      size,
      size,
      new Map(),
    );
    const parts: string[] = [];
    for (let y = 0; y < matrix.getHeight(); y++) {
      for (let x = 0; x < matrix.getWidth(); x++) {
        if (matrix.get(x, y)) parts.push(`M${x} ${y}h1v1h-1z`);
      }
    }
    return { d: parts.join(''), width: matrix.getWidth(), height: matrix.getHeight() };
  }, [value, size]);

  return (
    <svg
      viewBox={`0 0 ${path.width} ${path.height}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-label={value}
      className="shrink-0"
    >
      <rect width={path.width} height={path.height} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

/**
 * CSS millimetres render at exactly 96px/inch in every browser at 100% zoom —
 * the same fixed ratio `@page` uses — so sizing off this constant keeps the
 * on-screen preview a true rehearsal of what the thermal printer produces,
 * not a guess in unrelated pixels that happened to look right at one size.
 */
const MM_TO_PX = 96 / 25.4;
const mm = (value: number) => value * MM_TO_PX;

/**
 * A sheet of unit labels, laid out to be printed and stuck on boxes.
 *
 * Deliberately its own page rather than a dialog: printing is the whole point,
 * and a print stylesheet that has to undo an application shell is a print
 * stylesheet that will one day put a sidebar on a label.
 */
export default function PurchaseLabelsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const user = useAuth((s) => s.user);
  const query = useApiQuery<LabelSheet>(`/purchases/${id}/labels`);
  const [sizeId, setSizeId] = useState<(typeof LABEL_SIZES)[number]['id']>(
    user?.printerLabelSize && isLabelSizeId(user.printerLabelSize) ? user.printerLabelSize : '58x40',
  );
  const size = LABEL_SIZES.find((s) => s.id === sizeId)!;
  const connection = user?.printerConnectionType ?? 'BROWSER';

  const printViaNetwork = useApiMutation(() => api.post(`/purchases/${id}/labels/print`, {}), ['/purchases']);
  const [printingViaAgent, setPrintingViaAgent] = useState(false);

  if (query.isLoading) return <LoadingState label={t('labels.loading')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const sheet = query.data!;

  const printViaAgent = async () => {
    if (!user?.printerAddress) return;
    setPrintingViaAgent(true);
    try {
      let failed = 0;
      for (const label of sheet.data) {
        try {
          const res = await fetch(user.printerAddress, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: label.code,
              product: label.product.name,
              sequence: label.sequence,
              of: label.of,
              purchaseNumber: sheet.purchase.number,
              size: sizeId,
            }),
          });
          if (!res.ok) failed += 1;
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) toast.push('error', t('labels.agentPartial', { failed: String(failed) }));
      else toast.push('success', t('labels.printed'));
    } finally {
      setPrintingViaAgent(false);
    }
  };

  const print = () => {
    if (connection === 'NETWORK') {
      printViaNetwork.mutate(undefined, {
        onSuccess: () => toast.push('success', t('labels.printed')),
        onError: (error) => toast.push('error', error.message),
      });
    } else if (connection === 'AGENT') {
      void printViaAgent();
    } else {
      window.print();
    }
  };

  const printing = printViaNetwork.isPending || printingViaAgent;

  return (
    <div className="mx-auto max-w-4xl space-y-5 print:m-0 print:max-w-none print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button asChild variant="ghost" size="sm" className="-ms-2 gap-1">
          <Link to={`/purchases/${id}`}>
            <ArrowLeft className="h-4 w-4" />
            {sheet.purchase.number}
          </Link>
        </Button>
        {sheet.data.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="label-size" className="text-xs text-muted-foreground">
                {t('labels.size')}
              </Label>
              <Select
                id="label-size"
                className="h-8 w-auto"
                value={sizeId}
                onChange={(e) => setSizeId(e.target.value as typeof sizeId)}
              >
                {LABEL_SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.width}×{s.height} mm
                  </option>
                ))}
              </Select>
            </div>
            <Button className="gap-2" onClick={print} disabled={printing}>
              <Printer className="h-4 w-4" />
              {printing ? t('common.saving') : t('labels.print')}
            </Button>
          </div>
        )}
      </div>

      {sheet.data.length === 0 ? (
        <EmptyState icon={Tags} title={t('labels.none')} description={t('labels.noneBody')} />
      ) : (
        <>
          {/* A thermal printer feeds one label at a time — each `.label-page`
              below has to be its own printed page, sized to the roll, not a
              cell in a grid meant for a sheet of paper. Everything on it is
              sized in millimetres so the on-screen preview is the same shape
              as what comes out of the printer, at every roll size offered. */}
          <style>{`
            @media print {
              @page { size: ${size.width}mm ${size.height}mm; margin: 0; }
              html, body { margin: 0; }
            }
          `}</style>
          <div className="flex flex-wrap justify-center gap-4 print:block print:gap-0">
            {sheet.data.map((label) => {
              const subtitle = [label.product.storage, label.product.color].filter(Boolean).join(' · ');
              const qrMm = size.height * 0.68;
              // The code (e.g. "UL-2026-000123") has to share the row with the
              // QR, so its size is bounded by the text column's actual width,
              // not just the label's height — sizing off height alone is what
              // sent a 14-character code past the edge of the card. It's still
              // allowed to wrap onto a second line rather than truncate: a
              // human reading it as a QR-scan fallback needs every character.
              const colWidthMm = size.width - qrMm - 4;
              const codeMm = Math.max(1.6, Math.min(size.height * 0.12, colWidthMm / (label.code.length * 0.62)));
              return (
                <div
                  key={label.id}
                  style={{ width: mm(size.width), height: mm(size.height) }}
                  // `break-inside-avoid` is the fix for a label splitting
                  // across two printed pages: without it, a fixed-height box
                  // that lands a fraction of a pixel over the page boundary
                  // gets fragmented by the browser's own pagination rather
                  // than pushed whole onto the next page.
                  className="label-page flex shrink-0 break-inside-avoid items-center gap-[2mm] overflow-hidden border border-dashed border-border bg-white p-[1mm] text-black print:border-0 print:break-inside-avoid print:break-after-page print:last:break-after-auto"
                >
                  <CodeSymbol value={label.code} size={Math.round(mm(qrMm))} />
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-[0.5mm]">
                    <p className="w-full truncate font-semibold leading-none" style={{ fontSize: mm(size.height * 0.1) }}>
                      {label.product.name}
                    </p>
                    {subtitle && (
                      <p className="w-full truncate leading-none" style={{ fontSize: mm(size.height * 0.07) }}>
                        {subtitle}
                      </p>
                    )}
                    <p className="tabular w-full break-all font-bold leading-tight" style={{ fontSize: mm(codeMm) }}>
                      {label.code}
                    </p>
                    <p className="w-full truncate leading-none" style={{ fontSize: mm(size.height * 0.06) }}>
                      {label.sequence}/{label.of} · {sheet.purchase.number}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
