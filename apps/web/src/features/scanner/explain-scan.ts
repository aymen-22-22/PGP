import { extractImei } from '@phone-erp/shared-types';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Explains why a barcode that decoded perfectly well contained no IMEI.
 *
 * A phone box carries several symbols — product code, serial, part number,
 * IMEI — and the largest, cleanest one is rarely the IMEI. "Read a code, but no
 * IMEI in it" is accurate and useless; naming what was actually read tells the
 * operator where to point the camera next.
 */
export function explainNonImei(payload: string, t: Translate): string {
  const text = (payload ?? '').trim();
  if (!text) return t('scan.explain.empty');

  const digits = text.replace(/\D/g, '');
  const compact = text.replace(/\s+/g, '');

  if (digits.length === 13 || digits.length === 12) {
    return t('scan.explain.barcode', {
      kind: digits.length === 13 ? t('scan.explain.ean13') : t('scan.explain.upc'),
    });
  }

  // Letters anywhere mean a serial or part code. Counting the stray digits in
  // "F2LX39ABCDEF" and reporting "only 3 digits" is technically true and
  // completely unhelpful.
  if (/[A-Za-z]/.test(text)) {
    return t('scan.explain.serial', { code: compact.slice(0, 24) });
  }

  if (digits.length === 14) {
    return t('scan.explain.noCheckDigit');
  }

  if (digits.length < 14) {
    return t('scan.explain.fewDigits', { count: digits.length });
  }

  // Long enough to contain one, but nothing in it passed as an IMEI.
  return t('scan.explain.noValid', { count: digits.length });
}

/** True when the payload carried an IMEI we could use. */
export function hasImei(payload: string): boolean {
  return extractImei(payload) !== null;
}