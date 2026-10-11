// Vite plugin both sites use (frontend/vite.config.ts, admin/vite.config.ts): production builds never ship the browser
// mocks.
//   - VITE_STAGE=prod and any entity still true in packages/shared/src/mocks/mocks.config.ts: the build fails, naming
//     them. Make them real first: scripts/new-entity.py --backend <Entity> (writes the API route, flips the flag).
//   - VITE_STAGE=prod: public/mockServiceWorker.js and public/mock-images/ are left out of dist/ (main.tsx never
//     imports the mocks then anyway).
// Dev and test builds are untouched.
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** The plurals set to true in a mocks.config.ts source (comment lines ignored). */
export function mockedInConfig(source: string): string[] {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...body.matchAll(/^\s*['"]?([\w-]+)['"]?\s*:\s*true\b/gm)].map((m) => m[1]);
}

export function mockGuard(): Plugin {
  let stage = '';
  let root = '';
  let outDir = '';
  return {
    name: 'yourapp-mock-guard',
    apply: 'build',
    configResolved(config) {
      stage = config.env.VITE_STAGE ?? '';
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    buildStart() {
      if (stage !== 'prod') return;
      const file = resolve(root, '../packages/shared/src/mocks/mocks.config.ts');
      const mocked = mockedInConfig(readFileSync(file, 'utf8'));
      if (mocked.length) {
        this.error(`VITE_STAGE=prod but these entities are still mocked: ${mocked.join(', ')} (${file}). `
          + 'Give each a backend first: python3 scripts/new-entity.py --backend <Entity>.');
      }
    },
    closeBundle() {
      if (stage !== 'prod') return;
      rmSync(resolve(outDir, 'mockServiceWorker.js'), { force: true });
      rmSync(resolve(outDir, 'mock-images'), { recursive: true, force: true });  // gen-fixtures.py placeholders
    },
  };
}
