/** The user site's entity API clients: entityApi (packages/shared/src/entities/client.ts) with this site's fetch (token,
 *  sign-in redirect). Generated pages call `siteApi<Recipe, RecipeInput>(recipeContract)` through their api.ts. */
import { entityApi } from '@yourapp/shared';
import type { EntityApi } from '@yourapp/shared';
import type { EntityContract, EntityRecord } from '@yourapp/shared/contracts';
import { apiFetch } from '../api';
import { getToken } from '../auth';

export const siteApi = <T = EntityRecord, I = Partial<T>>(c: EntityContract): EntityApi<T, I> =>
  entityApi<T, I>(c, { apiFetch, getToken });
