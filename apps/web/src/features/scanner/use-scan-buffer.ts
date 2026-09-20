import { useCallback, useMemo, useState } from 'react';
import { extractImei, validateImei } from '@phone-erp/shared-types';
import { explainNonImei } from './explain-scan';
import { scanFeedback } from './feedback';
import { useI18n } from '@/i18n/provider';

export type ScanOutcome =
  | { kind: 'accepted'; imei: string }
  | { kind: 'duplicate'; imei: string }
  | { kind: 'invalid'; imei: string; reason: string }
  | { kind: 'stray'; imei: string; reason: string };

export interface ScanEntry {
  imei: string;
  at: number;
}

/**
 * Holds the IMEIs scanned so far for one operation.
 *
 * Validation and duplicate detection happen locally and instantly — a scanner
 * fires several times a second and cannot wait for a round trip. The server
 * re-checks everything when the batch is submitted; this is feedback, not trust.
 */
export function useScanBuffer(
  options: {
    enforceChecksum?: boolean;
    expected?: number;
    /**
     * The IMEIs this operation is expecting. When given, a scan outside the set
     * is reported immediately as `stray` instead of being cheerfully accepted
     * and only questioned at submit time.
     */
    expectedImeis?: ReadonlySet<string>;
    strayReason?: string;
  } = {},
) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [lastOutcome, setLastOutcome] = useState<ScanOutcome | null>(null);

  const seen = useMemo(() => new Set(entries.map((e) => e.imei)), [entries]);
  const { expectedImeis } = options;
  const strayReason = options.strayReason ?? t('scan.strayReason');

  const add = useCallback(
    (raw: string): ScanOutcome => {
      // Accept a whole barcode payload, not only a bare number.
      const extracted = extractImei(raw, { requireChecksum: options.enforceChecksum });
      const check = validateImei(extracted ?? raw, { enforceChecksum: options.enforceChecksum });
      if (!check.valid) {
        scanFeedback('rejected');
        // Name the barcode that was actually read. "Not a valid IMEI" is true
        // and tells the operator nothing about where to point the camera next.
        const outcome: ScanOutcome = {
          kind: 'invalid',
          imei: check.normalized || raw,
          reason: explainNonImei(raw, t),
        };
        setLastOutcome(outcome);
        return outcome;
      }


      const isDuplicate = seen.has(check.normalized);
      const isStray = expectedImeis !== undefined && !expectedImeis.has(check.normalized);

      const outcome: ScanOutcome = isDuplicate
        ? { kind: 'duplicate', imei: check.normalized }
        : isStray
          ? { kind: 'stray', imei: check.normalized, reason: strayReason }
          : { kind: 'accepted', imei: check.normalized };

      // A stray is still added to the list, so the operator can see it and take
      // it out — silently dropping a phone they physically scanned would be worse.
      if (!isDuplicate) {
        // Newest first: the operator confirms what they just scanned.
        setEntries((current) => [{ imei: check.normalized, at: Date.now() }, ...current]);
      }
      scanFeedback(isDuplicate ? 'duplicate' : isStray ? 'rejected' : 'accepted');
      setLastOutcome(outcome);
      return outcome;
    },
    [options.enforceChecksum, seen, expectedImeis, strayReason, t],
  );

  const addMany = useCallback((imeis: string[]) => {
    setEntries((current) => {
      const known = new Set(current.map((e) => e.imei));
      const fresh = imeis
        .filter((i) => !known.has(i))
        .map((imei) => ({ imei, at: Date.now() }));
      return [...fresh, ...current];
    });
  }, []);

  const remove = useCallback((imei: string) => {
    setEntries((current) => current.filter((e) => e.imei !== imei));
  }, []);

  const reset = useCallback(() => {
    setEntries([]);
    setLastOutcome(null);
  }, []);

  const expected = options.expected;
  const strays = useMemo(
    () => (expectedImeis === undefined ? [] : entries.filter((e) => !expectedImeis.has(e.imei)).map((e) => e.imei)),
    [entries, expectedImeis],
  );

  return {
    entries,
    imeis: useMemo(() => entries.map((e) => e.imei), [entries]),
    count: entries.length,
    missing: expected === undefined ? null : Math.max(0, expected - entries.length),
    isComplete: expected === undefined ? false : entries.length >= expected,
    seen,
    strays,
    lastOutcome,
    add,
    addMany,
    remove,
    reset,
  };
}
