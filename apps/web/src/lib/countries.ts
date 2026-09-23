const FLAGS: Record<string, string> = { FR: '🇫🇷', ES: '🇪🇸', DZ: '🇩🇿', NL: '🇳🇱', CN: '🇨🇳' };

export const flagOf = (code: string | null | undefined): string => (code && FLAGS[code]) || '🏭';

/** The country's name in the reader's language, straight from the browser. */
export function countryName(code: string | null | undefined, locale: string): string {
  if (!code) return '—';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Warehouse codes are "DZ-01", "ES-02"…, so the prefix names the country when nothing else does. */
export const countryFromWarehouseCode = (code: string | null | undefined): string | null =>
  code?.match(/^([A-Z]{2})-/)?.[1] ?? null;

export interface CountryGroup<T> {
  code: string | null;
  items: T[];
}

/** Groups rows by country, countries and rows inside each both in a stable name order. */
export function groupByCountry<T>(
  items: T[],
  countryOf: (item: T) => string | null | undefined,
  nameOf: (item: T) => string,
  locale: string,
): CountryGroup<T>[] {
  const groups = new Map<string | null, T[]>();
  for (const item of items) {
    const code = countryOf(item) ?? null;
    groups.set(code, [...(groups.get(code) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([code, rows]) => ({ code, items: rows.sort((a, b) => nameOf(a).localeCompare(nameOf(b))) }))
    .sort((a, b) =>
      a.code === null ? 1 : b.code === null ? -1 : countryName(a.code, locale).localeCompare(countryName(b.code, locale)),
    );
}
