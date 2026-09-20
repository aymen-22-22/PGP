import { fromMinor, toMinor } from '@phone-erp/shared-types';

export interface AllocationTarget {
  deviceId: string;
  /** Quantity (always 1), or current landed cost when allocating by value. */
  basis: bigint;
}

export interface AllocationResult {
  deviceId: string;
  amount: string;
  basis: string;
}

/**
 * Splits one amount across devices so that the parts add up to the whole.
 *
 * Money does not divide evenly: €100 over 3 units is 33.33 three times, which
 * loses a cent. Everything here happens in integer minor units, and the
 * remainder is handed out one unit at a time to the largest shares, so the
 * allocation always reconciles exactly to the document.
 */
export function allocate(totalAmount: string, targets: AllocationTarget[]): AllocationResult[] {
  if (targets.length === 0) return [];

  const total = toMinor(totalAmount, 4);
  const basisSum = targets.reduce((sum, t) => sum + t.basis, 0n);

  // Nothing to weight by — an all-zero-value lot, say — so split evenly.
  const weights = basisSum === 0n ? targets.map(() => 1n) : targets.map((t) => t.basis);
  const weightSum = weights.reduce((a, b) => a + b, 0n);

  const shares = weights.map((w) => (total * w) / weightSum);
  let remainder = total - shares.reduce((a, b) => a + b, 0n);

  // Give the leftover minor units to the biggest shares first: the cent lands
  // where it is least visible, and never on a zero-weight unit.
  const order = shares
    .map((share, index) => ({ index, share }))
    .sort((a, b) => (b.share === a.share ? a.index - b.index : b.share > a.share ? 1 : -1));

  const step = remainder >= 0n ? 1n : -1n;
  let cursor = 0;
  while (remainder !== 0n && order.length > 0) {
    shares[order[cursor % order.length].index] += step;
    remainder -= step;
    cursor += 1;
  }

  return targets.map((t, i) => ({
    deviceId: t.deviceId,
    amount: fromMinor(shares[i], 4),
    basis: fromMinor(t.basis, 4),
  }));
}
