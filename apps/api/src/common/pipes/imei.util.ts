import { classifyBarcode, ErrorCode, validateImei } from '@phone-erp/shared-types';
import { BusinessError } from '../errors/business.error';

export interface NormalizedImeiList {
  imeis: string[];
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
