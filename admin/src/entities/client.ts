/** The admin site's entity API clients: entityApi on {adminPath} (every record, any owner) with this site's fetch.
 *  While an entity is mocked the browser mocks answer (the same handlers and fixtures as the user site's, but this
 *  origin's own localStorage copy). */
import { entityApi } from '@yourapp/shared';
import type { EntityApi } from '@yourapp/shared';
import type { EntityContract, EntityRecord } from '@yourapp/shared/contracts';
import { apiFetch } from '../api';
import { getToken } from '../auth';

export const adminEntityApi = <T = EntityRecord, I = Partial<T>>(c: EntityContract): EntityApi<T, I> =>
  entityApi<T, I>(c, { apiFetch, getToken, admin: true });
