/** The fetch core both sites use: Bearer token, JSON in and out, and the API's error shape
 *  ({"error": message, "code"?: machine-readable reason}, api/lib/response.py) turned into an ApiError. */

/** An API refusal with the server's machine-readable code (MAINTENANCE, SIGNUPS_CLOSED, PLAN_LIMIT, NOT_ADMIN,
 *  REASON_REQUIRED, ...) and, for a card charge, its outcome ("unknown": resend with the same requestId; "declined":
 *  nothing was charged). */
export class ApiError extends Error {
  status: number;
  code?: string;
  outcome?: 'unknown' | 'declined';
  constructor(message: string, status: number, code?: string, outcome?: 'unknown' | 'declined') {
    super(message);
    this.status = status;
    this.code = code;
    this.outcome = outcome;
  }
}

/** Codes the API answers with; apps branch on these rather than on messages. */
export const ErrorCodes = {
  MAINTENANCE: 'MAINTENANCE',
  SIGNUPS_CLOSED: 'SIGNUPS_CLOSED',
  SIGNED_OUT: 'SIGNED_OUT',
  NOT_ADMIN: 'NOT_ADMIN',
  REASON_REQUIRED: 'REASON_REQUIRED',
  PLAN_LIMIT: 'PLAN_LIMIT',
  ACCOUNT_RESTRICTED: 'ACCOUNT_RESTRICTED',
} as const;

export interface ApiClientOptions {
  /** The signed-in user's ID token, or null. */
  getToken: () => Promise<string | null>;
  /** Called when there is no token or the API answers 401 (e.g. go to the sign-in page). The call still throws. */
  onUnauthorized?: () => void;
  /** Path prefix (default /api: CloudFront, or Vite's dev proxy, sends it to the Lambda). */
  base?: string;
  /** Local development without a backend (MOCK_AUTH): answer from here; return undefined to use the network. */
  mock?: (path: string, init: RequestInit) => Promise<unknown> | undefined;
}

export type ApiFetch = <T>(path: string, init?: RequestInit) => Promise<T>;

export function createApiClient(opts: ApiClientOptions): ApiFetch {
  const base = opts.base ?? '/api';
  return async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const mocked = opts.mock?.(path, init);
    if (mocked !== undefined) return (await mocked) as T;

    const token = await opts.getToken();
    if (!token) {
      opts.onUnauthorized?.();
      throw new ApiError('Not signed in', 401, ErrorCodes.SIGNED_OUT);
    }
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      opts.onUnauthorized?.();
      throw new ApiError(body.error || 'Your session has expired. Sign in again.', 401, body.code ?? ErrorCodes.SIGNED_OUT);
    }
    if (!res.ok) {
      const message = body.error || body.message;
      if (message) throw new ApiError(message, res.status, body.code, body.outcome);
      if (res.status >= 500) throw new ApiError('Something went wrong on our end. Please try again in a few minutes.', res.status);
      throw new ApiError(`Request failed (${res.status})`, res.status);
    }
    return body as T;
  };
}

/** RequestInit helpers: post(body), put(body), del(body). */
export const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });
export const del = (body?: unknown): RequestInit => ({ method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) });

/** "?a=1&b=x" from the defined, non-empty values ("" when none). */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
