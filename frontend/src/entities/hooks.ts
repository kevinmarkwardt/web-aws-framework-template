import { useLoad } from '@yourapp/shared';
import { contractByName, titleOf } from '@yourapp/shared/contracts';
import type { FieldMeta } from '@yourapp/shared/contracts';
import { siteApi } from './client';

/** [id, name] choices for each ref field's select, by referenced entity (its first 100 records by name). */
export function useRefOptions(fields: FieldMeta[]): Record<string, [string, string][]> {
  const refs = [...new Set(fields.filter((f) => f.type === 'ref' && f.ref).map((f) => f.ref!))];
  const { data } = useLoad(async () => {
    const out: Record<string, [string, string][]> = {};
    for (const name of refs) {
      const c = contractByName(name);
      if (!c) continue;
      const page = await siteApi(c).list({ pageSize: 100, sort: c.titleField });
      out[name] = page.items.map((r) => [r.id, titleOf(c, r)]);
    }
    return out;
  }, [refs.join(',')]);
  return data ?? {};
}
