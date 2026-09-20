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
const LOCALES = ['en', 'fr', 'ar'];

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/**
 * A phrase may exist as a single key or as a plural family: English `units_one`
 * / `units_other`, Arabic `units_zero` / `units_one` / … / `units_other`. Those
 * are one phrase, so they compare as one base key.
 */
const baseOf = (key) => key.replace(PLURAL_SUFFIX, '');

const load = async (locale) => {
  const { default: dict } = await import(`../src/i18n/locales/${locale}.ts`);
  return { locale, keys: new Set(Object.keys(dict).map(baseOf)) };
};

const diff = (a, b) => [...b].filter((key) => !a.has(key));

const dicts = await Promise.all(LOCALES.map(load));
const en = dicts.find((d) => d.locale === 'en');

let failed = false;
let output = [];

for (const other of dicts.filter((d) => d.locale !== 'en')) {
  const missing = diff(en.keys, other.keys);
  const extra = diff(other.keys, en.keys);

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