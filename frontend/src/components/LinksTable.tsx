import { useState } from 'react';
import type { Link, LinkStatus } from '../types';
import StatusBadge from './StatusBadge';
import LinkDetailDrawer from './LinkDetailDrawer';

interface LinksTableProps {
  links: Link[];
  onDelete: (linkId: string) => void;
  isPro: boolean;
  onRecrawl: (linkId: string) => void;
}

type SortField = 'pageUrl' | 'destinationUrl' | 'status' | 'lastChecked' | 'firstAdded';
type SortDir = 'asc' | 'desc';

const statusFilters: LinkStatus[] = ['LIVE', 'MISSING', '404', 'REDIRECT', 'ERROR', 'PENDING'];

export default function LinksTable({ links, onDelete, isPro, onRecrawl }: LinksTableProps) {
  const [sortField, setSortField] = useState<SortField>('lastChecked');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [statusFilter, setStatusFilter] = useState<LinkStatus | 'ALL'>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filtered = statusFilter === 'ALL' ? links : links.filter((l) => l.status === statusFilter);

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortField] || '';
    const bv = b[sortField] || '';
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === sorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((l) => l.linkId)));
    }
  };

  const deleteSelected = () => {
    selected.forEach((id) => onDelete(id));
    setSelected(new Set());
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <svg
      className={`w-3 h-3 inline ml-1 ${sortField === field ? 'text-indigo-600' : 'text-gray-400'}`}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={sortField === field && sortDir === 'desc' ? 'm19.5 8.25-7.5 7.5-7.5-7.5' : 'm4.5 15.75 7.5-7.5 7.5 7.5'}
      />
    </svg>
  );

  return (
    <div>
      {/* Filters + Bulk Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              statusFilter === 'ALL'
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            All ({links.length})
          </button>
          {statusFilters.map((s) => {
            const count = links.filter((l) => l.status === s).length;
            if (count === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                  statusFilter === s
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {s} ({count})
              </button>
            );
          })}
        </div>
        {selected.size > 0 && (
          <button
            onClick={deleteSelected}
            className="text-xs text-red-600 hover:text-red-700 font-medium"
          >
            Delete selected ({selected.size})
          </button>
        )}
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
          </svg>
          <p className="text-gray-500 text-sm">
            {links.length === 0
              ? 'No links yet. Add your first backlink above to start monitoring.'
              : 'No links match the current filter.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-8 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.size === sorted.length && sorted.length > 0}
                      onChange={toggleAll}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer select-none"
                    onClick={() => toggleSort('pageUrl')}
                  >
                    Page URL <SortIcon field="pageUrl" />
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hidden lg:table-cell"
                    onClick={() => toggleSort('destinationUrl')}
                  >
                    Destination <SortIcon field="destinationUrl" />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden xl:table-cell">
                    Anchor
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer select-none"
                    onClick={() => toggleSort('status')}
                  >
                    Status <SortIcon field="status" />
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hidden md:table-cell"
                    onClick={() => toggleSort('lastChecked')}
                  >
                    Last Checked <SortIcon field="lastChecked" />
                  </th>
                  <th className="w-12 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((link) => (
                  <LinkRow
                    key={link.linkId}
                    link={link}
                    selected={selected.has(link.linkId)}
                    onToggleSelect={() => toggleSelect(link.linkId)}
                    expanded={expandedId === link.linkId}
                    onToggleExpand={() =>
                      setExpandedId(expandedId === link.linkId ? null : link.linkId)
                    }
                    onDelete={() => onDelete(link.linkId)}
                    isPro={isPro}
                    onRecrawl={() => onRecrawl(link.linkId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkRow({
  link,
  selected,
  onToggleSelect,
  expanded,
  onToggleExpand,
  onDelete,
  isPro,
  onRecrawl,
}: {
  link: Link;
  selected: boolean;
  onToggleSelect: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  isPro: boolean;
  onRecrawl: () => void;
}) {
  const formatDate = (iso: string) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const truncateUrl = (url: string) => {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + '...' : u.pathname;
      return u.hostname + path;
    } catch {
      return url.length > 50 ? url.slice(0, 50) + '...' : url;
    }
  };

  return (
    <>
      <tr
        className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
          expanded ? 'bg-indigo-50/30' : ''
        }`}
        onClick={onToggleExpand}
      >
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
        </td>
        <td className="px-4 py-3 text-gray-900 font-medium">
          <span title={link.pageUrl}>{truncateUrl(link.pageUrl)}</span>
          {link.jsWarning && (
            <span className="ml-1 text-xs text-amber-600" title="This page may require JavaScript to render">
              JS
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
          <span title={link.destinationUrl}>{truncateUrl(link.destinationUrl)}</span>
        </td>
        <td className="px-4 py-3 text-gray-600 hidden xl:table-cell">
          {link.anchorText || '-'}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={link.status} />
        </td>
        <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
          {formatDate(link.lastChecked)}
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-1">
            {isPro && (
              <button
                onClick={onRecrawl}
                title="Re-crawl now"
                className="p-1 text-gray-400 hover:text-indigo-600"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                </svg>
              </button>
            )}
            <button
              onClick={onDelete}
              title="Delete"
              className="p-1 text-gray-400 hover:text-red-600"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="px-4 py-0">
            <LinkDetailDrawer link={link} />
          </td>
        </tr>
      )}
    </>
  );
}
