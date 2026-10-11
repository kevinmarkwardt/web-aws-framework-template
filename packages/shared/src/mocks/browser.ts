/** @yourapp/shared/mocks: the browser mocks (MSW). Each site's main.tsx starts them before the first render, in dev and
 *  test builds only:
 *
 *    if (import.meta.env.VITE_STAGE !== 'prod') await (await import('@yourapp/shared/mocks')).startMocks();
 *
 *  (VITE_STAGE is replaced at build time, so a production bundle doesn't even contain this module.) Only the entities
 *  switched on in mocks.config.ts are answered, from mocks/fixtures/<plural>.json via a MockStore each; every other
 *  request (auth, account, billing, admin platform routes, entities with a real backend) goes to the network as usual.
 *  Needs public/mockServiceWorker.js in the site (both sites have it; `npx msw init <app>/public` refreshes it after
 *  an msw upgrade). */
import { setupWorker } from 'msw/browser';
import { CONTRACTS } from '../contracts/all.gen';
import type { EntityRecord } from '../contracts/types';
import { crudHandlers } from './handlers';
import { mockedEntities } from './state';
import { MockStore } from './store';

const FIXTURES = import.meta.glob<EntityRecord[]>('./fixtures/*.json', { eager: true, import: 'default' });

let started: Promise<boolean> | null = null;

/** Start the mocks (once). Resolves to whether anything is mocked. */
export function startMocks(): Promise<boolean> {
  started ??= start();
  return started;
}

async function start(): Promise<boolean> {
  const on = new Set(mockedEntities());
  const contracts = CONTRACTS.filter((c) => on.has(c.plural));
  if (!contracts.length || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  const stores = new Map(contracts.map((c) => [c.name, new MockStore(c.plural, FIXTURES[`./fixtures/${c.plural}.json`] ?? [])]));
  const worker = setupWorker(...contracts.flatMap((c) => crudHandlers(c, stores.get(c.name)!, stores)));
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true, serviceWorker: { url: '/mockServiceWorker.js' } });
  console.info(`[mocks] ${contracts.map((c) => c.plural).join(', ')} answered in the browser (packages/shared/src/mocks)`);
  return true;
}

export { MockStore } from './store';
export { crudHandlers, callerOf } from './handlers';
