import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    /**
     * Keeps the scans on this phone under this key until the batch is saved,
     * so a refresh, a crash or a flat battery does not lose fifty scans.
     */
    storageKey?: string;
  } = {},
) {
  const storageKey = options.storageKey ? `perp_scan:${options.storageKey}` : null;
  const [entries, setEntries] = useState<CodeEntry[]>(() => readSaved(storageKey));
  const [lastOutcome, setLastOutcome] = useState<CodeOutcome | null>(null);
  // How many scans came back from the phone's storage when the screen opened.
  const [restored] = useState(() => readSaved(storageKey).length);

  // A different batch (another transfer) starts from its own saved list.
  const keyRef = useRef(storageKey);
  useEffect(() => {
    if (keyRef.current === storageKey) return;
    keyRef.current = storageKey;
    setEntries(readSaved(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      if (entries.length === 0) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(entries.slice(0, 5000)));
    } catch {
      /* storage full or blocked: scanning still works, it just isn't kept */
    }
  }, [entries, storageKey]);

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

  /** Takes back the most recent scan — the one a thumb just added by mistake. */
  const undo = useCallback(() => {
    setEntries((current) => current.slice(1));
    setLastOutcome(null);
  }, []);

  const reset = useCallback(() => {
    setEntries([]);
    setLastOutcome(null);
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* nothing to clear */
      }
    }
  }, [storageKey]);

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
    restored,
    add,
    remove,
    undo,
    reset,
  };
}

function readSaved(key: string | null): CodeEntry[] {
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((e): e is CodeEntry => typeof e?.code === 'string' && typeof e?.at === 'number')
      : [];
  } catch {
    return [];
  }
}
