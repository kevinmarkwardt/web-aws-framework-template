/** Body checks for create (every required field) and update (only the fields sent). The browser mocks use this; the
 *  backend's api/lib/entities.py applies the same rules, so a page that works on mocks works on the real API. */
import type { EntityContract, FieldMeta } from './types';
import { SYSTEM_FIELDS } from './types';

export interface FieldError {
  field: string;
  /** English, with {field} already filled in */
  message: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URLISH = /^(https?:\/\/|\/)\S+$/;
export const LIMITS = { string: 200, text: 5000, tags: 20, tag: 40 };

function empty(v: unknown) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** null when `value` fits the field, else what is wrong. */
export function checkField(f: FieldMeta, value: unknown): string | null {
  if (value === null) return null;
  switch (f.type) {
    case 'string': case 'text': {
      if (typeof value !== 'string') return `${f.name} must be text`;
      const max = f.type === 'string' ? LIMITS.string : LIMITS.text;
      return value.length > max ? `${f.name} must be at most ${max} characters` : null;
    }
    case 'email': return typeof value === 'string' && EMAIL.test(value) ? null : `${f.name} must be an email address`;
    case 'url': case 'image': return typeof value === 'string' && URLISH.test(value) ? null : `${f.name} must be a URL`;
    case 'int': return Number.isInteger(value) ? null : `${f.name} must be a whole number`;
    case 'money': return Number.isInteger(value) ? null : `${f.name} must be whole cents`;
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? null : `${f.name} must be a number`;
    case 'bool': return typeof value === 'boolean' ? null : `${f.name} must be true or false`;
    case 'date': return typeof value === 'string' && DATE.test(value) ? null : `${f.name} must be a date (YYYY-MM-DD)`;
    case 'datetime': return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? null : `${f.name} must be a date and time`;
    case 'enum': return typeof value === 'string' && (f.values ?? []).includes(value) ? null : `${f.name} must be one of ${(f.values ?? []).join(', ')}`;
    case 'ref': return typeof value === 'string' && value.length > 0 && value.length <= 64 ? null : `${f.name} must be an id`;
    case 'tags':
      if (!Array.isArray(value) || !value.every((t) => typeof t === 'string' && t.length > 0 && t.length <= LIMITS.tag)) {
        return `${f.name} must be a list of short words`;
      }
      return value.length > LIMITS.tags ? `${f.name} takes at most ${LIMITS.tags}` : null;
    default: return null;
  }
}

/** The first problem with a request body, or null. `partial`: an update (only the fields sent are checked). */
export function validateBody(c: EntityContract, body: unknown, partial: boolean): FieldError | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { field: '', message: 'The body must be a JSON object' };
  const data = body as Record<string, unknown>;
  const known = new Set(c.fields.map((f) => f.name));
  for (const k of Object.keys(data)) {
    if ((SYSTEM_FIELDS as readonly string[]).includes(k)) continue;  // ignored, never written from a body
    if (!known.has(k)) return { field: k, message: `Unknown field: ${k}` };
  }
  for (const f of c.fields) {
    const present = Object.prototype.hasOwnProperty.call(data, f.name);
    if (f.required && (partial ? present && empty(data[f.name]) : empty(data[f.name]))) {
      return { field: f.name, message: `${f.name} is required` };
    }
    if (present && !empty(data[f.name])) {
      const problem = checkField(f, data[f.name]);
      if (problem) return { field: f.name, message: problem };
    }
  }
  return null;
}

/** The body's fields only (system fields dropped), empty strings as null. */
export function pickFields(c: EntityContract, body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of c.fields) {
    if (Object.prototype.hasOwnProperty.call(body, f.name)) out[f.name] = body[f.name] === '' ? null : body[f.name];
  }
  return out;
}
