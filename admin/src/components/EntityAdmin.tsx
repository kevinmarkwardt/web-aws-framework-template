/** An entity's admin tab, from its contract: search, filters and pages over every record, a drawer with the record's
 *  fields, and create / edit / delete. The tabs scripts/new-entity.py writes (tabs/entities/<Plural>Tab.tsx) render
 *  this with their texts; give an entity its own tab component when it needs more. */
import { useEffect, useState } from 'react';
import {
  Button, DataTable, Dialog, Drawer, Field, FieldInput, FieldValue, ListToolbar, Loading, Notice, PageHeader, Pager, Panel,
  dateTime, useLoad, useTranslation,
} from '@yourapp/shared';
import type { Column, ToolbarFilter } from '@yourapp/shared';
import { contractByName, isFilterable, isSortable, titleOf } from '@yourapp/shared/contracts';
import type { EntityContract, EntityRecord, FieldMeta } from '@yourapp/shared/contracts';
import { adminEntityApi } from '../entities/client';

export interface EntityAdminTexts {
  title: string;
  subtitle?: string;
  search: string;
  empty: string;
  create: string;
  edit: string;
  confirmDelete: (name: string) => string;
  field: (name: string) => string;
  value: (field: string, value: string) => string;
}

const names = new Map<string, Promise<string>>();

/** A referenced record's name (admin API, cached for the page's life). */
function RefName({ entity, id }: { entity: string; id: string }) {
  const [name, setName] = useState(id);
  useEffect(() => {
    const c = contractByName(entity);
    if (!c) return;
    const key = `${entity}:${id}`;
    if (!names.has(key)) names.set(key, adminEntityApi(c).get(id).then((r) => titleOf(c, r), () => id));
    let live = true;
    names.get(key)!.then((n) => live && setName(n));
    return () => {
      live = false;
    };
  }, [entity, id]);
  return <span>{name}</span>;
}

/** [id, name] choices for a ref field's select (the first 100 records by name). */
function useRefOptions(fields: FieldMeta[]) {
  const refs = fields.filter((f) => f.type === 'ref' && f.ref).map((f) => f.ref!);
  const { data } = useLoad(async () => {
    const out: Record<string, [string, string][]> = {};
    for (const name of [...new Set(refs)]) {
      const c = contractByName(name);
      if (!c) continue;
      const page = await adminEntityApi(c).list({ pageSize: 100, sort: c.titleField });
      out[name] = page.items.map((r) => [r.id, titleOf(c, r)]);
    }
    return out;
  }, [refs.join(',')]);
  return data ?? {};
}

function RecordForm({ contract, record, texts, onSaved, onCancel }: {
  contract: EntityContract; record: EntityRecord | null; texts: EntityAdminTexts; onSaved: (r: EntityRecord) => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(contract.fields.map((f) => [f.name, record?.[f.name] ?? (f.type === 'tags' ? [] : null)])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refOptions = useRefOptions(contract.fields);
  const api = adminEntityApi(contract);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== null && v !== ''));
      onSaved(record ? await api.update(record.id, { ...draft }) : await api.create(body));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  return (
    <form onSubmit={save} className="space-y-4">
      {error && <Notice tone="danger">{error}</Notice>}
      {contract.fields.map((f) => (
        <Field key={f.name} label={`${texts.field(f.name)}${f.required ? ' *' : ''}`}>
          <FieldInput field={f} value={draft[f.name]} onChange={(v) => setDraft((d) => ({ ...d, [f.name]: v }))}
            valueLabel={(v) => texts.value(f.name, v)} refOptions={f.ref ? refOptions[f.ref] : undefined} />
        </Field>
      ))}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t('admin.actions.cancel')}</Button>
        <Button type="submit" variant="primary" busy={busy}>{t('admin.actions.save')}</Button>
      </div>
    </form>
  );
}

