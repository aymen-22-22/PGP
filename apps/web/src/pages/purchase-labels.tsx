import { BarcodeFormat, MultiFormatWriter } from '@zxing/library';
import { ArrowLeft, Printer, Tags } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n/provider';

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

  if (query.isLoading) return <LoadingState label={t('labels.loading')} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const sheet = query.data!;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Button asChild variant="ghost" size="sm" className="-ms-2 gap-1">
          <Link to={`/purchases/${id}`}>
            <ArrowLeft className="h-4 w-4" />
            {sheet.purchase.number}
          </Link>
        </Button>
        {sheet.data.length > 0 && (
          <Button className="gap-2" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            {t('labels.print')}
          </Button>
        )}
      </div>

      {sheet.data.length === 0 ? (
        <EmptyState icon={Tags} title={t('labels.none')} description={t('labels.noneBody')} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 print:grid-cols-3 print:gap-1">
          {sheet.data.map((label) => (
            <div
              key={label.id}
              className="flex items-center gap-2 rounded-md border border-border bg-white p-2 text-black print:break-inside-avoid print:rounded-none"
            >
              <CodeSymbol value={label.code} />
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
      )}
    </div>
  );
}
