/** Where each entity's pages live (routes.gen.ts ENTITY_PATHS, written by scripts/new-entity.py) and the i18n area of
 *  its texts (locales/{lang}/entity-<plural>.json -> "entity<Plural>"). */
import type { EntityContract } from '@yourapp/shared/contracts';
import { ENTITY_PATHS } from './routes.gen';

export interface EntityPaths {
  /** the list page ('/recipes', or '/dashboard/notes' for a signed-in-only entity) */
  list: string;
  /** the detail page, with ':id' */
  detail: string;
  /** owner user|both: the signed-in user's own records, the create and the edit form (':id') */
  mine?: string;
  create?: string;
  edit?: string;
}

/** The page of entity `name` (PascalCase), with `id` filled in; '' when the entity has no such page. */
export function entityHref(name: string, page: keyof EntityPaths, id?: string): string {
  const path = ENTITY_PATHS[name]?.[page];
  if (!path) return '';
  return id === undefined ? path : path.replace(':id', encodeURIComponent(id));
}

/** "entityMenuItems" for plural "menu-items": the i18n area of an entity's site texts. */
export const siteArea = (c: EntityContract) =>
  `entity${c.plural.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`;
