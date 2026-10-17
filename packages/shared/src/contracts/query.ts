/** The list query both sides understand: ListQuery <-> URL search params, and the reference implementation of
 *  search, filter, sort and pagination over records (the browser mocks run it; api/lib/entities.py mirrors it). */
import type { EntityContract, EntityRecord, FieldMeta, ListQuery, Page } from './types';
import { MAX_PAGE_SIZE, isFilterable, isSearchable, isSortable } from './types';

/** "?q=..&sort=..&page=.." for a ListQuery ("" when empty). */
export function listSearch(q: ListQuery = {}): string {
  const p = new URLSearchParams();
  if (q.q) p.set('q', q.q);
  if (q.sort) p.set('sort', q.sort);
  if (q.page && q.page > 1) p.set('page', String(q.page));
  if (q.pageSize) p.set('pageSize', String(q.pageSize));
  if (q.mine) p.set('mine', '1');
  for (const [k, v] of Object.entries(q.filters ?? {})) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export class QueryError extends Error {
  field: string;
  constructor(message: string, field: string) {
    super(message);
    this.field = field;
  }
}

const RESERVED = new Set(['q', 'sort', 'page', 'pageSize', 'mine']);

function intParam(p: URLSearchParams, name: string, dflt: number, lo: number, hi: number): number {
  const raw = p.get(name);
  if (!raw) return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new QueryError(`${name} must be a whole number`, name);
  if (n < lo || n > hi) throw new QueryError(`${name} must be between ${lo} and ${hi}`, name);
  return n;
}

function matches(f: FieldMeta, value: unknown, want: string): boolean {
  if (f.type === 'tags') return Array.isArray(value) && value.some((t) => String(t).toLowerCase() === want.toLowerCase());
  if (f.type === 'bool') return String(value === true) === want;
  if (f.type === 'int' || f.type === 'number' || f.type === 'money') return Number(value) === Number(want);
  return String(value ?? '') === want;
}

function compare(a: unknown, b: unknown): number {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;  // empty values last either way
  if (empty(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'en', { sensitivity: 'base' });
}

/** Search, filter, sort and page `records` by the request's query string. `me` is the caller's user id (mine=1).
 *  Throws QueryError (a 400) for a bad page, page size, sort or filter. */
export function runQuery(c: EntityContract, records: EntityRecord[], p: URLSearchParams, me: string | null): Page<EntityRecord> {
  const byName = new Map(c.fields.map((f) => [f.name, f]));
  let rows = records;
  if (p.get('mine') === '1') rows = rows.filter((r) => me && r.ownerId === me);
  const q = (p.get('q') ?? '').trim().toLowerCase();
  if (q) {
    const fields = c.fields.filter(isSearchable);
    rows = rows.filter((r) => fields.some((f) => {
      const v = r[f.name];
      return Array.isArray(v) ? v.some((t) => String(t).toLowerCase().includes(q)) : String(v ?? '').toLowerCase().includes(q);
    }));
  }
  for (const [k, v] of p.entries()) {
    if (RESERVED.has(k) || v === '') continue;
    const f = byName.get(k);
    if (!f || !isFilterable(f)) throw new QueryError(`Can't filter by ${k}`, k);
    rows = rows.filter((r) => matches(f, r[k], v));
  }
  const sort = p.get('sort') || c.defaultSort;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  const sortable = key === 'createdAt' || key === 'updatedAt' || (byName.has(key) && isSortable(byName.get(key)!));
  if (!sortable) throw new QueryError(`Can't sort by ${key}`, 'sort');
  rows = [...rows].sort((a, b) => {
    const empty = (v: unknown) => v === null || v === undefined || v === '';
    if (empty(a[key]) !== empty(b[key])) return empty(a[key]) ? 1 : -1;  // empty values last, both directions
    const d = compare(a[key], b[key]);
    return (desc ? -d : d) || compare(a.id, b.id);
  });
  const pageSize = intParam(p, 'pageSize', c.pageSize, 1, MAX_PAGE_SIZE);
  const page = intParam(p, 'page', 1, 1, 100000);
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}
