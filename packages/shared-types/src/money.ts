/**
 * Money helpers. All monetary values cross the API as decimal strings so that
 * no precision is lost in JSON; arithmetic happens in integer minor units.
 */
export function toMinor(value: string | number, decimals = 2): bigint {
  const s = typeof value === 'number' ? value.toFixed(decimals) : value.trim();
  const neg = s.startsWith('-');
  const [intPart, fracPart = ''] = (neg ? s.slice(1) : s).split('.');
  const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const magnitude = BigInt((intPart || '0') + frac);
  return neg ? -magnitude : magnitude;
}

export function fromMinor(value: bigint, decimals = 2): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const s = abs.toString().padStart(decimals + 1, '0');
  const out = `${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)}`;
  return neg ? `-${out}` : out;
}

export function multiply(unitPrice: string, quantity: number): string {
  return fromMinor(toMinor(unitPrice) * BigInt(quantity));
}

export function add(a: string, b: string): string {
  return fromMinor(toMinor(a) + toMinor(b));
}

export function subtract(a: string, b: string): string {
  return fromMinor(toMinor(a) - toMinor(b));
}

/** Margin as a percentage string with two decimals. Revenue of zero yields "0.00". */
export function marginPercent(revenue: string, profit: string): string {
  const r = toMinor(revenue);
  if (r === 0n) return '0.00';
  const p = toMinor(profit);
  return fromMinor((p * 10000n) / r);
}

export function formatMoney(value: string, currency: string, locale = 'en-GB'): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${value} ${currency}`;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
}
