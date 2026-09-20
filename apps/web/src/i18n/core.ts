/**
 * Translation, without a library.
 *
 * Three languages and about 450 phrases does not need a framework — but it does
 * need correct plural rules, and Arabic has six forms where English has two.
 * `Intl.PluralRules` is in every browser this app supports and knows all of
 * them, so the hard part is borrowed rather than reimplemented.
 *
 * Dictionaries load on demand. A warehouse phone on mobile data should not
 * download Arabic to show English.
 */

export const LOCALES = {
  en: { label: 'English', dir: 'ltr', intl: 'en-GB' },
  fr: { label: 'Français', dir: 'ltr', intl: 'fr-FR' },
  // Algeria writes numbers in Western digits, so the Latin numbering system is
  // requested explicitly rather than taking the Arabic default.
  ar: { label: 'العربية', dir: 'rtl', intl: 'ar-DZ-u-nu-latn' },
} as const;

export type Locale = keyof typeof LOCALES;
export type Direction = 'ltr' | 'rtl';

export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (value: string | null | undefined): value is Locale =>
  Boolean(value && value in LOCALES);

/** A flat dictionary: dotted keys to phrases. */
export type Dictionary = Record<string, string>;

/**
 * Values interpolated into a phrase.
 *
 * `count` is special: it selects the plural form as well as being available to
 * the phrase, so `{count} units` and its five Arabic variants all come from one
 * call site.
 */
export type Vars = Record<string, string | number> & { count?: number };

const pluralRules = new Map<Locale, Intl.PluralRules>();

function pluralFor(locale: Locale, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(LOCALES[locale].intl);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/**
 * Looks up a phrase and fills in its variables.
 *
 * A missing phrase falls back to English rather than to the key: a screen
 * showing `stock.title` is more broken than one showing an English word among
 * French ones, and the fallback makes a partial translation usable while it is
 * being finished.
 */
export function translate(
  dictionary: Dictionary,
  fallback: Dictionary,
  locale: Locale,
  key: string,
  vars?: Vars,
): string {
  let phrase: string | undefined;

  if (vars && typeof vars.count === 'number') {
    // `key_one`, `key_other`, and for Arabic also `_zero`, `_two`, `_few`, `_many`.
    const form = pluralFor(locale, vars.count);
    phrase = dictionary[`${key}_${form}`] ?? dictionary[`${key}_other`];
    if (phrase === undefined) {
      const enForm = pluralFor(DEFAULT_LOCALE, vars.count);
      phrase = fallback[`${key}_${enForm}`] ?? fallback[`${key}_other`];
    }
  }

  phrase ??= dictionary[key] ?? fallback[key];
  if (phrase === undefined) return key;

  if (!vars) return phrase;
  return phrase.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? formatNumber(value, locale) : String(value);
  });
}

// ── formatting ───────────────────────────────────────────────────────────────
//
// Numbers, money and dates are as much a part of a language as its words. These
// mirror the helpers in lib/utils, which keep working for code that has no
// locale to hand.

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALES[locale].intl).format(value);
}

export function formatMoney(
  amount: string | number,
  currency: string,
  locale: Locale,
  options?: { round?: boolean },
): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '—';

  return new Intl.NumberFormat(LOCALES[locale].intl, {
    style: 'currency',
    currency,
    minimumFractionDigits: options?.round ? 0 : 2,
    maximumFractionDigits: options?.round ? 0 : 2,
  }).format(value);
}

export function formatDate(value: string | Date, locale: Locale): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALES[locale].intl, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | Date, locale: Locale): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALES[locale].intl, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
