/** An entity's API client from its contract (contracts/types.ts has the HTTP contract). Each site passes its own fetch
 *  (token, sign-in redirect): frontend/src/entities/client.ts and admin/src/entities/client.ts. The same calls reach the
 *  browser mocks (MSW) while the entity is mocked and the real API once its backend exists: pages never change. */
import { del, post, publicGet, put } from '../api';
import type { ApiFetch } from '../api';
import { listSearch } from '../contracts/query';
import type { EntityContract, EntityRecord, ListQuery, Page } from '../contracts/types';

export interface EntityApi<T, I> {
  list: (q?: ListQuery) => Promise<Page<T>>;
  get: (id: string) => Promise<T>;
  create: (data: I) => Promise<T>;
  update: (id: string, data: Partial<I>) => Promise<T>;
  remove: (id: string) => Promise<{ deleted: boolean }>;
}

export interface EntityApiOptions {
  apiFetch: ApiFetch;
  getToken: () => Promise<string | null>;
  /** the admin site: {adminPath}, every record */
  admin?: boolean;
}

export function entityApi<T = EntityRecord, I = Partial<T>>(c: EntityContract, opts: EntityApiOptions): EntityApi<T, I> {
  const base = (opts.admin ? c.adminPath : c.path).replace(/^\/api/, '');
  const one = (id: string) => `${base}/${encodeURIComponent(id)}`;
  // public entities: reads work signed out (the token goes along when there is one)
  const read = <R>(path: string) => (!opts.admin && c.public ? publicGet<R>(path, opts.getToken) : opts.apiFetch<R>(path));
  return {
    list: (q) => read<Page<T>>(`${base}${listSearch(q)}`),
    get: (id) => read<T>(one(id)),
    create: (data) => opts.apiFetch<T>(base, post(data)),
    update: (id, data) => opts.apiFetch<T>(one(id), put(data)),
    remove: (id) => opts.apiFetch<{ deleted: boolean }>(one(id), del()),
  };
}
