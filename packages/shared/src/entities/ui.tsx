/** Plain building blocks for entity pages, driven by a contract's field metadata: how one field's value shows
 *  (FieldValue), how it is edited (FieldInput), a picture with a fallback (EntityImage) and paging (Pager). The pages
 *  scripts/new-entity.py writes use them; restyle freely, or swap the pages for the archetypes. Texts: common.list.* */
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { FieldMeta } from '../contracts/types';
import { shortDate, dateTime, num, usd } from '../format';
import { Button, Input, Select, Textarea, Toggle } from '../ui';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** A picture, or a quiet tile with the first letter when there is none (or it fails to load). */
export function EntityImage({ src, alt, className }: { src?: unknown; alt: string; className?: string }) {
  const url = typeof src === 'string' && src ? src : '';
  return url ? (
    <img src={url} alt={alt} loading="lazy" className={cx('h-full w-full object-cover', className)}
      onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
  ) : (
    <div aria-hidden className={cx('flex h-full w-full items-center justify-center bg-raised text-3xl font-semibold text-faint', className)}>
      {alt.trim().charAt(0).toUpperCase() || '·'}
    </div>
  );
}

/** One field's value for reading. `valueLabel` translates enum values; `renderRef` draws a ref (a link, a name). */
export function FieldValue({ field, value, valueLabel, renderRef }: {
  field: FieldMeta; value: unknown; valueLabel?: (v: string) => string; renderRef?: (id: string) => ReactNode;
}) {
  const { t } = useTranslation();
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
    return <span className="text-faint">{t('common.list.none')}</span>;
  }
  switch (field.type) {
    case 'money': return <span className="tabular-nums">{usd(Number(value))}</span>;
    case 'int': case 'number': return <span className="tabular-nums">{num(Number(value))}</span>;
    case 'bool': return <span>{value ? t('common.list.yes') : t('common.list.no')}</span>;
    case 'date': return <span>{shortDate(`${value}T00:00:00Z`)}</span>;
    case 'datetime': return <span>{dateTime(String(value))}</span>;
    case 'enum': return <span>{valueLabel ? valueLabel(String(value)) : String(value)}</span>;
    case 'tags':
      return (
        <span className="flex flex-wrap gap-1">
          {(value as unknown[]).map((tag) => <span key={String(tag)} className="rounded-full bg-raised px-2 py-0.5 text-xs text-muted">{String(tag)}</span>)}
        </span>
      );
    case 'url': return <a href={String(value)} className="text-brand-700 underline break-all" rel="noopener noreferrer" target="_blank">{String(value)}</a>;
    case 'email': return <a href={`mailto:${value}`} className="text-brand-700 underline">{String(value)}</a>;
    case 'image': return <div className="h-24 w-32 overflow-hidden rounded-lg"><EntityImage src={value} alt={field.name} /></div>;
    case 'ref': return <>{renderRef ? renderRef(String(value)) : String(value)}</>;
    case 'text': return <p className="whitespace-pre-line">{String(value)}</p>;
    default: return <span>{String(value)}</span>;
  }
}

/** One field's form control. Values are what the API takes: money in whole cents, tags a list, dates YYYY-MM-DD. */
export function FieldInput({ field, value, onChange, valueLabel, refOptions, id }: {
  field: FieldMeta; value: unknown; onChange: (v: unknown) => void; valueLabel?: (v: string) => string;
  /** ref fields: [id, name] choices */
  refOptions?: [string, string][]; id?: string;
}) {
  const { t } = useTranslation();
  const common = { id, required: field.required, placeholder: field.hint };
  switch (field.type) {
    case 'text':
      return <Textarea {...common} rows={4} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'int': case 'number':
      return <Input {...common} type="number" step={field.type === 'int' ? 1 : 'any'} value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : field.type === 'int' ? Math.trunc(Number(e.target.value)) : Number(e.target.value))} />;
    case 'money':
      return <Input {...common} type="number" step="0.01" min="0" value={value === null || value === undefined ? '' : (Number(value) / 100).toFixed(2)}
        onChange={(e) => onChange(e.target.value === '' ? null : Math.round(Number(e.target.value) * 100))} />;
    case 'bool':
      return <Toggle checked={!!value} onChange={onChange} label={field.name} />;
    case 'date':
      return <Input {...common} type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return <Input {...common} type="datetime-local" value={value ? String(value).slice(0, 16) : ''}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />;
    case 'enum':
      return (
        <Select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{t('common.list.choose')}</option>
          {(field.values ?? []).map((v) => <option key={v} value={v}>{valueLabel ? valueLabel(v) : v}</option>)}
        </Select>
      );
    case 'ref':
      return (
        <Select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{t('common.list.choose')}</option>
          {(refOptions ?? []).map(([rid, name]) => <option key={rid} value={rid}>{name}</option>)}
        </Select>
      );
    case 'tags':
      return <Input {...common} value={Array.isArray(value) ? value.join(', ') : ''}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />;
    case 'email':
      return <Input {...common} type="email" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'url': case 'image':
      return <Input {...common} type="url" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <Input {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
}

export interface ToolbarFilter {
  field: string;
  label: string;
  value: string;
  options: [string, string][];
}

/** Search box, filters (enum / ref / bool fields) and sort, for a list page. Sort options: '' is the default order,
 *  'name' ascending, '-name' descending. */
export function ListToolbar({ q, onSearch, placeholder, sort, sortFields, onSort, filters, onFilter, onClear }: {
  q: string; onSearch: (q: string) => void; placeholder?: string;
  sort: string; sortFields: [string, string][]; onSort: (s: string) => void;
  filters: ToolbarFilter[]; onFilter: (field: string, value: string) => void; onClear?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <form className="flex min-w-48 flex-1 gap-2" role="search"
        onSubmit={(e) => { e.preventDefault(); onSearch(String(new FormData(e.currentTarget).get('q') ?? '').trim()); }}>
        <Input key={q} name="q" defaultValue={q} placeholder={placeholder ?? t('common.list.search')} aria-label={t('common.list.search')} />
        <Button type="submit">{t('common.list.search')}</Button>
      </form>
      {filters.map((f) => (
        <Select key={f.field} value={f.value} onChange={(e) => onFilter(f.field, e.target.value)} className="w-auto" aria-label={f.label}>
          <option value="">{t('common.list.allOf', { name: f.label })}</option>
          {f.options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </Select>
      ))}
      {sortFields.length > 0 && (
        <Select value={sort} onChange={(e) => onSort(e.target.value)} className="w-auto" aria-label={t('common.list.sort')}>
          <option value="">{t('common.list.sortDefault')}</option>
          <option value="-createdAt">{t('common.list.newest')}</option>
          <option value="createdAt">{t('common.list.oldest')}</option>
          {sortFields.flatMap(([name, label]) => [
            <option key={name} value={name}>{t('common.list.sortAsc', { name: label })}</option>,
            <option key={`-${name}`} value={`-${name}`}>{t('common.list.sortDesc', { name: label })}</option>,
          ])}
        </Select>
      )}
      {onClear && <Button variant="ghost" onClick={onClear}>{t('common.list.clear')}</Button>}
    </div>
  );
}

/** Previous / next with "Page 2 of 5". Nothing when everything fits on one page. */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-3 py-4" aria-label={t('common.list.pages')}>
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('common.list.prev')}</Button>
      <span className="text-sm text-muted">{t('common.list.pageOf', { page, pages })}</span>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('common.list.next')}</Button>
    </nav>
  );
}
