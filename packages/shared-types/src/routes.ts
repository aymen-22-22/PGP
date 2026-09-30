/**
 * Where stock may be sent, by country: France supplies Spain, Spain supplies
 * Algeria. A route not listed here is refused, and destination lists only
 * offer what is allowed. Countries are ISO codes (FR, ES, DZ).
 */
export const TRANSFER_ROUTES: Readonly<Record<string, readonly string[]>> = {
  FR: ['ES'],
  ES: ['DZ'],
};

/** A warehouse's country: its country record, else the prefix of its code ("ES-01" → ES). */
export function warehouseCountry(w: { code?: string | null; countryRef?: { code: string } | null }): string | null {
  return w.countryRef?.code ?? w.code?.match(/^([A-Z]{2})-/)?.[1] ?? null;
}

/**
 * Whether stock may go from one warehouse to another. A warehouse whose
 * country is not known (no country set, code not like "ES-01") is not bound
 * by the rule.
 */
export function canSendBetween(
  from: { code?: string | null; countryRef?: { code: string } | null },
  to: { code?: string | null; countryRef?: { code: string } | null },
): boolean {
  const a = warehouseCountry(from);
  const b = warehouseCountry(to);
  if (!a || !b) return true;
  return (TRANSFER_ROUTES[a] ?? []).includes(b);
}