export default function EntityAdmin({ contract, texts }: { contract: EntityContract; texts: EntityAdminTexts }) {
  const { t } = useTranslation();
  const api = adminEntityApi(contract);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const { data, error, reload } = useLoad(() => api.list({ q, sort, page, filters }), [contract.name, q, sort, page, filters]);
  const [open, setOpen] = useState<EntityRecord | 'new' | null>(null);
  const [editing, setEditing] = useState(false);
  const [doomed, setDoomed] = useState<EntityRecord | null>(null);

  const value = (f: FieldMeta, r: EntityRecord) => (
    <FieldValue field={f} value={r[f.name]} valueLabel={(v) => texts.value(f.name, v)}
      renderRef={(id) => <RefName entity={f.ref ?? ''} id={id} />} />
  );
  const shown = contract.fields.filter((f) => f.name !== contract.titleField && !['text', 'image', 'tags'].includes(f.type)).slice(0, 3);
  const columns: Column<EntityRecord>[] = [
    { key: contract.titleField, header: texts.field(contract.titleField), render: (r) => <span className="font-medium">{titleOf(contract, r)}</span> },
    ...shown.map((f) => ({ key: f.name, header: texts.field(f.name), render: (r: EntityRecord) => value(f, r), numeric: ['int', 'number', 'money'].includes(f.type) })),
    { key: 'createdAt', header: t('admin.entities.created'), render: (r) => <span className="whitespace-nowrap text-muted">{dateTime(r.createdAt)}</span> },
  ];
  const toolbarFilters: ToolbarFilter[] = contract.fields.filter((f) => isFilterable(f) && (f.type === 'enum' || f.type === 'bool')).map((f) => ({
    field: f.name, label: texts.field(f.name), value: filters[f.name] ?? '',
    options: f.type === 'bool' ? [['true', t('common.list.yes')], ['false', t('common.list.no')]] : (f.values ?? []).map((v) => [v, texts.value(f.name, v)]),
  }));
  const record = open && open !== 'new' ? open : null;

  return (
    <div>
      <PageHeader title={texts.title} subtitle={texts.subtitle}
        actions={<Button variant="primary" onClick={() => { setOpen('new'); setEditing(true); }}>{texts.create}</Button>} />
      <Panel padded={false}>
        <div className="border-b border-line p-3">
          <ListToolbar q={q} onSearch={(v) => { setQ(v); setPage(1); }} placeholder={texts.search}
            sort={sort} onSort={(s) => { setSort(s); setPage(1); }}
            sortFields={contract.fields.filter(isSortable).map((f) => [f.name, texts.field(f.name)])}
            filters={toolbarFilters} onFilter={(f, v) => { setFilters((x) => ({ ...x, [f]: v })); setPage(1); }}
            onClear={q || sort || Object.values(filters).some(Boolean) ? () => { setQ(''); setSort(''); setFilters({}); setPage(1); } : undefined} />
        </div>
        {error && <Notice tone="danger" className="m-3">{error}</Notice>}
        {!data ? <Loading /> : (
          <>
            <DataTable rows={data.items} rowKey={(r) => r.id} columns={columns} empty={texts.empty}
              onRowClick={(r) => { setOpen(r); setEditing(false); }} selected={record?.id ?? null} />
            <div className="px-3"><Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></div>
          </>
        )}
      </Panel>

      <Drawer open={!!open} onClose={() => setOpen(null)}
        title={open === 'new' ? texts.create : editing ? texts.edit : titleOf(contract, record)}
        actions={record && !editing ? (
          <>
            <Button size="sm" onClick={() => setEditing(true)}>{t('admin.entities.edit')}</Button>
            <Button size="sm" variant="danger" onClick={() => setDoomed(record)}>{t('admin.actions.delete')}</Button>
          </>
        ) : undefined}>
        {open && editing && (
          <RecordForm key={record?.id ?? 'new'} contract={contract} record={record} texts={texts}
            onCancel={() => (record ? setEditing(false) : setOpen(null))}
            onSaved={(r) => { setOpen(r); setEditing(false); reload(); }} />
        )}
        {record && !editing && (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-[10rem_1fr]">
            {contract.fields.map((f) => (
              <div key={f.name} className="contents">
                <dt className="text-sm font-medium text-muted">{texts.field(f.name)}</dt>
                <dd className="text-sm text-ink">{value(f, record)}</dd>
              </div>
            ))}
            <dt className="text-sm font-medium text-muted">{t('admin.entities.id')}</dt>
            <dd className="font-mono text-xs text-ink">{record.id}</dd>
            {contract.owner !== 'site' && (
              <>
                <dt className="text-sm font-medium text-muted">{t('admin.entities.owner')}</dt>
                <dd className="font-mono text-xs text-ink">{record.ownerId ?? t('admin.entities.site')}</dd>
              </>
            )}
            <dt className="text-sm font-medium text-muted">{t('admin.entities.created')}</dt>
            <dd className="text-sm text-ink">{dateTime(record.createdAt)}</dd>
            <dt className="text-sm font-medium text-muted">{t('admin.entities.updated')}</dt>
            <dd className="text-sm text-ink">{dateTime(record.updatedAt)}</dd>
          </dl>
        )}
      </Drawer>

      <Dialog open={!!doomed} title={texts.confirmDelete(titleOf(contract, doomed))} onClose={() => setDoomed(null)}
        footer={(
          <>
            <Button onClick={() => setDoomed(null)}>{t('admin.actions.cancel')}</Button>
            <Button variant="danger" onClick={async () => {
              if (doomed) await api.remove(doomed.id);
              setDoomed(null);
              setOpen(null);
              reload();
            }}>{t('admin.actions.delete')}</Button>
          </>
        )}>
        <p className="text-sm text-muted">{titleOf(contract, doomed)}</p>
      </Dialog>
    </div>
  );
}
