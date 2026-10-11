/** One mocked entity's records: seeded from its fixture (mocks/fixtures/<plural>.json), kept in localStorage so
 *  creates, edits and deletes survive a reload. The saved copy carries the fixture's version (a hash of its JSON): when
 *  the fixture changes (gen-fixtures.py ran again) the store reseeds instead of serving stale records. Per browser:
 *  another browser, or the other site (a different origin), has its own copy. */
import type { EntityRecord } from '../contracts/types';
import { MOCK_STORAGE_PREFIX } from './state';

/** A short stable hash (FNV-1a) of a string. */
export function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export class MockStore {
  readonly key: string;
  readonly version: string;
  private readonly fixture: EntityRecord[];
  private rows: EntityRecord[] | null = null;

  constructor(plural: string, fixture: EntityRecord[]) {
    this.key = `${MOCK_STORAGE_PREFIX}${plural}`;
    this.fixture = fixture;
    this.version = hashOf(JSON.stringify(fixture));
  }

  all(): EntityRecord[] {
    if (this.rows) return this.rows;
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? 'null') as { version: string; rows: EntityRecord[] } | null;
      if (saved && saved.version === this.version && Array.isArray(saved.rows)) this.rows = saved.rows;
    } catch {
      // unreadable or blocked: start from the fixture
    }
    if (!this.rows) this.rows = structuredClone(this.fixture);
    return this.rows;
  }

  get(id: string): EntityRecord | undefined {
    return this.all().find((r) => r.id === id);
  }

  put(record: EntityRecord): EntityRecord {
    const rows = this.all();
    const i = rows.findIndex((r) => r.id === record.id);
    if (i === -1) rows.unshift(record);
    else rows[i] = record;
    this.save();
    return record;
  }

  remove(id: string): boolean {
    const rows = this.all();
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return false;
    rows.splice(i, 1);
    this.save();
    return true;
  }

  private save() {
    try {
      localStorage.setItem(this.key, JSON.stringify({ version: this.version, rows: this.rows }));
    } catch {
      // full or blocked: the change lasts until reload
    }
  }
}
