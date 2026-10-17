/** @yourapp/shared/mocks: the browser mocks (MSW). Each site's main.tsx starts them before the first render, in dev and
 *  test builds only:
 *
 *    if (import.meta.env.VITE_STAGE !== 'prod') await (await import('@yourapp/shared/mocks')).startMocks();
 *
 *  (VITE_STAGE is replaced at build time, so a production bundle doesn't even contain this module.) Only the entities
 *  switched on in mocks.config.ts are answered, from mocks/fixtures/<plural>.json via a MockStore each; every other
 *  request (auth, account, billing, admin platform routes, entities with a real backend) goes to the network as usual.
 *  Needs public/mockServiceWorker.js in the site (both sites have it; `npx msw init <app>/public` refreshes it after
 *  an msw upgrade). Where a service worker can't register (the Claude desktop browser pane, some embedded browsers),
 *  the same handlers answer from the page by wrapping window.fetch. */
import { getResponse } from 'msw';
import type { HttpHandler } from 'msw';
import { setupWorker } from 'msw/browser';
import { CONTRACTS } from '../contracts/all.gen';
import type { EntityRecord } from '../contracts/types';
import { crudHandlers } from './handlers';
import { MOCK_STORAGE_PREFIX, mockedEntities } from './state';
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
  if (!contracts.length || typeof window === 'undefined') return false;
  const stores = new Map(contracts.map((c) => [c.name, new MockStore(c.plural, FIXTURES[`./fixtures/${c.plural}.json`] ?? [])]));
  const handlers = contracts.flatMap((c) => crudHandlers(c, stores.get(c.name)!, stores));
  const names = contracts.map((c) => c.plural).join(', ');
  try {
    if (!('serviceWorker' in navigator)) throw new Error('no service workers here');
    if (swFailed()) throw new Error('the service worker failed earlier in this tab');
    await setupWorker(...handlers).start({ onUnhandledRequest: 'bypass', quiet: true, serviceWorker: { url: '/mockServiceWorker.js' } });
    console.info(`[mocks] ${names} answered in the browser (MSW service worker; packages/shared/src/mocks)`);
  } catch (e) {
    // Some browsers can't register service workers (embedded panes, some private modes): answer from the page instead,
    // with the same handlers, by wrapping fetch. Everything the handlers don't match still goes to the network.
    swFailed(true);
    patchFetch(handlers);
    console.info(`[mocks] ${names} answered in the page (no service worker: ${e instanceof Error ? e.message.split('\n')[0] : e})`);
  }
  return true;
}

/** Remember (per tab) that the service worker can't register here, so later loads skip the attempt and its console
 *  error. */
function swFailed(set = false): boolean {
  const key = `${MOCK_STORAGE_PREFIX}no-service-worker`;
  try {
    if (set) sessionStorage.setItem(key, '1');
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function patchFetch(handlers: HttpHandler[]) {
  const network = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const mocked = await getResponse(handlers, request);
    return mocked ?? network(input, init);
  };
}

export { MockStore } from './store';
export { crudHandlers, callerOf } from './handlers';
