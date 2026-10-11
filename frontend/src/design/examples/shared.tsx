/* Helpers the example directions share. Preview-only code (non-prod builds): its English demo strings are not
   translated on purpose. */
import { useMemo, useState } from 'react';
import { SAMPLE_ITEMS } from '../sample';
import type { SampleItem } from '../sample';

/** Client-side search, category filter, sort and paging over the sample, the way a page drives Browse. */
export function useSampleBrowse(pageSize = 6) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string[]>([]);
  const [sort, setSort] = useState('popular');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const all = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = SAMPLE_ITEMS.filter((s) =>
      (!q || `${s.title} ${s.summary} ${s.place}`.toLowerCase().includes(q)) && (!category.length || category.includes(s.category)));
    const by: Record<string, (a: SampleItem, b: SampleItem) => number> = {
      popular: (a, b) => b.rating - a.rating,
      low: (a, b) => a.price - b.price,
      high: (a, b) => b.price - a.price,
    };
    return [...hit].sort(by[sort]);
  }, [query, category, sort]);
  return {
    query, onQuery: (v: string) => { setQuery(v); setPage(1); },
    category, onCategory: (v: string[]) => { setCategory(v); setPage(1); },
    sort, onSort: setSort, view, onView: setView,
    page, onPage: setPage, pageSize, total: all.length,
    items: all.slice((page - 1) * pageSize, page * pageSize),
  };
}

export const SORTS = [
  { value: 'popular', label: 'Top rated' },
  { value: 'low', label: 'Price: low to high' },
  { value: 'high', label: 'Price: high to low' },
];

/** The preview can't route between direction pages, so every "link" goes nowhere. */
export const HREF = '#';
