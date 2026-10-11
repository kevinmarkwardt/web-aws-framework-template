/** The MSW handlers for one entity, built from its contract's endpoint list: list (search, filters, sort, pages), get,
 *  create, update and delete, on the user API ({path}) and the admin API ({adminPath}). Answers and errors have the
 *  real API's shapes (contracts/types.ts), so pages built on these keep working when the backend replaces them. */
import { delay, http, HttpResponse } from 'msw';
import type { HttpHandler } from 'msw';
import { QueryError, runQuery } from '../contracts/query';
import type { EntityContract, EntityRecord, Endpoint } from '../contracts/types';
import { pickFields, validateBody } from '../contracts/validate';
import type { MockStore } from './store';
import { hashOf } from './store';

/** Pretend network time, so loading states show (ms). */
export const MOCK_LATENCY = 120;

function fail(status: number, code: string, message: string, field?: string) {
  return HttpResponse.json({ error: message, message, code, ...(field ? { field } : {}) }, { status });
}

/** Who is calling: the user id in the Bearer token (Cognito or test-login JWT: `sub`), 'mock-user' for MOCK_AUTH's
 *  token, null when signed out. Nothing is verified: these are mocks. */
export function callerOf(request: Request): string | null {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  if (token === 'mock-token') return 'mock-user';
  const parts = token.split('.');
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
      const id = claims.sub ?? claims['cognito:username'] ?? claims.username;
      if (typeof id === 'string' && id) return id;
    } catch {
      // not a JWT after all
    }
  }
  return `user-${hashOf(token)}`;
}

let seq = 0;
const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Handlers for `contract`, reading and writing `store`. `stores` (every mocked entity) checks ref ids. */
export function crudHandlers(contract: EntityContract, store: MockStore, stores: Map<string, MockStore>): HttpHandler[] {
  const notFound = () => fail(404, 'NOT_FOUND', `${contract.name} not found`);

  const badRef = (data: Record<string, unknown>) => {
    for (const f of contract.fields) {
      if (f.type !== 'ref' || !f.ref || data[f.name] === undefined || data[f.name] === null) continue;
      const target = stores.get(f.ref);
      if (target && !target.get(String(data[f.name]))) return fail(400, 'BAD_REQUEST', `${f.name}: no ${f.ref} with that id`, f.name);
    }
    return null;
  };

  const guard = (ep: Endpoint, me: string | null) => {
    if (ep.access === 'public') return null;
    if (!me) return fail(401, 'SIGNED_OUT', 'Sign in first');
    return null;
  };

  const handler = (ep: Endpoint): HttpHandler => {
    const method = { GET: http.get, POST: http.post, PUT: http.put, DELETE: http.delete }[ep.method];
    return method(ep.path, async ({ request, params }) => {
      await delay(MOCK_LATENCY);
      const me = callerOf(request);
      const refused = guard(ep, me);
      if (refused) return refused;
      const id = typeof params.id === 'string' ? params.id : '';
      const existing = id ? store.get(id) : undefined;
      // the user API: someone else's record (owner endpoints) is "not found", never "forbidden"
      const ownerOk = (r: EntityRecord | undefined) => ep.access !== 'owner' || (r && r.ownerId === me);

      switch (ep.op) {
        case 'list':
          try {
            return HttpResponse.json(runQuery(contract, store.all(), new URL(request.url).searchParams, me));
          } catch (e) {
            if (e instanceof QueryError) return fail(400, 'BAD_REQUEST', e.message, e.field);
            throw e;
          }
        case 'get':
          return existing && ownerOk(existing) ? HttpResponse.json(existing) : notFound();
        case 'create': {
          const body = await jsonBody(request);
          const problem = validateBody(contract, body, false);
          if (problem) return fail(400, 'BAD_REQUEST', problem.message, problem.field || undefined);
          const data = pickFields(contract, body as Record<string, unknown>);
          const ref = badRef(data);
          if (ref) return ref;
          const now = new Date().toISOString();
          const record: EntityRecord = {
            id: newId(), createdAt: now, updatedAt: now, ...data,
            ...(contract.owner !== 'site' ? { ownerId: ep.access === 'admin' ? null : me } : {}),
          };
          return HttpResponse.json(store.put(record), { status: 201 });
        }
        case 'update': {
          if (!existing || !ownerOk(existing)) return notFound();
          const body = await jsonBody(request);
          const problem = validateBody(contract, body, true);
          if (problem) return fail(400, 'BAD_REQUEST', problem.message, problem.field || undefined);
          const data = pickFields(contract, body as Record<string, unknown>);
          const ref = badRef(data);
          if (ref) return ref;
          return HttpResponse.json(store.put({ ...existing, ...data, updatedAt: new Date().toISOString() }));
        }
        case 'delete':
          if (!existing || !ownerOk(existing)) return notFound();
          store.remove(existing.id);
          return HttpResponse.json({ deleted: true });
        default:
          return notFound();
      }
    });
  };

  return contract.endpoints.map(handler);
}
