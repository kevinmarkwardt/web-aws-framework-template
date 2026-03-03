import { useState, useEffect } from 'react';
import { fetchAllItems, deleteAdminItem } from '../../../admin-api';
import type { Item } from '../../../types';
import StatusBadge from '../../../components/StatusBadge';

export default function AdminItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadItems = () => {
    setLoading(true);
    fetchAllItems({ status: statusFilter || undefined, q: search || undefined })
      .then(setItems)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadItems(); }, [statusFilter]);

  const handleDeleteItem = async (userId: string, itemId: string) => {
    if (!confirm('Delete this item?')) return;
    await deleteAdminItem(userId, itemId);
    loadItems();
  };

  const statuses = ['ACTIVE', 'INACTIVE', 'PENDING', 'ERROR'];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Items</h1>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadItems()}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm flex-1"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={loadItems} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Search</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No items found</td></tr>
            ) : items.map((item) => (
              <tr key={`${item.userId}-${item.itemId}`} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                <td className="px-4 py-3 text-gray-500">{new Date(item.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{item.userId?.slice(0, 8)}...</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleDeleteItem(item.userId!, item.itemId)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
