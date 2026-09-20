import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/provider';
import { formatImei } from '@/lib/utils';
import type { ScanEntry } from './use-scan-buffer';

/** The running list of what has been scanned, newest first. */
export function ScanList({
  entries,
  onRemove,
  emptyLabel,
}: {
  entries: ScanEntry[];
  onRemove?: (imei: string) => void;
  emptyLabel?: string;
}) {
  const { t } = useI18n();

  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {emptyLabel ?? t('scan.nothingScanned')}
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {entries.slice(0, 200).map((entry, index) => (
        <li key={entry.imei} className="flex items-center gap-3 px-3 py-2.5">
          <span className="tabular w-10 shrink-0 text-sm text-muted-foreground">
            {entries.length - index}
          </span>
          <span className="tabular flex-1 truncate font-medium">{formatImei(entry.imei)}</span>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(entry.imei)}
              aria-label={t('scan.remove', { imei: entry.imei })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </li>
      ))}
      {entries.length > 200 && (
        <li className="px-3 py-2 text-center text-xs text-muted-foreground">
          {t('scan.more', { count: entries.length - 200 })}
        </li>
      )}
    </ul>
  );
}

/** Expected / scanned / missing — the three numbers the operator needs. */
export function ScanProgress({ expected, scanned }: { expected: number; scanned: number }) {
  const { t } = useI18n();
  const missing = Math.max(0, expected - scanned);
  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg border bg-card p-3 text-center">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('scan.expected')}</p>
        <p className="tabular text-stat">{expected}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('scan.scanned')}</p>
        <p className="tabular text-stat text-success">{scanned}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('scan.missing')}</p>
        <p className={`tabular text-stat ${missing > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
          {missing}
        </p>
      </div>
    </div>
  );
}