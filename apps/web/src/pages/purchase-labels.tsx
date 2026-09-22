import { BarcodeFormat, MultiFormatWriter } from '@zxing/library';
import { ArrowLeft, Printer, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';

/** Common thermal roll sizes, in millimetres — width × height of one label. */
const LABEL_SIZES = [
  { id: '40x30', width: 40, height: 30 },
  { id: '50x30', width: 50, height: 30 },
  { id: '58x40', width: 58, height: 40 },
  { id: '60x40', width: 60, height: 40 },
] as const;

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
    >
      <rect width={path.width} height={path.height} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

/**
 * A sheet of unit labels, laid out to be printed and stuck on boxes.
 *
 * Deliberately its own page rather than a dialog: printing is the whole point,
 * and a print stylesheet that has to undo an application shell is a print
 * stylesheet that will one day put a sidebar on a label.
 */
export default function PurchaseLabelsPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const query = useApiQuery<LabelSheet>(`/purchases/${id}/labels`);
  const [sizeId, setSizeId] = useState<(typeof LABEL_SIZES)[number]['id']>('58x40');
  const size = LABEL_SIZES.find((s) => s.id === sizeId)!;

  if (query.isLoading) return <LoadingState label={t('labels.loading')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const sheet = query.data!;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
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
            <Button className="gap-2" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              {t('labels.print')}
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
              cell in a grid meant for a sheet of paper. */}
          <style>{`
            @media print {
              @page { size: ${size.width}mm ${size.height}mm; margin: 0; }
            }
          `}</style>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 print:block print:gap-0">
            {sheet.data.map((label) => (
              <div
                key={label.id}
                style={{ ['--label-w' as string]: `${size.width}mm`, ['--label-h' as string]: `${size.height}mm` }}
                className="label-page flex items-center gap-2 rounded-md border border-border bg-white p-2 text-black print:flex print:h-[var(--label-h)] print:w-[var(--label-w)] print:items-center print:justify-center print:overflow-hidden print:rounded-none print:border-0 print:p-1 print:break-after-page print:last:break-after-auto"
              >
                <CodeSymbol value={label.code} size={Math.round(size.height * 2.2)} />
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-xs font-semibold leading-tight">{label.product.name}</p>
                  <p className="truncate text-[10px] leading-tight">
                    {[label.product.storage, label.product.color].filter(Boolean).join(' · ')}
                  </p>
                  <p className="tabular text-[11px] font-bold leading-tight">{label.code}</p>
                  <p className="text-[10px] leading-tight">
                    {label.sequence} / {label.of} · {sheet.purchase.number}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
