import { useState, useEffect } from 'react';
import {
  fetchAllLinks, deleteAdminLink, crawlAdminLink,
  triggerCrawlAll, triggerDigest,
} from '../../../admin-api';
import type { Link } from '../../../types';
import StatusBadge from '../../../components/StatusBadge';

export default function LinksPage() {
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const loadLinks = () => {
    setLoading(true);
    fetchAllLinks({ status: statusFilter || undefined, q: search || undefined })
      .then(setLinks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadLinks(); }, [statusFilter]);

  const handleDeleteLink = async (userId: string, linkId: string) => {
    if (!confirm('Delete this link?')) return;
    await deleteAdminLink(userId, linkId);
    loadLinks();
  };

  const handleCrawl = async (userId: string, linkId: string) => {
    await crawlAdminLink(userId, linkId);
    setActionMsg('Crawl triggered');
    setTimeout(() => setActionMsg(''), 3000);
  };

  const handleCrawlAll = async () => {
    await triggerCrawlAll();
    setActionMsg('Crawl-all triggered');
    setTimeout(() => setActionMsg(''), 3000);
  };

  const handleDigest = async () => {
    await triggerDigest();
    setActionMsg('Digest triggered');
    setTimeout(() => setActionMsg(''), 3000);
  };

  const statuses = ['LIVE', 'MISSING', '404', 'REDIRECT', 'ERROR', 'PENDING'];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Links</h1>
        <div className="flex gap-2">
          <button onClick={handleCrawlAll} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Crawl All</button>
          <button onClick={handleDigest} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Send Digest</button>
        </div>
      </div>

      {actionMsg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">{actionMsg}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Search URLs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadLinks()}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm flex-1"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={loadLinks} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Search</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Page URL</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Destination</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : links.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No links found</td></tr>
            ) : links.map((l) => (
              <tr key={`${l.userId}-${l.linkId}`} className="hover:bg-gray-50">
                <td className="px-4 py-3"><StatusBadge status={l.status} /></td>
                <td className="px-4 py-3 text-gray-600 truncate max-w-xs">{l.pageUrl}</td>
                <td className="px-4 py-3 text-gray-600 truncate max-w-xs">{l.destinationUrl}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{l.userId?.slice(0, 8)}...</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => handleCrawl(l.userId!, l.linkId)} className="text-indigo-600 hover:text-indigo-800 text-xs">Crawl</button>
                  <button onClick={() => handleDeleteLink(l.userId!, l.linkId)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
