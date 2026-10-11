/** The site's languages: the one list the user site, the admin site and the language picker read.
 *
 *  scripts/init.sh writes it from ai/site.spec.json `modules.i18n.languages` (default English only). To add a language
 *  by hand (CLAUDE.md, "i18n"): add it here, copy `packages/shared/src/locales/en/` to `locales/{code}/` and translate
 *  the values, and copy `api/locales/en.json` to `api/locales/{code}.json` likewise. `npm run i18n:check` and
 *  tests/test_language_sync.py keep the three in step. The language picker shows once there are two or more. */
export const LANGUAGES: readonly { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
];

/** The fallback: always complete (the other languages are checked against it). */
export const DEFAULT_LANGUAGE = 'en';

export const LANGUAGE_CODES: readonly string[] = LANGUAGES.map((l) => l.code);

/** A browser language tag ("es-MX", "pt_BR") -> one of LANGUAGES, or undefined (the detector then tries the browser's
 *  next language before settling on the default). Exact code first, then the base language. */
export function supportedLanguage(tag: string | undefined | null): string | undefined {
  if (!tag) return undefined;
  const t = tag.replace('_', '-').toLowerCase();
  const exact = LANGUAGE_CODES.find((c) => c.toLowerCase() === t);
  if (exact) return exact;
  const base = t.split('-')[0];
  return LANGUAGE_CODES.find((c) => c.toLowerCase() === base);
}
