/** Entity contracts: the one description of a domain entity that the browser mocks (packages/shared/src/mocks), the
 *  generated pages and admin tab, and the real backend (api/lib/entities.py, scripts/new-entity.py --backend) all
 *  implement. Each entity's contract is packages/shared/src/contracts/<entity>.ts, written by scripts/new-entity.py from
 *  site.spec.yaml; this file is the shape they share.
 *
 *  The HTTP contract every entity follows (mocks and backend alike):
 *    GET    {path}?q=&sort=&page=&pageSize=&mine=1&<field>=<value>  -> Page<T>  (public when contract.public)
 *    GET    {path}/{id}                                             -> T        (404 NOT_FOUND)
 *    POST   {path}            (owner user|both, signed in)          -> T, 201   (400 BAD_REQUEST, field)
 *    PUT    {path}/{id}       (owner user|both, the record's owner) -> T        (partial update)
 *    DELETE {path}/{id}       (owner user|both, the record's owner) -> { deleted: true }
 *    the same five under {adminPath} for the admin site (every record, any owner)
 *  Errors are the API's usual shape: { error: English, message: shown to the user, code, field? }. */

export type FieldType =
  | 'string' | 'text' | 'int' | 'number' | 'money' | 'bool' | 'date' | 'datetime' | 'enum' | 'image' | 'url' | 'email'
  | 'tags' | 'ref';

export interface FieldMeta {
  name: string;
  type: FieldType;
  required?: boolean;
  /** enum: the allowed values; tags: suggestions */
  values?: string[];
  /** ref: the entity name (PascalCase) the value is an id of */
  ref?: string;
  /** what the data looks like (gen-fixtures and form placeholders) */
  hint?: string;
}

export type EntityOp = 'list' | 'get' | 'create' | 'update' | 'delete';
/** public: anyone; user: signed in; owner: the record's owner; admin: the admin API */
export type Access = 'public' | 'user' | 'owner' | 'admin';

export interface Endpoint {
  op: EntityOp;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** '/api/recipes' or '/api/recipes/:id' */
  path: string;
  access: Access;
}

export interface EntityContract {
  /** PascalCase singular (spec entities[].name) */
  name: string;
  /** URL slug and mock/storage key (spec entities[].plural) */
  plural: string;
  /** who creates records: site (admins), user (signed-in users own theirs), both */
  owner: 'site' | 'user' | 'both';
  /** anyone may list and read (no sign-in) */
  public: boolean;
  /** the field that names a record (cards, links, the admin table) */
  titleField: string;
  /** the first image field, if any (cards) */
  imageField?: string;
  fields: FieldMeta[];
  /** '/api/recipes' */
  path: string;
  /** '/api/admin/recipes' */
  adminPath: string;
  endpoints: Endpoint[];
  /** default sort: a field name, '-' first for descending */
  defaultSort: string;
  pageSize: number;
}

/** What every record has besides its fields. `ownerId` only for owner user|both. */
export interface EntityBase {
  id: string;
  createdAt: string;
  updatedAt: string;
  ownerId?: string | null;
}

export type EntityRecord = EntityBase & { [field: string]: unknown };

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListQuery {
  q?: string;
  /** a field name, '-' first for descending */
  sort?: string;
  page?: number;
  pageSize?: number;
  /** only the signed-in user's records (owner user|both) */
  mine?: boolean;
  /** field -> value: enum, ref, bool, int and number equal; tags contains */
  filters?: Record<string, string | number | boolean | null | undefined>;
}

export const SYSTEM_FIELDS = ['id', 'createdAt', 'updatedAt', 'ownerId'] as const;
export const MAX_PAGE_SIZE = 100;

export const isSearchable = (f: FieldMeta) => ['string', 'text', 'email', 'url', 'tags'].includes(f.type);
export const isFilterable = (f: FieldMeta) => ['enum', 'ref', 'bool', 'tags', 'int'].includes(f.type);
export const isSortable = (f: FieldMeta) =>
  ['string', 'int', 'number', 'money', 'date', 'datetime', 'enum', 'bool', 'email'].includes(f.type);

/** A record's display name. */
export const titleOf = (c: EntityContract, r: EntityRecord | null | undefined): string =>
  r ? String(r[c.titleField] ?? r.id) : '';
