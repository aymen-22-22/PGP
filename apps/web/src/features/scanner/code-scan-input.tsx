import { AlertTriangle, Check, CheckCircle2, Keyboard, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CameraScanner } from './camera-scanner';
import { isScanFeedbackMuted, primeScanFeedback, scanFeedback, setScanFeedbackMuted } from './feedback';
import { useScanGun } from './use-scan-gun';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import type { CodeOutcome } from './use-code-buffer';

/**
 * The scan field for a printed unit label — the code-based counterpart to
 * {@link ScanInput}, which assumes a 15-digit IMEI. A label carries letters
 * and dashes (`UL-2026-000123`); running it through IMEI extraction would
 * mangle it, so this takes whatever the scanner sent, trimmed, nothing more.
 */
export function CodeScanInput({
  onScan,
  outcome,
  label,
  autoFocus = true,
  disabled,
  camera = true,
}: {
  onScan: (code: string) => void;
  outcome: CodeOutcome | null;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Off only where the camera would be in the way. */
  camera?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [flashKey, setFlashKey] = useState(0);
  const [mutedUi, setMutedUi] = useState(isScanFeedbackMuted());

  const submit = (raw: string) => {
    if (!raw.trim()) return;
    onScan(raw);
    setValue('');
    setFlashKey((k) => k + 1);
    inputRef.current?.focus();
  };

  // A hardware scanner is caught at the document, so it works no matter where
  // focus has wandered.
  useScanGun(
    (payload) => {
      submit(payload);
    },
    { enabled: !disabled },
  );

  useEffect(() => {
    if (!autoFocus || disabled) return;
    const focus = () => inputRef.current?.focus();
    focus();
    const interval = setInterval(() => {
      if (document.activeElement !== inputRef.current && !isTypingElsewhere()) focus();
    }, 1200);
    return () => clearInterval(interval);
  }, [autoFocus, disabled]);

  return (
    <div className="space-y-3">
      <label htmlFor="code-scan-input" className="flex items-center gap-2 text-sm font-semibold">
        <Keyboard className="h-4 w-4 text-muted-foreground" aria-hidden />
        {label ?? t('receiveScan.input')}
      </label>

      <div className="flex gap-2">
        <Input
          id="code-scan-input"
          ref={inputRef}
          value={value}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder="UL-2026-000123"
          className="tabular h-16 text-center text-xl font-bold tracking-wider placeholder:font-normal placeholder:text-muted-foreground/40"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit(value);
            }
          }}
        />
        <Button size="lg" className="h-16 px-6" disabled={disabled || !value.trim()} onClick={() => submit(value)}>
          {t('receiveScan.add')}
        </Button>
      </div>

      <CodeFeedback key={flashKey} outcome={outcome} />

      {/* Three ways in, because a warehouse has all three: the gun above
          (caught at the document), the phone camera here, and typing the code
          off the label by hand when a label is scuffed or the gun is flat. */}
      {camera && <CameraScanner onDetect={submit} />}

      <button
        type="button"
        onClick={() => {
          const next = !mutedUi;
          setScanFeedbackMuted(next);
          setMutedUi(next);
          if (!next) {
            primeScanFeedback();
            scanFeedback('accepted');
          }
        }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        {mutedUi ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        {mutedUi ? t('scan.soundOff') : t('scan.soundOn')}
      </button>
    </div>
  );
}

function CodeFeedback({ outcome }: { outcome: CodeOutcome | null }) {
  const { t } = useI18n();

  if (!outcome) {
    return <p className="text-sm text-muted-foreground">{t('scan.ready')}</p>;
  }

  const config = {
    accepted: { icon: CheckCircle2, className: 'border-success/40 bg-success/10 text-success', title: t('scan.codeRead') },
    duplicate: { icon: AlertTriangle, className: 'border-warning/40 bg-warning/10 text-warning', title: t('scan.codeDuplicate') },
    stray: { icon: AlertTriangle, className: 'border-destructive/40 bg-destructive/10 text-destructive', title: outcome.kind === 'stray' ? outcome.reason : '' },
  }[outcome.kind];

  const Icon = config.icon;

  return (
    <>
      {/* A full-screen flash the operator catches from the corner of their eye,
          so they never need to look at the screen to know the scan landed. */}
      <div
        key={`${outcome.kind}:${outcome.code}`}
        aria-hidden
        className={cn(
          'pointer-events-none fixed inset-0 z-50 flex animate-scan-flash items-center justify-center [animation-fill-mode:forwards]',
          { accepted: 'bg-success/15', duplicate: 'bg-warning/15', stray: 'bg-destructive/15' }[outcome.kind],
        )}
      >
        <div className="flex max-w-xs flex-col items-center gap-2 rounded-2xl bg-card/95 px-6 py-5 text-center shadow-2xl">
          <span
            className={cn(
              'flex h-16 w-16 items-center justify-center rounded-full text-white',
              { accepted: 'bg-success', duplicate: 'bg-warning', stray: 'bg-destructive' }[outcome.kind],
            )}
          >
            {outcome.kind === 'accepted' ? <Check className="h-9 w-9" strokeWidth={3} /> : outcome.kind === 'duplicate' ? <RotateCcw className="h-8 w-8" strokeWidth={3} /> : <X className="h-9 w-9" strokeWidth={3} />}
          </span>
          <p className="text-base font-bold">{config.title}</p>
          <p className="tabular text-xs text-muted-foreground">{outcome.code}</p>
        </div>
      </div>
    <div
      role="status"
      aria-live="assertive"
      className={cn('flex items-center gap-2 rounded-md border p-3', config.className)}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{config.title}</p>
        <p className="tabular truncate text-xs">{outcome.code}</p>
      </div>
    </div>
    </>
  );
}

function isTypingElsewhere(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active as HTMLElement).isContentEditable;
}
