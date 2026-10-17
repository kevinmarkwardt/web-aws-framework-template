#!/usr/bin/env node
// npm run i18n:check (also the last step of npm run lint). Checks the site texts in packages/shared/src/locales:
//   - every language in packages/shared/src/i18n/languages.ts has a folder, and every folder is a listed language
//   - every language has exactly English's keys (plural forms aside), with the same {{placeholders}} and <tags>
//   - every t('area.key') / i18nKey="area.key" in frontend/src, admin/src and packages/shared/src exists in English,
//     and each site uses only the areas it loads (packages/shared/src/i18n/site.ts and admin.ts)
//   - every English key is used somewhere (a literal 'area.key' anywhere in the source counts, so do t(`area.${x}`)
//     prefixes and t('area.section', { returnObjects: true }) subtrees)
// Exits 1 with a list when anything is off.
//
//   node scripts/i18n-check.mjs              the checks
//   node scripts/i18n-check.mjs --literals   also list JSX text and text props (placeholder, title, aria-label, alt)
//                                            that look untranslated (a hint, never a failure)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHARED = join(ROOT, 'packages/shared/src');
const LOCALES = join(SHARED, 'locales');
const PLURAL = /_(zero|one|two|few|many|other)$/;

// which areas each source tree may use (mirrors i18n/site.ts and i18n/admin.ts)
const TREES = [
  { dir: join(ROOT, 'frontend/src'), name: 'frontend', allowed: (area) => !area.startsWith('admin') },
  { dir: join(ROOT, 'admin/src'), name: 'admin', allowed: (area) => area === 'common' || area.startsWith('admin') },
  { dir: SHARED, name: 'packages/shared', allowed: (area) => area === 'common' },
];

function flat(tree, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flat(v, key, out);
    else out[key] = String(v);
  }
  return out;
}
const isDir = (p) => statSync(p).isDirectory();
function load(lang) {
  const out = {};
  const files = {};
  for (const f of readdirSync(join(LOCALES, lang)).filter((f) => f.endsWith('.json'))) {
    const tree = JSON.parse(readFileSync(join(LOCALES, lang, f), 'utf8'));
    for (const k of Object.keys(flat(tree))) files[k] = f;
    Object.assign(out, flat(tree));
  }
  return { keys: out, files };
}
const marks = (s) => [...s.matchAll(/\{\{\s*(\w+)[^}]*\}\}|<\/?(\w+)\s*\/?>/g)].map((m) => m[1] ?? `<${m[2]}>`).sort().join(',');
const base = (k) => k.replace(PLURAL, '');

// react-i18next's <Trans> treats HTML void elements as self-closing, so text wrapped in <link>...</link> (or <img>,
// <input>, ...) disappears. Wrapper tags need another name, e.g. <a>...</a>.
const VOID_WRAPPER = /<(area|base|br|col|embed|hr|img|input|keygen|link|meta|param|source|track|wbr)>[\s\S]*?<\/\1>/;

const problems = [];
const hints = [];

