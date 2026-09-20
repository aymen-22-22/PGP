/**
 * Guard that the three dictionaries never drift apart.
 *
 * English is the source of truth for shape: every phrase is defined once there
 * and French and Arabic must match it exactly. A missing French or Arabic key
 * is an error (a silent English fallback is exactly the bug this prevents); a
 * key that exists in French but not in English is reported but allowed, since
 * it may exist while a screen still shows the phrase.
 *
 * Run: npm run check:i18n -w @phone-erp/web
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = ['en', 'fr', 'ar'];

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/**
 * A phrase may exist as a single key or as a plural family: English `units_one`
 * / `units_other`, Arabic `units_zero` / `units_one` / … / `units_other`. Those
 * are one phrase, so they compare as one base key.
 */
const baseOf = (key) => key.replace(PLURAL_SUFFIX, '');

/**
 * The dictionaries are TypeScript modules. Reading them here as text — rather
 * than importing them — keeps this guard runnable on any Node version without
 * flagging TS or relying on the runtime's type-stripping. The keys are the part
 * that matters for parity; apostrophes and the plural families cited above are
 * the only edge cases worth defending against.
 */
const dictFrom = (locale) => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'i18n', 'locales', `${locale}.ts`), 'utf8');
  const keys = new Set();
  // Matches lines like `  'stock.imei': 'IMEI',` — the guard spans exactly one
  // line per key. Something prettier (a multi-line phrase) would be a bigger
  // change to the dictionaries than a better regex.
  for (const match of source.matchAll(/'([^']+)':[^,]+/g)) {
    keys.add(baseOf(match[1]));
  }
  return { locale, keys };
};

const diff = (a, b) => [...b].filter((key) => !a.has(key));

const dicts = LOCALES.map(dictFrom);
const en = dicts.find((d) => d.locale === 'en');

let failed = false;
let output = [];

for (const other of dicts.filter((d) => d.locale !== 'en')) {
  const missing = diff(en.keys, other.keys).map(baseOf);
  const extra = diff(other.keys, en.keys).map(baseOf);

  if (missing.length > 0) {
    failed = true;
    output.push(`✗ ${other.locale} is missing ${missing.length} key(s):`);
    output.push(missing.map((k) => `    ${k}`).join('\n'));
  }
  if (extra.length > 0) {
    output.push(`! ${other.locale} has ${extra.length} key(s) English does not:`);
    output.push(extra.map((k) => `    ${k}`).join('\n'));
  }
}

if (output.length > 0) console.log(output.join('\n'));

const check = failed ? 'FAIL' : `OK (${en.keys.size} keys × ${LOCALES.length} languages)`;
console.log(`\ni18n parity: ${check}`);
if (failed) process.exitCode = 1;
