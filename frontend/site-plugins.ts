// Build-time plugins for the user site (vite.config.ts). Both run only in `vite build` and read the VITE_* settings
// (frontend/.env.example): .env.production (committed: the Google ids, from site.spec.yaml modules.googleTags via
// scripts/init.py) and .env.production.local (written per stage by scripts/deploy.sh: VITE_STAGE, VITE_SITE_URL).
import type { Plugin, ResolvedConfig } from 'vite';
import { PRIVATE_PATHS, PUBLIC_PAGES } from './src/seo';

/** The EEA, the UK and Switzerland: Google's consent mode starts "denied" there until the visitor answers a consent
 *  message (AdSense's certified CMP, set up in the AdSense console). VITE_CONSENT_REGIONS overrides the list. */
export const CONSENT_REGIONS = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV',
  'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH'];

type Env = Record<string, string | undefined>;
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

/** Google Analytics 4 (VITE_GA4_ID, "G-...") and AdSense (VITE_ADSENSE_CLIENT, "ca-pub-..."), with consent-mode
 *  defaults (denied in VITE_CONSENT_REGIONS, default CONSENT_REGIONS). Production builds only, never for the test stage
 *  (VITE_STAGE=test) or the dev server, so local work and the test site never report traffic or load ads. Nothing at
 *  all when neither id is set. */
export function googleTags(): Plugin {
  let env: Env = {};
  return {
    name: 'yourapp-google-tags',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      env = config.env;
    },
    transformIndexHtml() {
      const ga = env.VITE_GA4_ID?.trim();
      const ads = env.VITE_ADSENSE_CLIENT?.trim();
      if (env.VITE_STAGE === 'test' || (!ga && !ads)) return [];
      if (ga && !/^G-[A-Z0-9]+$/.test(ga)) throw new Error(`VITE_GA4_ID must look like G-XXXXXXX, not ${ga}`);
      if (ads && !/^ca-pub-\d+$/.test(ads)) throw new Error(`VITE_ADSENSE_CLIENT must look like ca-pub-123..., not ${ads}`);
      const regions = list(env.VITE_CONSENT_REGIONS);
      const consent = JSON.stringify({
        ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied',
        region: regions.length ? regions : CONSENT_REGIONS, wait_for_update: 500,
      });
      const init = 'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}'
        + `gtag('consent','default',${consent});gtag('js',new Date());${ga ? `gtag('config','${ga}');` : ''}`;
      return [
        // the consent defaults first, before any Google script loads
        { tag: 'script', children: init, injectTo: 'head' as const },
        ...(ga ? [{ tag: 'script', attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${ga}` }, injectTo: 'head' as const }] : []),
        ...(ads ? [{
          tag: 'script',
          attrs: { async: true, src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ads}`, crossorigin: 'anonymous' },
          injectTo: 'head' as const,
        }] : []),
      ];
    },
  };
}

/** robots.txt, sitemap.xml and ads.txt in the build output (dist/), from src/seo.ts and the env:
 *  - robots.txt: the test stage (VITE_STAGE=test) disallows everything; otherwise PRIVATE_PATHS, plus the sitemap
 *  - sitemap.xml: PUBLIC_PAGES under VITE_SITE_URL (left out when it isn't set, since sitemaps need full URLs)
 *  - ads.txt: only when VITE_ADSENSE_CLIENT is set (Google's line for the publisher id) */
export function seoFiles(): Plugin {
  let env: Env = {};
  return {
    name: 'yourapp-seo-files',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      env = config.env;
    },
    generateBundle() {
      const site = (env.VITE_SITE_URL ?? '').trim().replace(/\/+$/, '');
      const test = env.VITE_STAGE === 'test';
      const robots = test
        ? ['# the test stage: never indexed (CloudFront also sends X-Robots-Tag: noindex)', 'User-agent: *', 'Disallow: /']
        : ['User-agent: *', ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`), ...(site ? ['', `Sitemap: ${site}/sitemap.xml`] : [])];
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${robots.join('\n')}\n` });
      if (site && !test) {
        const urls = PUBLIC_PAGES.map((p) => `  <url><loc>${site}${p.path}</loc><changefreq>${p.changefreq}</changefreq></url>`);
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
        });
      }
      const ads = env.VITE_ADSENSE_CLIENT?.trim();
      if (ads) {
        this.emitFile({ type: 'asset', fileName: 'ads.txt', source: `google.com, ${ads.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n` });
      }
    },
  };
}
