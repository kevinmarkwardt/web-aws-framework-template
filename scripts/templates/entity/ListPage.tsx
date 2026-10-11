// __Entities__: the list page (search, filters, sort, pages; the state lives in the URL so a filtered list can be shared).
// mine: the signed-in user's own __plural__ (owner user|both). Texts: locales/{lang}/entity-__plural__.json (__area__).
// #if userWrites
import { Link, useSearchParams } from 'react-router-dom';
// #else
import { useSearchParams } from 'react-router-dom';
// #endif
import { Empty, FieldValue, ListToolbar, Loading, Notice, Pager, useLoad, useTranslation } from '@yourapp/shared';
import type { ToolbarFilter } from '@yourapp/shared';
import { __contract__, isSortable } from '@yourapp/shared/contracts';
import { EntityCard, RefLink } from '../components';
import { entityHref } from '../paths';
import { __Shell__ as Shell } from '../shell';
import { __entities__Api } from './api';

/** Up to two fields under each card's name. */
const CARD_FIELDS = __contract__.fields
  .filter((f) => f.name !== __contract__.titleField && ['enum', 'ref', 'int', 'number', 'money', 'date'].includes(f.type))
  .slice(0, 2);
const FILTERS = __contract__.fields.filter((f) => f.type === 'enum' || f.type === 'bool');
const SORTS = __contract__.fields.filter(isSortable);

export default function __Entities__ListPage({ mine = false }: { mine?: boolean }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const sort = params.get('sort') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const filters = Object.fromEntries(FILTERS.map((f) => [f.name, params.get(f.name) ?? '']));
  const { data, error } = useLoad(() => __entities__Api.list({ q, sort, page, mine, filters }), [q, sort, page, mine, filters]);

  const field = (name: string) => t(`__area__.fields.${name}`);
  const value = (name: string, v: string) => t(`__area__.values.${name}.${v}`, { defaultValue: v });
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  const toolbarFilters: ToolbarFilter[] = FILTERS.map((f) => ({
    field: f.name, label: field(f.name), value: filters[f.name],
    options: f.type === 'bool' ? [['true', t('common.list.yes')], ['false', t('common.list.no')]] : (f.values ?? []).map((v) => [v, value(f.name, v)]),
  }));
  const filtered = !!(q || sort || Object.values(filters).some(Boolean));

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* #if userWrites */}
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{mine ? t('__area__.mine') : t('__area__.many')}</h1>
          {/* #else */}
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{t('__area__.many')}</h1>
          {/* #endif */}
          {data && <p className="mt-1 text-sm text-muted">{t('__area__.count', { count: data.total })}</p>}
        </div>
        {/* #if userWrites */}
        {mine && (
          <Link to={entityHref('__Entity__', 'create')} className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
            {t('__area__.new')}
          </Link>
        )}
        {/* #endif */}
      </div>

      <ListToolbar q={q} onSearch={(v) => set({ q: v })} placeholder={t('__area__.search')}
        sort={sort} onSort={(s) => set({ sort: s })} sortFields={SORTS.map((f) => [f.name, field(f.name)])}
        filters={toolbarFilters} onFilter={(f, v) => set({ [f]: v })}
        onClear={filtered ? () => setParams(new URLSearchParams()) : undefined} />

      <div className="mt-6">
        {error && <Notice tone="danger">{error}</Notice>}
        {!data && !error && <Loading />}
        {data && data.items.length === 0 && <Empty>{t('__area__.empty')}</Empty>}
        {data && data.items.length > 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((r) => (
              <EntityCard key={r.id} contract={__contract__} record={r} to={entityHref('__Entity__', 'detail', r.id)}
                details={CARD_FIELDS.length > 0 && (
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    {CARD_FIELDS.map((f) => (
                      <span key={f.name}>
                        <FieldValue field={f} value={r[f.name]} valueLabel={(v) => value(f.name, v)}
                          renderRef={(id) => <RefLink entity={f.ref ?? ''} id={id} plain />} />
                      </span>
                    ))}
                  </span>
                )} />
            ))}
          </div>
        )}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set({ page: String(p) })} />}
      </div>
    </Shell>
  );
}
