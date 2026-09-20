import { useEffect, useRef } from 'react';
import { extractImei } from '@phone-erp/shared-types';

/**
 * Captures a hardware barcode scanner anywhere on the page.
 *
 * A scanner is a keyboard that types impossibly fast — characters arrive a few
 * milliseconds apart, where a human manages perhaps one every hundred. That gap
 * is what separates a scan from typing, and it is far more reliable than the
 * old rule of "submit when exactly fifteen digits have arrived": real labels
 * carry a second IMEI, a serial, or a GS1 prefix, so they never hit fifteen and
 * nothing happened at all.
 *
 * Listening on the document means focus no longer matters. The operator can
 * scroll, tap a button, dismiss a toast — the next scan still lands. That alone
 * removes most of the fumbling from a long receiving session.
 */
export function useScanGun(
  onScan: (payload: string, imei: string | null) => void,
  options: { enabled?: boolean; maxKeyGapMs?: number } = {},
): void {
  const { enabled = true, maxKeyGapMs = 50 } = options;
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastKeyAt = 0;
    let flushTimer: number | undefined;

    const flush = (): void => {
      const payload = buffer;
      buffer = '';
      window.clearTimeout(flushTimer);
      // Two characters could be anything; a scan is never that short.
      if (payload.length < 8) return;
      onScanRef.current(payload, extractImei(payload));
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      // Never swallow a real shortcut.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const now = performance.now();
      const gap = now - lastKeyAt;
      lastKeyAt = now;

      if (event.key === 'Enter' || event.key === 'Tab') {
        if (buffer.length >= 8) {
          // The scanner's terminator, not the operator submitting a form.
          event.preventDefault();
          flush();
        }
        return;
      }

      if (event.key.length !== 1) return;

      // A slow keystroke starts a new capture; only a burst is a scan.
      if (gap > maxKeyGapMs) buffer = '';
      buffer += event.key;

      // Some scanners send no terminator at all, so close on the silence after.
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(flush, maxKeyGapMs * 4);
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.clearTimeout(flushTimer);
    };
  }, [enabled, maxKeyGapMs]);
}