// ---- languages.ts vs the folders
const languagesTs = readFileSync(join(SHARED, 'i18n/languages.ts'), 'utf8');
const listed = [...languagesTs.matchAll(/\{\s*code:\s*'([\w-]+)'/g)].map((m) => m[1]);
const folders = readdirSync(LOCALES).filter((d) => isDir(join(LOCALES, d)));
for (const c of listed) if (!folders.includes(c)) problems.push(`languages.ts lists ${c} but packages/shared/src/locales/${c}/ is missing`);
for (const d of folders) if (!listed.includes(d)) problems.push(`locales/${d}/ is not in packages/shared/src/i18n/languages.ts`);

// ---- every language vs English
const { keys: en, files: enFiles } = load('en');
const enBases = new Set(Object.keys(en).map(base));
for (const lang of folders) {
  const { keys, files } = lang === 'en' ? { keys: en, files: enFiles } : load(lang);
  for (const [k, v] of Object.entries(keys)) {
    const m = VOID_WRAPPER.exec(v);
    if (m) problems.push(`${lang}: ${k} wraps text in <${m[1]}>, a void element whose text <Trans> drops; rename the tag`);
    if (lang !== 'en' && enFiles[k] && files[k] !== enFiles[k]) problems.push(`${lang}: ${k} is in ${files[k]}, English has it in ${enFiles[k]}`);
  }
  if (lang === 'en') continue;
  const bases = new Set(Object.keys(keys).map(base));
  for (const k of enBases) if (!bases.has(k)) problems.push(`${lang}: missing ${k}`);
  for (const k of bases) if (!enBases.has(k)) problems.push(`${lang}: extra ${k}`);
  for (const [k, v] of Object.entries(keys)) {
    const src = en[k] ?? en[`${base(k)}_other`] ?? en[base(k)];
    if (src !== undefined && marks(src) !== marks(v)) problems.push(`${lang}: ${k} placeholders ${marks(v)} != ${marks(src)}`);
  }
}

// ---- the source: unknown keys, keys from an area the site doesn't load, unused keys
function* files(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'locales' || f === 'dist') continue;
    if (isDir(p)) yield* files(p);
    else if (/\.(tsx?|mjs)$/.test(f)) yield p;
  }
}
const prefixes = new Set(Object.keys(en).flatMap((k) => k.split('.').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('.'))));
const used = new Set();
const usedPrefixes = new Set();
for (const tree of TREES) {
  for (const f of files(tree.dir)) {
    const where = relative(ROOT, f);
    // comments don't count (they may show t('area.key') as an example)
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const calls = [
      ...[...text.matchAll(/\bt\(\s*['"]([a-zA-Z][\w-]*(?:\.[\w-]+)+)['"]/g)].map((m) => m[1]),
      ...[...text.matchAll(/i18nKey=["']([\w.-]+)["']/g)].map((m) => m[1]),
    ];
    for (const k of calls) {
      if (!enBases.has(k) && !prefixes.has(k)) problems.push(`${where}: unknown key ${k}`);
      else if (!tree.allowed(k.split('.')[0])) problems.push(`${where}: ${k} is from an area ${tree.name} doesn't load`);
    }
    // any quoted literal that is a key (lists of keys, props) counts as a use; so do template prefixes
    for (const m of text.matchAll(/['"`]([a-zA-Z][\w-]*(?:\.[\w-]+)+)['"`]/g)) {
      if (enBases.has(m[1])) used.add(m[1]);
      else if (prefixes.has(m[1])) usedPrefixes.add(`${m[1]}.`);
    }
    for (const m of text.matchAll(/`([a-zA-Z][\w-]*(?:\.[\w-]+)*\.)\$\{/g)) usedPrefixes.add(m[1]);
    if (process.argv.includes('--literals') && f.endsWith('.tsx')) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        const jsxText = line.match(/>\s*([A-Za-z][^<>{}]*[A-Za-z.!?:])\s*(<|$)/);
        const prop = line.match(/\b(placeholder|title|aria-label|alt|label|hint)=["']([^"']*[A-Za-z]{2}[^"']*)["']/);
        if (jsxText && !/^[\w-]+=/.test(jsxText[1]) && !/=>|&&|\|\|/.test(jsxText[1])) hints.push(`${where}:${i + 1}: ${jsxText[1].trim()}`);
        if (prop) hints.push(`${where}:${i + 1}: ${prop[1]}="${prop[2]}"`);
      });
    }
  }
}
const unused = Object.keys(en).filter((k) => !used.has(base(k)) && ![...usedPrefixes].some((p) => k.startsWith(p)));
for (const k of unused) problems.push(`en: unused key ${k} (${enFiles[k]})`);

if (hints.length) {
  console.log(`Possibly untranslated (${hints.length}):\n${hints.join('\n')}\n`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} i18n problem(s)`);
  process.exit(1);
}
console.log(`i18n ok: ${enBases.size} keys, ${folders.length} language(s): ${folders.join(', ')}`);
