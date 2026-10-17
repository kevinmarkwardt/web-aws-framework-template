// __Entities__: the list page, on the Browse archetype (search, filters, sort, grid/list, pages; the state lives in the
// URL so a filtered list can be shared). Change the layout with Browse's props (filtersAt, columns, view) or the card
// with EntityCard's (layout, imageRatio): the design direction picks them. mine: the signed-in user's own __plural__
// (owner user|both). Texts: locales/{lang}/entity-__plural__.json (__area__).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FieldValue, useLoad, useTranslation } from '@yourapp/shared';
import { Browse, EntityCard, EntityRow } from '@yourapp/shared/archetypes';
import type { BrowseView } from '@yourapp/shared/archetypes';
import { __contract__, isSortable, titleOf } from '@yourapp/shared/contracts';
import { RefLink } from '../components';
import { entityHref } from '../paths';
import { __Shell__ as Shell } from '../shell';
import { __entities__Api } from './api';

/** Up to two fields under each card's name. */
const CARD_FIELDS = __contract__.fields
  .filter((f) => f.name !== __contract__.titleField && ['enum', 'ref', 'int', 'number', 'money', 'date'].includes(f.type))
  .slice(0, 2);
const FILTERS = __contract__.fields.filter((f) => f.type === 'enum' || f.type === 'bool');
const SORTS = __contract__.fields.filter(isSortable);
const IMAGE = __contract__.imageField;

export default function __Entities__ListPage({ mine = false }: { mine?: boolean }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<BrowseView>('grid');
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
  const meta = (r: Record<string, unknown>) => CARD_FIELDS.map((f) => ({
    label: field(f.name),
    value: <FieldValue field={f} value={r[f.name]} valueLabel={(v) => value(f.name, v)}
      renderRef={(id) => <RefLink entity={f.ref ?? ''} id={id} plain />} />,
  }));

  return (
    <Shell>
      <Browse
        // #if userWrites
        title={mine ? t('__area__.mine') : t('__area__.many')}
        // #else
        title={t('__area__.many')}
        // #endif
        subtitle={data ? t('__area__.count', { count: data.total }) : undefined}
        query={q} onQuery={(v) => set({ q: v })} searchPlaceholder={t('__area__.search')}
        filters={FILTERS.map((f) => ({
          id: f.name,
          label: field(f.name),
          value: filters[f.name] ? [filters[f.name]] : [],
          onChange: (v: string[]) => set({ [f.name]: v[0] ?? '' }),
          options: f.type === 'bool'
            ? [{ value: 'true', label: t('common.list.yes') }, { value: 'false', label: t('common.list.no') }]
            : (f.values ?? []).map((v) => ({ value: v, label: value(f.name, v) })),
        }))}
        sort={sort} onSort={(s) => set({ sort: s })}
        sortOptions={SORTS.length ? [{ value: '', label: t('common.list.newest') }, ...SORTS.map((f) => ({ value: f.name, label: field(f.name) }))] : []}
        view={view} onView={setView}
        items={data?.items ?? []} itemKey={(r) => r.id}
        renderCard={(r) => (
          <EntityCard href={entityHref('__Entity__', 'detail', r.id)} title={titleOf(__contract__, r)}
            image={IMAGE ? (r[IMAGE] as string | null) : undefined} meta={meta(r)} layout={IMAGE ? 'stacked' : 'text'} />
        )}
        renderRow={(r) => (
          <EntityRow href={entityHref('__Entity__', 'detail', r.id)} title={titleOf(__contract__, r)}
            image={IMAGE ? (r[IMAGE] as string | null) : undefined} meta={meta(r)} />
        )}
        total={data?.total} page={data?.page ?? page} pageSize={data?.pageSize} onPage={(p) => set({ page: String(p) })}
        loading={!data && !error} error={error ?? undefined}
        // #if userWrites
        empty={{ title: t('__area__.empty'), action: mine ? { label: t('__area__.new'), href: entityHref('__Entity__', 'create') } : undefined }}
        // #else
        empty={{ title: t('__area__.empty') }}
        // #endif
      />
    </Shell>
  );
}
