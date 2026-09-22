import { classifyBarcode, ErrorCode, validateImei } from '@phone-erp/shared-types';
import { BusinessError } from '../errors/business.error';

export interface NormalizedImeiList {
  imeis: string[];
}

/**
 * Normalises a batch of scanned codes without assuming they are IMEIs.
 *
 * A scan at transfer or sale time may be a printed unit label
 * (`UL-2026-000123`) as easily as a legacy IMEI — both are valid, opaque
 * strings from this point's perspective, and it is the resolver on the other
 * end (matching against Device.imei or PurchaseUnitLabel.code) that decides
 * whether one is real. Only whitespace is trimmed and case is normalised;
 * rejecting an unrecognised code happens at resolution, with a message that
 * can say what was actually typed rather than "not a valid IMEI".
 */
/**
 * One scanned code, trimmed and upper-cased — no format assumed.
 *
 * The singular counterpart to {@link normalizeScanCodes}: whether the string
 * names a real unit is for the resolver to say, not this.
 */
export function scanCode(raw: string): string {
  return (raw ?? '').trim().toUpperCase();
}

export function normalizeScanCodes(raw: string[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const result: string[] = [];

  for (const value of raw) {
    const trimmed = (value ?? '').trim().toUpperCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) {
      duplicates.push(trimmed);
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }

  if (duplicates.length > 0) {
    throw new BusinessError(
      ErrorCode.IMEI_DUPLICATE_IN_REQUEST,
      `${duplicates.length} code(s) were scanned more than once.`,
      400,
      { duplicates: duplicates.slice(0, 20) },
    );
  }
  return result;
}

/**
 * Normalises a batch of scanned IMEIs and rejects the batch if any entry is
 * malformed or repeated. Scanners routinely append whitespace or a carriage
 * return, so normalisation happens before any comparison.
 */
export function normalizeImeiBatch(raw: string[], enforceChecksum: boolean): string[] {
  const seen = new Set<string>();
  const invalid: { imei: string; reason: string }[] = [];
  const duplicates: string[] = [];
  const result: string[] = [];

  for (const value of raw) {
    const check = validateImei(value ?? '', { enforceChecksum });
    if (!check.valid) {
      invalid.push({ imei: check.normalized || String(value), reason: check.reason ?? 'INVALID' });
      continue;
    }
    if (seen.has(check.normalized)) {
      duplicates.push(check.normalized);
      continue;
    }
    seen.add(check.normalized);
    result.push(check.normalized);
  }

  if (invalid.length > 0) {
    throw new BusinessError(
      ErrorCode.IMEI_INVALID,
      `${invalid.length} IMEI(s) are not valid 15-digit numbers.`,
      400,
      { invalid: invalid.slice(0, 20) },
    );
  }
  if (duplicates.length > 0) {
    throw new BusinessError(
      ErrorCode.IMEI_DUPLICATE_IN_REQUEST,
      `${duplicates.length} IMEI(s) were scanned more than once.`,
      400,
      { duplicates: duplicates.slice(0, 20) },
    );
  }
  return result;
}

export function normalizeSingleImei(raw: string, enforceChecksum: boolean): string {
  const check = validateImei(raw ?? '', { enforceChecksum });
  if (!check.valid) {
    throw new BusinessError(ErrorCode.IMEI_INVALID, 'This is not a valid 15-digit IMEI.', 400, {
      reason: check.reason,
    });
  }
  return check.normalized;
}

/**
 * Normalises a batch of scanned serial numbers (the barcodes that are neither
 * IMEI nor EAN) and rejects entries that are really something else, so a
 * receiver cannot accidentally file an IMEI or a product barcode as a serial.
 */
export function normalizeSerialBatch(raw: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of raw) {
    const cls = classifyBarcode(value ?? '');
    if (cls.kind === 'IMEI') {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        `"${value}" is an IMEI — add it to the IMEI list, not the serial list.`,
        400,
      );
    }
    if (cls.kind === 'EAN') {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        `"${value}" is a ${cls.eanType} product barcode, not a serial number.`,
        400,
      );
    }
    if (cls.kind === 'LABEL') {
      throw new BusinessError(
        ErrorCode.VALIDATION_FAILED,
        `"${value}" is a printed unit label — receive it by scanning the label, not as a serial number.`,
        400,
      );
    }
    if (cls.kind === 'OTHER') {
      throw new BusinessError(ErrorCode.IMEI_INVALID, `"${value}" is not a readable serial number.`, 400, {
        reason: cls.reason,
      });
    }
    if (seen.has(cls.serial)) {
      throw new BusinessError(
        ErrorCode.SERIAL_DUPLICATE_IN_REQUEST,
        `The serial "${cls.serial}" was scanned more than once.`,
        400,
      );
    }
    seen.add(cls.serial);
    result.push(cls.serial);
  }
  return result;
}
