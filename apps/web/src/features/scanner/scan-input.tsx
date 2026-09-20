import { AlertTriangle, CheckCircle2, Keyboard, Volume2, VolumeX, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { extractImei } from '@phone-erp/shared-types';
import { isScanFeedbackMuted, primeScanFeedback, scanFeedback, setScanFeedbackMuted } from './feedback';
import { useScanGun } from './use-scan-gun';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n/provider';
import { cn, formatImei } from '@/lib/utils';
import type { ScanOutcome } from './use-scan-buffer';

/**
 * The scan field.
 *
 * Works with all three input methods the specification requires: a USB or
 * Bluetooth scanner acting as a keyboard (it types the digits then presses
 * Enter), manual typing, and the camera scanner. It keeps focus so a hundred
 * consecutive scans need no taps at all, and it auto-submits at 15 digits so a
 * scanner that omits the trailing Enter still works.
 */
export function ScanInput({
  onScan,
  outcome,
  label,
  acceptedLabel,
  autoFocus = true,
  disabled,
}: {
  /** Receives the tidied value, plus the raw payload the symbol carried. */
  onScan: (value: string, raw: string) => void;
  outcome: ScanOutcome | null;
  label?: string;
  /** What a good scan is called here — not every screen is reading an IMEI. */
  acceptedLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [flashKey, setFlashKey] = useState(0);
  const [mutedUi, setMutedUi] = useState(isScanFeedbackMuted());

  const submit = (raw: string) => {
    if (!raw.trim()) return;
    // Pull the IMEI out of whatever the label actually carried — a second
    // number, a serial, a GS1 prefix. Anything unreadable is still passed on so
    // the buffer can say why rather than swallowing it.
    const imei = extractImei(raw);
    onScan(imei ?? raw.replace(/[\s\-_.]/g, ''), raw);
    setValue('');
    setFlashKey((k) => k + 1);
    inputRef.current?.focus();
  };

  // A hardware scanner is caught at the document, so it works no matter where
  // focus has wandered — a tapped button, a dismissed toast, a scrolled list.
  useScanGun(
    (payload) => {
      submit(payload);
    },
    { enabled: !disabled },
  );

  // Keep the caret in the field too, for anyone typing by hand.
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
      <label htmlFor="scan-input" className="flex items-center gap-2 text-sm font-semibold">
        <Keyboard className="h-4 w-4 text-muted-foreground" aria-hidden />
        {label ?? t('scan.input')}
      </label>

      <div className="flex gap-2">
        <Input
          id="scan-input"
          ref={inputRef}
          value={value}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={t('scan.inputPlaceholder')}
          className="tabular h-16 text-center text-2xl font-bold tracking-wider"
          onChange={(event) => {
            // Keep the payload intact. Stripping to digits mangled every
            // barcode that is not a bare number — a serial arrived as "239" —
            // and those need to reach the screen so it can say what it read.
            const next = event.target.value;
            setValue(next);
            // A scanner that sends no terminator still completes the scan the
            // moment the text contains a whole IMEI.
            if (extractImei(next)) submit(next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit(value);
            }
          }}
        />
        <Button
          size="lg"
          className="h-16 px-6"
          disabled={disabled || value.replace(/\D/g, '').length === 0}
          onClick={() => submit(value)}
        >
          {t('scan.add')}
        </Button>
      </div>

      <ScanFeedback key={flashKey} outcome={outcome} acceptedLabel={acceptedLabel ?? t('scan.codeRead')} />

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

function ScanFeedback({
  outcome,
  acceptedLabel,
}: {
  outcome: ScanOutcome | null;
  acceptedLabel: string;
}) {
  const { t } = useI18n();

  if (!outcome) {
    return (
      <p className="text-sm text-muted-foreground">{t('scan.ready')}</p>
    );
  }

  const config = {
    accepted: {
      icon: CheckCircle2,
      className: 'border-success/40 bg-success/10 text-success',
      title: acceptedLabel,
    },
    duplicate: {
      icon: AlertTriangle,
      className: 'border-warning/40 bg-warning/10 text-warning',
      title: t('scan.duplicate'),
    },
    invalid: {
      icon: XCircle,
      className: 'border-destructive/40 bg-destructive/10 text-destructive',
      title: t('scan.invalid'),
    },
    stray: {
      icon: XCircle,
      className: 'border-destructive/40 bg-destructive/10 text-destructive',
      title: t('scan.wrongPhone'),
    },
  }[outcome.kind];

  const Icon = config.icon;

  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn('flex items-center gap-2 rounded-md border p-3', config.className)}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{config.title}</p>
        <p className="tabular truncate text-xs">
          {formatImei(outcome.imei)}
          {(outcome.kind === 'invalid' || outcome.kind === 'stray') && ` — ${outcome.reason}`}
        </p>
      </div>
    </div>
  );
}

function isTypingElsewhere(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active as HTMLElement).isContentEditable;
}
