import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Container, EmptyState, ErrorState, SkeletonGrid } from './parts';
import { COLS, cx } from './util';
import type { Action } from './parts';

export interface FilterOption {
  value: string;
  label: ReactNode;
  count?: number;
}

export interface Filter {
  id: string;
  label: ReactNode;
  options: FilterOption[];
  /** selected values; one value unless `multi` */
  value: string[];
  onChange: (value: string[]) => void;
  multi?: boolean;
}

export interface SortOption {
  value: string;
  label: string;
}

export type BrowseView = 'grid' | 'list';

/** A browsable collection: search, filters, sort, grid/list, pagination, and every state (loading, error, empty,
 *  no results). It owns no data: the page passes the current page of items and handles the callbacks, so the same
 *  archetype works on mocks (MSW) and on the real API.
 *  - `filtersAt: 'top'` puts the filters in a chip bar (few filters, visual sites)
 *  - `filtersAt: 'side'` puts them in a left column (many filters, catalogs) */
export function Browse<T>({
  title, subtitle, header,
  query, onQuery, searchPlaceholder,
  filters = [], filtersAt = 'top',
  sort, sortOptions = [], onSort,
  view = 'grid', onView, columns = 3,
  items, renderCard, renderRow, itemKey,
  total, page = 1, pageSize, onPage,
  loading, error, onRetry,
  empty, noResults,
}: {
  title: ReactNode; subtitle?: ReactNode; header?: ReactNode;
  query?: string; onQuery?: (q: string) => void; searchPlaceholder?: string;
  filters?: Filter[]; filtersAt?: 'top' | 'side';
  sort?: string; sortOptions?: SortOption[]; onSort?: (v: string) => void;
  view?: BrowseView; onView?: (v: BrowseView) => void; columns?: 2 | 3 | 4;
  items: T[]; renderCard: (item: T) => ReactNode; renderRow?: (item: T) => ReactNode; itemKey: (item: T) => string;
  total?: number; page?: number; pageSize?: number; onPage?: (p: number) => void;
  loading?: boolean; error?: ReactNode; onRetry?: () => void;
  /** the collection itself is empty */
  empty?: { title: ReactNode; body?: ReactNode; action?: Action };
  /** search or filters matched nothing */
  noResults?: { title?: ReactNode; body?: ReactNode };
}) {
  const { t } = useTranslation();
  const filtering = Boolean(query) || filters.some((f) => f.value.length > 0);
  const clearAll = () => {
    onQuery?.('');
    filters.forEach((f) => f.value.length && f.onChange([]));
  };
  const pages = total !== undefined && pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      {onQuery && (
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">{t('common.archetypes.search')}</span>
          <svg aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
          </svg>
          <input
            type="search"
            value={query ?? ''}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={searchPlaceholder ?? t('common.archetypes.searchPlaceholder')}
            className="w-full rounded-control border border-line-strong bg-panel py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </label>
      )}
      <div className="ml-auto flex items-center gap-2">
        {total !== undefined && !loading && (
          <span className="text-sm text-muted tabular-nums">{t('common.archetypes.results', { count: total })}</span>
        )}
        {onSort && sortOptions.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <span className="sr-only">{t('common.archetypes.sort')}</span>
            <select
              value={sort}
              onChange={(e) => onSort(e.target.value)}
              className="rounded-control border border-line-strong bg-panel py-2 pl-3 pr-8 text-sm text-ink focus:border-brand-500 focus:outline-none"
            >
              {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
        {onView && renderRow && (
          <div role="group" aria-label={t('common.archetypes.view')} className="flex rounded-control border border-line bg-panel p-0.5">
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => onView(v)}
                className={cx('rounded-[calc(var(--corner-control)-2px)] px-2.5 py-1.5 text-xs font-medium', view === v ? 'bg-raised text-ink' : 'text-muted hover:text-ink')}
              >
                {t(v === 'grid' ? 'common.archetypes.grid' : 'common.archetypes.list')}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const chips = filtersAt === 'top' && filters.length > 0 && (
    <div className="flex flex-col gap-3">
      {filters.map((f) => (
        <div key={f.id} role="group" aria-label={typeof f.label === 'string' ? f.label : f.id} className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-faint">{f.label}</span>
          {f.options.map((o) => {
            const on = f.value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => f.onChange(on ? f.value.filter((v) => v !== o.value) : f.multi ? [...f.value, o.value] : [o.value])}
                className={cx('rounded-full border px-3 py-1 text-sm transition-colors',
                  on ? 'border-brand-600 bg-brand-600 text-brand-ink' : 'border-line bg-panel text-ink hover:border-brand-300')}
              >
                {o.label}{o.count !== undefined && <span className={cx('ml-1.5 tabular-nums', on ? 'opacity-80' : 'text-faint')}>{o.count}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  const side = filtersAt === 'side' && filters.length > 0 && (
    <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
      {filters.map((f) => (
        <fieldset key={f.id}>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{f.label}</legend>
          <div className="space-y-1.5">
            {f.options.map((o) => {
              const on = f.value.includes(o.value);
              return (
                <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                  <input
                    type={f.multi ? 'checkbox' : 'radio'}
                    name={f.id}
                    checked={on}
                    onChange={() => f.onChange(on ? f.value.filter((v) => v !== o.value) : f.multi ? [...f.value, o.value] : [o.value])}
                    className="accent-[var(--brand-600)]"
                  />
                  <span className="flex-1">{o.label}</span>
                  {o.count !== undefined && <span className="text-xs text-faint tabular-nums">{o.count}</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      {filtering && (
        <button type="button" onClick={clearAll} className="text-sm font-medium text-brand-700 hover:underline">{t('common.archetypes.clearFilters')}</button>
      )}
    </aside>
  );

  let results: ReactNode;
  if (error) results = <ErrorState message={error} onRetry={onRetry} />;
  else if (loading) results = <SkeletonGrid columns={columns} count={columns * 2} />;
  else if (items.length === 0 && filtering) {
    results = (
      <EmptyState
        title={noResults?.title ?? t('common.archetypes.noResults')}
        body={noResults?.body ?? t('common.archetypes.noResultsBody')}
        action={{ label: t('common.archetypes.clearFilters'), onClick: clearAll, variant: 'secondary' }}
      />
    );
  } else if (items.length === 0) {
    results = <EmptyState title={empty?.title ?? t('common.nothingYet')} body={empty?.body} action={empty?.action} />;
  } else if (view === 'list' && renderRow) {
    results = (
      <ul className="divide-y divide-line rounded-card border border-line bg-panel px-4">
        {items.map((it) => <li key={itemKey(it)}>{renderRow(it)}</li>)}
      </ul>
    );
  } else {
    results = <div className={cx('grid gap-x-6 gap-y-10 sm:grid-cols-2', COLS[columns])}>{items.map((it) => <div key={itemKey(it)}>{renderCard(it)}</div>)}</div>;
  }

  return (
    <div className="section-y">
      <Container width="wide">
        {header ?? (
          <div className="mb-8">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
            {subtitle && <p className="mt-2 max-w-2xl text-muted">{subtitle}</p>}
          </div>
        )}
        <div className={cx(side && 'grid gap-10 lg:grid-cols-[14rem_1fr]')}>
          {side}
          <div className="min-w-0 space-y-6">
            {toolbar}
            {chips}
            {results}
            {onPage && pages > 1 && !loading && !error && items.length > 0 && (
              <Pagination page={page} pages={pages} onPage={onPage} />
            )}
          </div>
        </div>
      </Container>
    </div>
  );
}

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  const btn = 'rounded-control border border-line-strong bg-panel px-3 py-1.5 text-sm font-medium text-ink hover:bg-raised disabled:opacity-40 disabled:hover:bg-panel';
  return (
    <nav aria-label={t('common.archetypes.pagination')} className="flex items-center justify-between gap-3 pt-4">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('common.archetypes.previous')}</button>
      <span className="text-sm text-muted tabular-nums">{t('common.archetypes.pageOf', { page, pages })}</span>
      <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('common.archetypes.next')}</button>
    </nav>
  );
}
