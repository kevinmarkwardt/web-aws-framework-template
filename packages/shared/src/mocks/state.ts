/** Mock state the sites may read in any build (no MSW import here, so production bundles stay MSW-free): which
 *  entities are mocked and the demo-data reset. MSW itself starts from ./browser.ts, imported only when
 *  VITE_STAGE !== 'prod'. */
import { MOCKS } from './mocks.config';

/** localStorage keys of the mock records: `${MOCK_STORAGE_PREFIX}<plural>`. */
export const MOCK_STORAGE_PREFIX = 'yourapp-mock:';

/** The entities answered by the browser mocks in this build (none in production). */
export function mockedEntities(): string[] {
  if (import.meta.env.VITE_STAGE === 'prod') return [];
  return Object.entries(MOCKS).filter(([, on]) => on).map(([plural]) => plural);
}

export const mocksOn = (): boolean => mockedEntities().length > 0;

/** Forget every change made to the mock data in this browser (the fixtures come back) and reload the page. */
export function resetDemoData(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(MOCK_STORAGE_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // storage blocked: nothing was saved either
  }
  window.location.reload();
}
