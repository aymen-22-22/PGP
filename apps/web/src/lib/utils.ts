import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Money is always shown to the cent. An earlier version dropped the decimals
 * above a threshold, which made a row of dashboard tiles read
 * "€98,000 / €8,000.00" and looked like a bug. Callers that genuinely want
 * round figures ask for them with `{ round: true }`, and then every value in
 * that group is rounded, so a group is never internally inconsistent.
 */
export function formatMoney(
  value: string | number | null | undefined,
  currency = 'EUR',
  options: { round?: boolean } = {},
): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  const digits = options.round ? 0 : 2;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** "1 order" / "2 orders" — avoids the "1 phone(s)" that reads like a draft. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-GB').format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

/** "356789012345678" → "35678901 2345678", easier to read back off a screen. */
export function formatImei(imei: string): string {
  return imei.length === 15 ? `${imei.slice(0, 8)} ${imei.slice(8)}` : imei;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
