import * as React from 'react';
import { useAuth } from '@/lib/auth';
import {
  DEFAULT_LOCALE,
  LOCALES,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  isLocale,
  translate,
  type Dictionary,
  type Direction,
  type Locale,
  type Vars,
} from './core';
import en from './locales/en';

const STORAGE_KEY = 'perp_locale';

/** Dictionaries already fetched, so switching back is instant. */
const loaded = new Map<Locale, Dictionary>([['en', en]]);

async function loadDictionary(locale: Locale): Promise<Dictionary> {
  const cached = loaded.get(locale);
  if (cached) return cached;

  // Split out of the main bundle: a phone showing English never downloads the
  // other two.
  const module = locale === 'fr' ? await import('./locales/fr') : await import('./locales/ar');
  loaded.set(locale, module.default);
  return module.default;
}

/**
 * The reader's own language, guessed then remembered.
 *
 * A warehouse in Algiers should not have to choose French every morning, and a
 * browser set to Arabic is a better first guess than English.
 */
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* private window, or storage blocked — fall through to the browser */
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag?.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

interface I18nValue {
  locale: Locale;
  dir: Direction;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Vars) => string;
  n: (value: number) => string;
  money: (amount: string | number, currency?: string, options?: { round?: boolean }) => string;
  date: (value: string | Date) => string;
  dateTime: (value: string | Date) => string;
}

const I18nContext = React.createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);
  const [dictionary, setDictionary] = React.useState<Dictionary>(() => loaded.get(locale) ?? en);

  React.useEffect(() => {
    let cancelled = false;
    void loadDictionary(locale).then((next) => {
      if (!cancelled) setDictionary(next);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  // The document itself has to know: `dir` drives the whole layout, and `lang`
  // tells a screen reader which voice to use.
  React.useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = LOCALES[locale].dir;
  }, [locale]);

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* the choice still applies for this session */
    }
  }, []);

  // The language saved on the account wins when someone signs in, so it
  // follows them to a new phone or a shared warehouse PC.
  const accountLanguage = useAuth((s) => s.user?.language ?? null);
  React.useEffect(() => {
    if (isLocale(accountLanguage)) setLocale(accountLanguage);
  }, [accountLanguage, setLocale]);

  const value = React.useMemo<I18nValue>(
    () => ({
      locale,
      dir: LOCALES[locale].dir,
      setLocale,
      t: (key, vars) => translate(dictionary, en, locale, key, vars),
      n: (v) => formatNumber(v, locale),
      money: (amount, currency = 'EUR', options) => formatMoney(amount, currency, locale, options),
      date: (v) => formatDate(v, locale),
      dateTime: (v) => formatDateTime(v, locale),
    }),
    [dictionary, locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = React.useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

/** The common case: just the translate function. */
export function useT(): I18nValue['t'] {
  return useI18n().t;
}
