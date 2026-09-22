/**
 * IMEI normalisation and validation.
 * An IMEI is 15 digits; the last digit is a Luhn check digit.
 * Some scanners emit a 14-digit TAC+serial or a 16/17-digit IMEISV — we accept
 * only the canonical 15-digit form to keep the physical-device identity unambiguous.
 */
export function normalizeImei(raw: string): string {
  return raw.replace(/[\s\-_.]/g, '').trim();
}

export function luhnCheck(value: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = value.length - 1; i >= 0; i -= 1) {
    let digit = value.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return false;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export interface ImeiValidation {
  valid: boolean;
  normalized: string;
  reason?: 'LENGTH' | 'NON_NUMERIC' | 'CHECKSUM';
}

export function validateImei(raw: string, opts: { enforceChecksum?: boolean } = {}): ImeiValidation {
  const normalized = normalizeImei(raw);
  if (!/^\d+$/.test(normalized)) return { valid: false, normalized, reason: 'NON_NUMERIC' };
  if (normalized.length !== 15) return { valid: false, normalized, reason: 'LENGTH' };
  if (opts.enforceChecksum && !luhnCheck(normalized)) {
    return { valid: false, normalized, reason: 'CHECKSUM' };
  }
  return { valid: true, normalized };
}

/** Builds a valid 15-digit IMEI from a 14-digit prefix by appending the Luhn check digit. */
export function withLuhnCheckDigit(prefix14: string): string {
  let sum = 0;
  let double = true;
  for (let i = prefix14.length - 1; i >= 0; i -= 1) {
    let digit = prefix14.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return prefix14 + String((10 - (sum % 10)) % 10);
}

/**
 * Pulls the IMEIs out of whatever a barcode actually contains.
 *
 * A scanner rarely hands you a bare 15-digit number. Retail box labels carry
 * both IMEIs plus a serial, Code 128 symbols may be prefixed with an AIM
 * identifier, GS1 payloads bury the number among application identifiers, and
 * some labels encode the 16-digit IMEISV instead. Demanding that the whole
 * payload be exactly 15 digits — which is what this used to do — silently drops
 * all of those.
 *
 * The check digit is what makes this safe: in a payload full of numbers, a
 * 15-digit window that satisfies Luhn is an IMEI and almost nothing else is.
 */
/**
 * The first two digits of an IMEI are the Reporting Body Identifier — the body
 * that allocated the type code. Only a handful are ever assigned, so this is a
 * cheap, strong signal that a run of digits really is an IMEI and not a date,
 * a price, or a GS1 application identifier that happens to satisfy Luhn.
 *
 * Used to rank, never to reject: an unfamiliar prefix still scans when it is
 * the only candidate.
 */
const REPORTING_BODIES = new Set([
  '01', '35', '86', '99', // the overwhelming majority of handsets in circulation
  '44', '45', '49', '50', '51', '52', '53', '54', // older allocations still in the field
]);

const looksLikeImei = (imei: string): boolean => REPORTING_BODIES.has(imei.slice(0, 2));

export function extractImeis(payload: string, opts: { requireChecksum?: boolean } = {}): string[] {
  const text = payload ?? '';
  const scored = new Map<string, number>();

  /**
   * Several 15-digit windows inside one long payload can all satisfy Luhn by
   * coincidence — a GS1 string yields four. Ranking decides which is the phone
   * in your hand, and getting it wrong would receive the wrong unit.
   */
  const consider = (candidate: string, score: number): void => {
    if (candidate.length !== 15) return;
    const total = score + (looksLikeImei(candidate) ? 30 : 0);
    scored.set(candidate, Math.max(scored.get(candidate) ?? 0, total));
  };

  // Strongest signal: the label says so.
  for (const match of text.matchAll(/imei\s*\d?\s*[:=#]?\s*([\d\s\-_.]{15,17})/gi)) {
    const digits = (match[1] ?? '').replace(/\D/g, '');
    if (digits.length >= 15 && luhnCheck(digits.slice(0, 15))) consider(digits.slice(0, 15), 100);
  }

  for (const run of text.match(/[\d\s\-_.]{14,}/g) ?? []) {
    const digits = run.replace(/\D/g, '');

    // A run that is exactly one number is almost certainly that number.
    if (digits.length === 15 && luhnCheck(digits)) {
      consider(digits, 80);
      continue;
    }

    // IMEISV: 14 digits of TAC and serial, then two software-version digits.
    // The IMEI is those 14 with a check digit appended — a reading no window
    // can produce, because the check digit is not in the payload at all.
    //
    // Only worth trusting when those 14 digits actually start like an IMEI.
    // A 15-digit code behind a prefix such as ]C1 also arrives as a 16-digit
    // run, and reading that as IMEISV invents a number that was never printed.
    if (digits.length === 16) {
      const fromSv = withLuhnCheckDigit(digits.slice(0, 14));
      consider(fromSv, looksLikeImei(fromSv) ? 45 : 0);
    }

    // Some labels encode only the 14-digit TAC and serial, leaving the check
    // digit off because it is derivable. Completing it is safe enough when the
    // number starts with an allocated reporting body — without that guard any
    // 14-digit figure on the box could be "completed" into a plausible IMEI.
    if (digits.length === 14 && looksLikeImei(digits)) consider(withLuhnCheckDigit(digits), 40);

    // Otherwise slide, preferring a window that starts where the number does.
    for (let i = 0; i + 15 <= digits.length; i += 1) {
      const window = digits.slice(i, i + 15);
      if (luhnCheck(window)) consider(window, i === 0 ? 20 : 10);
    }
  }

  if (scored.size > 0) {
    return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([imei]) => imei);
  }

  // Nothing satisfied the check digit. Real stock does carry IMEIs mistyped
  // upstream, so fall back to a single unambiguous 15-digit run — but only when
  // the payload is that number and nothing else, otherwise we would be guessing
  // which slice of a longer string was meant.
  if (!opts.requireChecksum) {
    const digitsOnly = text.replace(/\D/g, '');
    if (digitsOnly.length === 15 && /^\D*\d[\d\s\-_.]*\D*$/.test(text)) return [digitsOnly];
  }

  return [];
}

/** The single IMEI a scan most likely meant, or null. */
export function extractImei(payload: string, opts: { requireChecksum?: boolean } = {}): string | null {
  return extractImeis(payload, opts)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Barcode classification
// ---------------------------------------------------------------------------

export type BarcodeClassification =
  | { kind: 'IMEI'; imei: string }
  | { kind: 'LABEL'; code: string }
  | { kind: 'SERIAL'; serial: string }
  | { kind: 'EAN'; digits: string; eanType: 'EAN' | 'UPC' }
  | { kind: 'OTHER'; raw: string; reason: string };

/**
 * A unit label reserved at purchase time — `UL-2026-000123`.
 *
 * The dashes are optional on the way in, because a scanner or a typist may
 * drop them, but the match is anchored: only this exact shape qualifies, so
 * an ordinary serial that happens to start with "UL" is still a serial.
 */
const UNIT_LABEL = /^UL-?(\d{4})-?(\d{6})$/i;

/** Prefixes that tell a raw payload is a serial or part number, before the digits. */
const SERIAL_PREFIX = /^(s\/n|s n|sn|serial|serial no|serial#|no|noc|p\/n|pn|part#|part no|ctn|case|batch|lot)\s*[:=#-]?\s*/i;

/** What a phone box label actually carries, read from a scan payload. */
export function classifyBarcode(payload: string): BarcodeClassification {
  const raw = (payload ?? '').trim();
  if (!raw) return { kind: 'OTHER', raw, reason: 'EMPTY' };

  // An IMEI is the strongest signal: Luhn-valid 15 digits, found anywhere in
  // a GS1/AIM/padded payload. Try it first so "IMEI: 35..." is the IMEI.
  const imei = extractImei(raw);
  if (imei) return { kind: 'IMEI', imei };

  // A scanner prefix (]C1, ]E0...) is framing, not part of the number.
  const body = raw.replace(/^\]\w\d?\s*/, '');
  const digits = body.replace(/\D/g, '');

  // Our own label, before the serial branch would strip its dashes and turn
  // "UL-2026-000123" into "UL2026000123" — which matches nothing.
  const label = UNIT_LABEL.exec(body.trim());
  if (label) return { kind: 'LABEL', code: `UL-${label[1]}-${label[2]}` };

  // Digits-only 12/13 run: the retail box barcode, shared by every unit of the
  // model. 13 is EAN-13, 12 is UPC-A. Letters anywhere mean a serial or part
  // number — "S/N:2UKBB25506101197" embeds 12 digits but is serial, not EAN.
  if (!/[A-Za-z]/.test(body) && (digits.length === 12 || digits.length === 13)) {
    return { kind: 'EAN', digits, eanType: digits.length === 13 ? 'EAN' : 'UPC' };
  }

  const stripped = body.replace(SERIAL_PREFIX, '');
  const compact = stripped.replace(/[\s\-_.:;=]/g, '');
  if (/[A-Za-z]/.test(compact) && /\d/.test(compact) && compact.length >= 4) {
    return { kind: 'SERIAL', serial: compact.toUpperCase() };
  }

  if (digits.length >= 4 && digits.length !== 15) {
    // A run of digits that is not 15 (IMEI), not 12/13 (EAN): a serial,
    // carton or batch number. Accept it as serial — the caller decides what an
    // unknown serial means in its context.
    return { kind: 'SERIAL', serial: digits };
  }

  return { kind: 'OTHER', raw, reason: 'NOT_A_BARCODE' };
}
