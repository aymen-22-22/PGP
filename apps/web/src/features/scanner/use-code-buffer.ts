import { useCallback, useMemo, useState } from 'react';
import { scanFeedback } from './feedback';

export type CodeOutcome =
  | { kind: 'accepted'; code: string }
  | { kind: 'duplicate'; code: string }
  | { kind: 'stray'; code: string; reason: string };

export interface CodeEntry {
  code: string;
  at: number;
}

/**
 * Holds the codes scanned so far for one batch operation — loading a
 * transfer, receiving a shipment.
 *
 * Deliberately format-agnostic: unlike {@link useScanBuffer}, nothing here
 * assumes the scanned value is a 15-digit IMEI. What was printed on the box
 * is a unit label (`UL-2026-000123`); the server is what actually resolves a
 * code to a device, and any code it doesn't recognise comes back as a
 * rejected request, not a client-side guess.
 */
export function useCodeBuffer(
  options: {
    expected?: number;
    /** The codes this operation is expecting — a scan outside the set is a `stray`. */
    expectedCodes?: ReadonlySet<string>;
    strayReason?: string;
  } = {},
) {
  const [entries, setEntries] = useState<CodeEntry[]>([]);
  const [lastOutcome, setLastOutcome] = useState<CodeOutcome | null>(null);

  const seen = useMemo(() => new Set(entries.map((e) => e.code)), [entries]);
  const { expectedCodes, strayReason = 'Not part of this batch.' } = options;

  const add = useCallback(
    (raw: string): CodeOutcome => {
      const code = raw.trim().toUpperCase();
      const isDuplicate = seen.has(code);
      const isStray = expectedCodes !== undefined && !expectedCodes.has(code);

      const outcome: CodeOutcome = isDuplicate
        ? { kind: 'duplicate', code }
        : isStray
          ? { kind: 'stray', code, reason: strayReason }
          : { kind: 'accepted', code };

      if (!isDuplicate) {
        setEntries((current) => [{ code, at: Date.now() }, ...current]);
      }
      scanFeedback(isDuplicate ? 'duplicate' : isStray ? 'rejected' : 'accepted');
      setLastOutcome(outcome);
      return outcome;
    },
    [seen, expectedCodes, strayReason],
  );

  const remove = useCallback((code: string) => {
    setEntries((current) => current.filter((e) => e.code !== code));
  }, []);

  const reset = useCallback(() => {
    setEntries([]);
    setLastOutcome(null);
  }, []);

  const expected = options.expected;
  const strays = useMemo(
    () => (expectedCodes === undefined ? [] : entries.filter((e) => !expectedCodes.has(e.code)).map((e) => e.code)),
    [entries, expectedCodes],
  );

  return {
    entries,
    codes: useMemo(() => entries.map((e) => e.code), [entries]),
    count: entries.length,
    missing: expected === undefined ? null : Math.max(0, expected - entries.length),
    isComplete: expected === undefined ? false : entries.length >= expected,
    seen,
    strays,
    lastOutcome,
    add,
    remove,
    reset,
  };
}
