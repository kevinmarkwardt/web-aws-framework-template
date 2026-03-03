import { useState, useEffect } from 'react';
import { fetchUsers, fetchUserDetail, updateUser, deleteUser } from '../../admin-api';
import type { User } from '../../types';
import type { UserDetail } from '../../admin-types';
import StatusBadge from '../../components/StatusBadge';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    fetchUsers()
      .then(setUsers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggleExpand = async (userId: string) => {
    if (expandedId === userId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(userId);
    try {
      const d = await fetchUserDetail(userId);
      setDetail(d);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handlePlanChange = async (userId: string, plan: string) => {
    await updateUser(userId, { plan });
    load();
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('Delete this user and all their data?')) return;
    await deleteUser(userId);
    setExpandedId(null);
    load();
  };

  const filtered = users.filter(
    (u) => !search || u.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Users ({users.length})</h1>
        <input
          type="text"
          placeholder="Search by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-64"
        />
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Plan</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Items</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((u) => (
              <tbody key={u.userId}>
                <tr
                  onClick={() => toggleExpand(u.userId)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.plan}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handlePlanChange(u.userId, e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs"
                    >
                      <option value="free">Free</option>
                      <option value="starter">Starter</option>
                      <option value="pro">Pro</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.itemCount}</td>
                  <td className="px-4 py-3 text-gray-500">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(u.userId); }}
                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {expandedId === u.userId && detail && (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 bg-gray-50">
                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <h3 className="font-semibold text-gray-900 mb-2">Items ({detail.items.length})</h3>
                          {detail.items.length === 0 ? (
                            <p className="text-gray-400 text-xs">No items</p>
                          ) : (
                            <div className="space-y-1 max-h-48 overflow-auto">
                              {detail.items.map((item) => (
                                <div key={item.itemId} className="flex items-center gap-2 text-xs">
                                  <StatusBadge status={item.status} />
                                  <span className="text-gray-600 truncate">{item.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-gray-400">User ID: {u.userId}</p>
                    </td>
                  </tr>
                )}
              </tbody>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
