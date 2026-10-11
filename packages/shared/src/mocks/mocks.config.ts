/** Which entities the browser mocks answer (MSW, in dev and test builds only; packages/shared/src/mocks/browser.ts).
 *  Keys are the entities' plurals (spec entities[].plural). scripts/new-entity.py adds `plural: true` here;
 *  scripts/new-entity.py --backend <Entity> sets it to false once the real API route exists. Pages don't change either
 *  way: they call the same /api/<plural> URLs.
 *
 *  A production build (VITE_STAGE=prod) fails while any entity here is true (packages/shared/vite/mockGuard.ts). */
export const MOCKS: Record<string, boolean> = {
  // entities:begin (scripts/new-entity.py keeps one line per entity here)
  // entities:end
};
