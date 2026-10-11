/** i18next for both sites (CLAUDE.md, "i18n").
 *
 *  The language is a setting, not part of the URL: the visitor's saved choice (localStorage), else the browser's
 *  language, else English. Texts live in `packages/shared/src/locales/{lang}/{area}.json`, each file shaped
 *  `{ "area": { ... } }`; a language's files merge into one namespace, so components call t('area.key'). English is
 *  bundled (the fallback, ready on the first render); other languages load when chosen. Each site picks its areas
 *  (./site.ts, ./admin.ts), so the user site never ships the admin site's texts. */
import i18n from 'i18next';
import type { BackendModule, ResourceKey } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, supportedLanguage } from './languages';

export type Tree = { [k: string]: string | Tree };
type Lazy = Record<string, () => Promise<Tree>>;

function merge(into: Tree, from: Tree): Tree {
  for (const [k, v] of Object.entries(from)) {
    into[k] = typeof v === 'object' && typeof into[k] === 'object' ? merge(into[k] as Tree, v) : v;
  }
  return into;
}

/** The visitor's choice, per site (both sites are separate origins anyway). */
export const STORAGE_KEY = 'yourapp-language';

export interface SetupOptions {
  /** English files, eagerly imported: import.meta.glob('../locales/en/*.json', { eager: true, import: 'default' }) */
  english: Record<string, Tree>;
  /** Every other language's files, lazily: import.meta.glob(['../locales/*\/*.json', '!../locales/en/*.json'], ...) */
  others: Lazy;
}

let started = false;

export function setupI18n({ english, others }: SetupOptions): typeof i18n {
  if (started) return i18n;
  started = true;
  const backend: BackendModule = {
    type: 'backend',
    init() {},
    read(lng, _ns, done) {
      const files = Object.entries(others).filter(([path]) => path.includes(`/locales/${lng}/`));
      Promise.all(files.map(([, load]) => load()))
        .then((trees) => done(null, trees.reduce(merge, {}) as ResourceKey))
        .catch((e) => done(e, null));
    },
  };
  i18n
    .use(backend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: { [DEFAULT_LANGUAGE]: { translation: Object.values(english).reduce(merge, {}) } },
      partialBundledLanguages: true,  // English is here; the backend loads the rest
      supportedLngs: [...LANGUAGE_CODES],
      fallbackLng: DEFAULT_LANGUAGE,
      load: 'currentOnly',
      interpolation: { escapeValue: false },  // React escapes
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: STORAGE_KEY,
        caches: [],  // only an explicit choice is saved (switchLanguage), so languageChosen() means one
        convertDetectedLanguage: (l: string) => supportedLanguage(l) ?? l,
      },
      react: { useSuspense: true },
      showSupportNotice: false,
    });
  const setLang = () => {
    document.documentElement.lang = i18n.resolvedLanguage || DEFAULT_LANGUAGE;
  };
  i18n.on('languageChanged', setLang);
  if (i18n.language) setLang();
  return i18n;
}

/** The active language code (one of LANGUAGES), sent to the API as X-Language. */
export const currentLanguage = (): string => supportedLanguage(i18n.resolvedLanguage) ?? DEFAULT_LANGUAGE;

/** Switch the site's language and remember the choice (localStorage). Signed-in pages also save it on the profile
 *  (PUT /api/account/settings), so emails follow it. */
export function switchLanguage(code: string) {
  const lng = supportedLanguage(code) ?? DEFAULT_LANGUAGE;
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // private mode: the choice lasts for this page only
  }
  return i18n.changeLanguage(lng);
}

/** Has the visitor picked a language on this site (vs. the browser's default)? */
export function languageChosen(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

export { i18n };
