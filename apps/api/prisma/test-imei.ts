import { withLuhnCheckDigit } from '@phone-erp/shared-types';

/**
 * Deterministic, valid, obviously-fake IMEIs for development and tests:
 * the 99000000 reserved test TAC, a 6-digit serial, and a real Luhn check digit
 * so they behave exactly like production IMEIs in the scanner.
 */
export function testImei(index: number): string {
  return withLuhnCheckDigit(`99000000${String(index).padStart(6, '0')}`);
}
