import { History, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/provider';
import type { CodeEntry } from './use-code-buffer';

/** The running list of what has been scanned, newest first — code-based counterpart to {@link ScanList}. */
export function CodeList({
  entries,
  onRemove,
  onUndo,
  restored = 0,
  emptyLabel,
}: {
  entries: CodeEntry[];
  onRemove?: (code: string) => void;
  /** Shows a big "Undo last scan" button. */
  onUndo?: () => void;
  /** Scans brought back from the phone after a refresh. */
  restored?: number;
  emptyLabel?: string;
}) {
  const { t } = useI18n();

  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel ?? t('scan.nothingScanned')}</p>;
  }

  return (
    <div className="space-y-2">
      {restored > 0 && (
        <p className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
          <History className="h-4 w-4 shrink-0" />
          {t('scan.restored', { count: restored })}
        </p>
      )}
      {onUndo && (
        <Button type="button" variant="outline" size="lg" className="h-auto w-full gap-3 py-2" onClick={onUndo}>
          <Undo2 className="h-5 w-5 shrink-0" />
          <span className="flex min-w-0 flex-col items-start">
            <span>{t('scan.undo')}</span>
            <span className="tabular max-w-full truncate text-xs font-normal text-muted-foreground">
              {entries[0]!.code}
            </span>
          </span>
        </Button>
      )}
    <ul className="divide-y rounded-lg border bg-card">
      {entries.slice(0, 200).map((entry, index) => (
        <li key={entry.code} className="flex items-center gap-3 px-3 py-2.5">
          <span className="tabular w-10 shrink-0 text-sm text-muted-foreground">{entries.length - index}</span>
          <span className="tabular flex-1 truncate font-medium">{entry.code}</span>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(entry.code)}
              aria-label={t('scan.remove', { imei: entry.code })}
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
    </div>
  );
}
